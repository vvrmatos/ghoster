package proxy

import (
	"bytes"
	_ "embed"
	"encoding/json"
	"fmt"
	"html"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"

	xhtml "golang.org/x/net/html"
)

//go:embed nuke.js
var nukeRaw string

// nukeInline is the full anti-tracking suite, wrapped in a script tag,
// injected at the very top of <head> so it runs before any site script.
var nukeInline = "<script>" + nukeRaw + "</script>"

// frameHeaders are stripped so the page can be framed and can't track.
var frameHeaders = []string{
	"X-Frame-Options", "Content-Security-Policy",
	"Content-Security-Policy-Report-Only", "X-Content-Security-Policy",
	"Set-Cookie", "Strict-Transport-Security", "Report-To", "NEL",
	"Permissions-Policy", "Feature-Policy", "X-Permitted-Cross-Domain-Policies",
}

var (
	cssURLRe    = regexp.MustCompile(`(?is)url\(\s*['"]?([^'")]+)['"]?\s*\)`)
	cssImportRe = regexp.MustCompile(`(?is)@import\s+['"]([^'"]+)['"]`)
)

const maxRewriteBody = 8 << 20

// serveBrowse fetches a URL through Tor, sanitizes it, and returns it framable.
func (p *Proxy) serveBrowse(w http.ResponseWriter, r *http.Request) {
	target, err := parseTarget(r.URL.Query().Get("url"))
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if r.Method == http.MethodGet {
		targetQuery := target.Query()
		for key, values := range r.URL.Query() {
			if key == "url" {
				continue
			}
			for _, value := range values {
				targetQuery.Add(key, value)
			}
		}
		target.RawQuery = targetQuery.Encode()
	}

	req, err := http.NewRequestWithContext(r.Context(), r.Method, target.String(), r.Body)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	p.sanitizeRequest(req)
	req.Header.Set("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8")
	if contentType := r.Header.Get("Content-Type"); contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}

	resp, err := p.client.Do(req)
	if err != nil {
		writeBrowseError(w, err)
		return
	}
	defer resp.Body.Close()

	for _, h := range frameHeaders {
		resp.Header.Del(h)
	}
	copyResponseHeaders(w, resp.Header)

	ct := resp.Header.Get("Content-Type")
	if !strings.Contains(ct, "text/html") {
		w.WriteHeader(resp.StatusCode)
		_, _ = io.Copy(w, io.LimitReader(resp.Body, maxRewriteBody))
		return
	}

	body, err := readLimited(resp.Body, maxRewriteBody)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	base := resp.Request.URL
	gateway := proxyOrigin(r)
	rewritten := rewriteHTML(string(body), base, gateway)
	rewritten = injectInto(rewritten, base, gateway)

	w.WriteHeader(resp.StatusCode)
	_, _ = io.WriteString(w, rewritten)
}

// serveAsset proxies subresources through the same pooled Tor client. CSS URLs
// are rewritten so fonts/images/imports also stay inside the gateway.
func (p *Proxy) serveAsset(w http.ResponseWriter, r *http.Request) {
	target, err := parseTarget(r.URL.Query().Get("url"))
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, target.String(), nil)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	p.sanitizeRequest(req)
	for _, h := range []string{"Accept", "Range", "If-None-Match", "If-Modified-Since"} {
		if value := r.Header.Get(h); value != "" {
			req.Header.Set(h, value)
		}
	}
	resp, err := p.client.Do(req)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()
	resp.Header.Del("Set-Cookie")
	copyResponseHeaders(w, resp.Header)

	if strings.Contains(resp.Header.Get("Content-Type"), "text/css") {
		body, readErr := readLimited(resp.Body, maxRewriteBody)
		if readErr != nil {
			http.Error(w, readErr.Error(), http.StatusBadGateway)
			return
		}
		body = []byte(rewriteCSS(string(body), resp.Request.URL, proxyOrigin(r)))
		w.WriteHeader(resp.StatusCode)
		_, _ = w.Write(body)
		return
	}
	w.WriteHeader(resp.StatusCode)
	_, _ = io.Copy(w, resp.Body)
}

func (p *Proxy) sanitizeRequest(req *http.Request) {
	for _, h := range stripHeaders {
		req.Header.Del(h)
	}
	req.Header.Set("User-Agent", p.ua())
	req.Header.Set("Accept-Language", p.language())
	req.Header.Set("DNT", "1")
	req.Header.Del("X-Forwarded-For")
	req.Header.Del("Forwarded")
	req.Header.Del("Via")
}

func parseTarget(raw string) (*url.URL, error) {
	if raw == "" {
		return nil, fmt.Errorf("missing url")
	}
	if !strings.HasPrefix(raw, "http://") && !strings.HasPrefix(raw, "https://") {
		raw = "https://" + raw
	}
	target, err := url.Parse(raw)
	if err != nil || target.Host == "" {
		return nil, fmt.Errorf("bad url")
	}
	return target, nil
}

