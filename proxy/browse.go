package proxy

import (
	_ "embed"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
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
	hrefRe = regexp.MustCompile(`(?i)(href|src|action)\s*=\s*["']([^"']+)["']`)
)

// serveBrowse fetches a URL through Tor, sanitizes it, and returns it framable.
func (p *Proxy) serveBrowse(w http.ResponseWriter, r *http.Request) {
	target := r.URL.Query().Get("url")
	if target == "" {
		http.Error(w, "missing url", http.StatusBadRequest)
		return
	}
	if !strings.HasPrefix(target, "http://") && !strings.HasPrefix(target, "https://") {
		target = "https://" + target
	}

	base, err := url.Parse(target)
	if err != nil {
		http.Error(w, "bad url", http.StatusBadRequest)
		return
	}

	transport := &http.Transport{Dial: p.dialer.Dial}
	req, err := http.NewRequest(r.Method, target, r.Body)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	req.Header.Set("User-Agent", p.ua())
	req.Header.Set("Accept-Language", p.language())
	req.Header.Set("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8")
	req.Header.Set("DNT", "1")

	resp, err := transport.RoundTrip(req)
	if err != nil {
		w.Header().Set("Content-Type", "text/html")
		w.Write([]byte("<body style='background:#08080c;color:#f87171;font-family:sans-serif;padding:40px'>failed to load through tor: " + err.Error() + "</body>"))
		return
	}
	defer resp.Body.Close()

	// Strip frame-blocking + tracking headers
	for _, h := range frameHeaders {
		resp.Header.Del(h)
	}

	ct := resp.Header.Get("Content-Type")
	body, _ := io.ReadAll(resp.Body)

	// Only rewrite HTML; pass other content types through
	if strings.Contains(ct, "text/html") {
		html := string(body)
		html = rewriteURLs(html, base)
		html = injectInto(html, base)
		body = []byte(html)
	}

	for k, vv := range resp.Header {
		if strings.EqualFold(k, "Content-Length") {
			continue
		}
		for _, v := range vv {
			w.Header().Add(k, v)
		}
	}
	w.WriteHeader(resp.StatusCode)
	w.Write(body)
}

// rewriteURLs rewrites href/src/action to route back through /browse.
func rewriteURLs(html string, base *url.URL) string {
	return hrefRe.ReplaceAllStringFunc(html, func(m string) string {
		sub := hrefRe.FindStringSubmatch(m)
		if len(sub) < 3 {
			return m
		}
		attr, val := sub[1], sub[2]
		if strings.HasPrefix(val, "data:") || strings.HasPrefix(val, "javascript:") ||
			strings.HasPrefix(val, "#") || strings.HasPrefix(val, "mailto:") ||
			strings.HasPrefix(val, "magnet:") {
			return m
		}
		abs, err := base.Parse(val)
		if err != nil {
			return m
		}
		// HTTPS-everywhere: upgrade insecure links
		if abs.Scheme == "http" {
			abs.Scheme = "https"
		}
		// Only proxy navigations (href/action) and frame src; images/css pass absolute
		if attr == "href" || attr == "action" {
			return attr + `="/browse?url=` + url.QueryEscape(abs.String()) + `"`
		}
		return attr + `="` + abs.String() + `"`
	})
}

// injectInto adds nuke.js first (before any site script), then <base> and a
// CSP meta that upgrades insecure requests (HTTPS-everywhere at the page level).
func injectInto(html string, base *url.URL) string {
	inject := nukeInline +
		`<meta http-equiv="Content-Security-Policy" content="upgrade-insecure-requests">` +
		`<base href="` + base.String() + `">`
	if i := strings.Index(strings.ToLower(html), "<head>"); i != -1 {
		return html[:i+6] + inject + html[i+6:]
	}
	if i := strings.Index(strings.ToLower(html), "<html"); i != -1 {
		if j := strings.Index(html[i:], ">"); j != -1 {
			pos := i + j + 1
			return html[:pos] + "<head>" + inject + "</head>" + html[pos:]
		}
	}
	return inject + html
}
