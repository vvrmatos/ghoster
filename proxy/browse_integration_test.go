package proxy

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"
)

func TestBrowseGatewayDefaultOffEndToEnd(t *testing.T) {
	var mu sync.Mutex
	var seenUA, seenDNT string
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		seenUA, seenDNT = r.Header.Get("User-Agent"), r.Header.Get("DNT")
		mu.Unlock()
		switch r.URL.Path {
		case "/start":
			http.Redirect(w, r, "/final", http.StatusFound)
		case "/final":
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			w.Header().Set("Set-Cookie", "tracker=yes")
			fmt.Fprint(w, `<!doctype html><html><head><title>Final page</title>
				<script src="/site.js"></script><script>window.siteRan=true</script>
				<link rel="stylesheet" href="/site.css"></head>
				<body onload="window.loaded=true"><a href="/next" target="_blank">next</a>
				<img src="/pixel.png"></body></html>`)
		default:
			http.NotFound(w, r)
		}
	}))
	defer upstream.Close()

	p := &Proxy{lang: "en-US", client: upstream.Client()}
	requestURL := "/browse?js=0&url=" + url.QueryEscape(upstream.URL+"/start")
	req := httptest.NewRequest(http.MethodGet, requestURL, nil)
	req.Host = "127.0.0.1:8888"
	rec := httptest.NewRecorder()

	p.serveBrowse(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
	body := rec.Body.String()
	for _, forbidden := range []string{"window.siteRan", `onload=`, `/site.js`} {
		if strings.Contains(body, forbidden) {
			t.Fatalf("default-off response retained site JS %q: %s", forbidden, body)
		}
	}
	for _, required := range []string{
		`type:"ghoster-nav"`,
		`script-src 'nonce-`,
		`<base href="` + upstream.URL + `/final">`,
		`http://127.0.0.1:8888/browse?js=0&amp;url=`,
		`http://127.0.0.1:8888/asset?url=`,
		`data-ghoster-newtab="1"`,
	} {
		if !strings.Contains(body, required) {
			t.Fatalf("gateway response missing %q: %s", required, body)
		}
	}
	if got := rec.Header().Get("Set-Cookie"); got != "" {
		t.Fatalf("Set-Cookie leaked to browser: %q", got)
	}
	mu.Lock()
	defer mu.Unlock()
	if seenUA != uaPhantom || seenDNT != "1" {
		t.Fatalf("upstream identity headers UA=%q DNT=%q", seenUA, seenDNT)
	}
}

func TestBrowseGatewayExplicitJavaScriptOnEndToEnd(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		fmt.Fprint(w, `<script src="/site.js"></script><button onclick="window.clicked=true">go</button><a href="/next">next</a>`)
	}))
	defer upstream.Close()

	p := &Proxy{lang: "en-US", client: upstream.Client()}
	req := httptest.NewRequest(http.MethodGet, "/browse?js=1&url="+url.QueryEscape(upstream.URL), nil)
	req.Host = "127.0.0.1:8888"
	rec := httptest.NewRecorder()
	p.serveBrowse(rec, req)
	body := rec.Body.String()

	for _, required := range []string{`/asset?url=`, `onclick="window.clicked=true"`, `/browse?js=1&amp;url=`} {
		if !strings.Contains(body, required) {
			t.Fatalf("explicit-on response missing %q: %s", required, body)
		}
	}
	if strings.Contains(body, `script-src 'nonce-`) {
		t.Fatalf("explicit-on response retained default-off CSP: %s", body)
	}
}