func proxyOrigin(r *http.Request) string {
	host := r.Host
	if host == "" {
		host = "127.0.0.1:8888"
	}
	return "http://" + host
}

func gatewayURL(origin, route string, target *url.URL) string {
	return origin + route + "?url=" + url.QueryEscape(target.String())
}

func shouldResolve(raw string) bool {
	lower := strings.ToLower(strings.TrimSpace(raw))
	for _, prefix := range []string{"", "#", "data:", "javascript:", "mailto:", "magnet:", "tel:", "blob:", "about:"} {
		if lower == prefix || (prefix != "" && strings.HasPrefix(lower, prefix)) {
			return false
		}
	}
	return true
}

// rewriteHTML routes navigations through /browse and resources through /asset.
// Gateway URLs are absolute so an injected remote <base> can never steal them.
func rewriteHTML(raw string, base *url.URL, origin string) string {
	doc, err := xhtml.Parse(strings.NewReader(raw))
	if err != nil {
		return raw
	}
	var walk func(*xhtml.Node)
	walk = func(n *xhtml.Node) {
		if n.Type == xhtml.ElementNode {
			tag := strings.ToLower(n.Data)
			for i := range n.Attr {
				attr := strings.ToLower(n.Attr[i].Key)
				value := n.Attr[i].Val
				if attr == "target" && (tag == "a" || tag == "form") {
					n.Attr[i].Val = "_self"
					continue
				}
				if attr == "srcset" {
					n.Attr[i].Val = rewriteSrcset(value, base, origin)
					continue
				}
				if attr == "style" {
					n.Attr[i].Val = rewriteCSS(value, base, origin)
					continue
				}
				if !shouldResolve(value) {
					continue
				}
				abs, resolveErr := base.Parse(value)
				if resolveErr != nil || (abs.Scheme != "http" && abs.Scheme != "https") {
					continue
				}
				switch {
				case (tag == "a" || tag == "area") && attr == "href":
					n.Attr[i].Val = gatewayURL(origin, "/browse", abs)
				case tag == "form" && attr == "action":
					n.Attr[i].Val = gatewayURL(origin, "/browse", abs)
				case (tag == "iframe" || tag == "frame") && attr == "src":
					n.Attr[i].Val = gatewayURL(origin, "/browse", abs)
				case isResourceAttribute(tag, attr):
					n.Attr[i].Val = gatewayURL(origin, "/asset", abs)
				}
			}
			if tag == "style" {
				for child := n.FirstChild; child != nil; child = child.NextSibling {
					if child.Type == xhtml.TextNode {
						child.Data = rewriteCSS(child.Data, base, origin)
					}
				}
			}
			if tag == "meta" {
				rewriteMetaRefresh(n, base, origin)
			}
		}
		for child := n.FirstChild; child != nil; child = child.NextSibling {
			walk(child)
		}
	}
	walk(doc)
	var out bytes.Buffer
	if err := xhtml.Render(&out, doc); err != nil {
		return raw
	}
	return out.String()
}

func rewriteMetaRefresh(n *xhtml.Node, base *url.URL, origin string) {
	isRefresh := false
	contentIndex := -1
	for i := range n.Attr {
		switch strings.ToLower(n.Attr[i].Key) {
		case "http-equiv":
			isRefresh = strings.EqualFold(strings.TrimSpace(n.Attr[i].Val), "refresh")
		case "content":
			contentIndex = i
		}
	}
	if !isRefresh || contentIndex < 0 {
		return
	}
	content := n.Attr[contentIndex].Val
	lower := strings.ToLower(content)
	pos := strings.Index(lower, "url=")
	if pos < 0 {
		return
	}
	raw := strings.Trim(strings.TrimSpace(content[pos+4:]), `"'`)
	if !shouldResolve(raw) {
		return
	}
	abs, err := base.Parse(raw)
	if err != nil {
		return
	}
	n.Attr[contentIndex].Val = content[:pos] + "url=" + gatewayURL(origin, "/browse", abs)
}

func isResourceAttribute(tag, attr string) bool {
	if attr == "src" {
		switch tag {
		case "img", "script", "source", "video", "audio", "input", "track", "embed":
			return true
		}
	}
	if tag == "link" && attr == "href" {
		return true
	}
	if tag == "video" && attr == "poster" {
		return true
	}
	return false
}

func rewriteSrcset(raw string, base *url.URL, origin string) string {
	parts := strings.Split(raw, ",")
	for i, part := range parts {
		fields := strings.Fields(strings.TrimSpace(part))
		if len(fields) == 0 || !shouldResolve(fields[0]) {
			continue
		}
		if abs, err := base.Parse(fields[0]); err == nil {
			fields[0] = gatewayURL(origin, "/asset", abs)
			parts[i] = strings.Join(fields, " ")
		}
	}
	return strings.Join(parts, ", ")
}

func rewriteCSS(raw string, base *url.URL, origin string) string {
	raw = cssURLRe.ReplaceAllStringFunc(raw, func(match string) string {
		sub := cssURLRe.FindStringSubmatch(match)
		if len(sub) < 2 || !shouldResolve(sub[1]) {
			return match
		}
		abs, err := base.Parse(strings.TrimSpace(sub[1]))
		if err != nil {
			return match
		}
		return `url("` + gatewayURL(origin, "/asset", abs) + `")`
	})
	return cssImportRe.ReplaceAllStringFunc(raw, func(match string) string {
		sub := cssImportRe.FindStringSubmatch(match)
		if len(sub) < 2 || !shouldResolve(sub[1]) {
			return match
		}
		abs, err := base.Parse(strings.TrimSpace(sub[1]))
		if err != nil {
			return match
		}
		return `@import "` + gatewayURL(origin, "/asset", abs) + `"`
	})
}

func copyResponseHeaders(w http.ResponseWriter, headers http.Header) {
	for key, values := range headers {
		if strings.EqualFold(key, "Content-Length") || strings.EqualFold(key, "Content-Encoding") {
			continue
		}
		for _, value := range values {
			w.Header().Add(key, value)
		}
	}
}

func readLimited(r io.Reader, limit int64) ([]byte, error) {
	body, err := io.ReadAll(io.LimitReader(r, limit+1))
	if err != nil {
		return nil, err
	}
	if int64(len(body)) > limit {
		return nil, fmt.Errorf("response exceeds %d MB rewrite limit", limit>>20)
	}
	return body, nil
}

func writeBrowseError(w http.ResponseWriter, err error) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(http.StatusBadGateway)
	_, _ = io.WriteString(w, "<body style='background:#08080c;color:#f87171;font-family:sans-serif;padding:40px'>failed to load through tor: "+html.EscapeString(err.Error())+"</body>")
}

// injectInto adds nuke.js and a navigation reporter before site scripts.
func injectInto(page string, base *url.URL, origin string) string {
	logical, _ := json.Marshal(base.String())
	gateway, _ := json.Marshal(origin + "/browse?url=")
	nav := `<script>(function(){
var u=` + string(logical) + `,g=` + string(gateway) + `;
function send(){try{parent.postMessage({type:"ghoster-nav",url:u,title:document.title||""},"*")}catch(e){}}
function local(x){return g+encodeURIComponent(x)}
addEventListener("DOMContentLoaded",send);
addEventListener("pageshow",send);
addEventListener("popstate",function(){try{var x=new URL(location.href).searchParams.get("url");if(x)u=x}catch(e){}send()});
addEventListener("keydown",function(e){var m=e.metaKey||e.ctrlKey,k=(e.key||"").toLowerCase(),c=e.code||"";if((m&&(["r","l","t","w","[","]"].indexOf(k)>=0||["KeyR","KeyL","KeyT","KeyW","BracketLeft","BracketRight"].indexOf(c)>=0))||(e.altKey&&(e.key==="ArrowLeft"||e.key==="ArrowRight"))){e.preventDefault();parent.postMessage({type:"ghoster-key",key:e.key,code:c,altKey:e.altKey},"*")}},true);
document.addEventListener("click",function(e){var a=e.target&&e.target.closest&&e.target.closest("a[href]");if(!a)return;var h=a.getAttribute("href");try{var x=new URL(h,u);if(/^https?:$/.test(x.protocol)&&x.href.indexOf(g)!==0){e.preventDefault();location.href=local(x.href)}}catch(_){}});
document.addEventListener("submit",function(e){var f=e.target;if(!f||!f.action)return;try{var x=new URL(f.action,u);if(/^https?:$/.test(x.protocol)&&x.href.indexOf(g)!==0)f.action=local(x.href)}catch(_){}});
["pushState","replaceState"].forEach(function(k){var o=history[k];history[k]=function(s,t,x){if(x!=null){try{u=new URL(x,u).href;x=local(u)}catch(_){}}var r=o.call(this,s,t,x);send();return r}});
new MutationObserver(send).observe(document.documentElement,{subtree:true,childList:true,characterData:true});
})();</script>`
	inject := nukeInline + nav + `<base href="` + base.String() + `">`
	if i := strings.Index(strings.ToLower(page), "<head>"); i != -1 {
		return page[:i+6] + inject + page[i+6:]
	}
	if i := strings.Index(strings.ToLower(page), "<html"); i != -1 {
		if j := strings.Index(page[i:], ">"); j != -1 {
			pos := i + j + 1
			return page[:pos] + "<head>" + inject + "</head>" + page[pos:]
		}
	}
	return inject + page
}
