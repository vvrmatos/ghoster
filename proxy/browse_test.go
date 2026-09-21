package proxy

import (
	"net/url"
	"strings"
	"testing"
)

func TestRewriteHTMLRoutesNavigationAndAssets(t *testing.T) {
	base, _ := url.Parse("https://example.com/dir/page")
	input := `<!doctype html><html><head>
		<link rel="stylesheet" href="/app.css">
	</head><body>
		<a href="../next" target="_blank">next</a>
		<form action="/submit"></form>
		<img src="img/a.png" srcset="small.png 1x, /large.png 2x">
		<iframe src="/inside"></iframe>
	</body></html>`

	got := rewriteHTML(input, base, "http://127.0.0.1:8888", false)
	checks := []string{
		`href="http://127.0.0.1:8888/asset?url=https%3A%2F%2Fexample.com%2Fapp.css"`,
		`href="http://127.0.0.1:8888/browse?js=0&amp;url=https%3A%2F%2Fexample.com%2Fnext"`,
		`target="_self"`,
		`data-ghoster-newtab="1"`,
		`action="http://127.0.0.1:8888/browse?js=0&amp;url=https%3A%2F%2Fexample.com%2Fsubmit"`,
		`src="http://127.0.0.1:8888/asset?url=https%3A%2F%2Fexample.com%2Fdir%2Fimg%2Fa.png"`,
		`src="http://127.0.0.1:8888/browse?js=0&amp;url=https%3A%2F%2Fexample.com%2Finside"`,
	}
	for _, check := range checks {
		if !strings.Contains(got, check) {
			t.Errorf("rewritten HTML missing %q\n%s", check, got)
		}
	}
}

func TestRewriteHTMLPreservesHTTPOnion(t *testing.T) {
	base, _ := url.Parse("http://exampleonionaddress.onion/")
	got := rewriteHTML(`<a href="/next">next</a>`, base, "http://127.0.0.1:8888", false)
	if !strings.Contains(got, `url=http%3A%2F%2Fexampleonionaddress.onion%2Fnext`) {
		t.Fatalf("http onion was upgraded or lost: %s", got)
	}
}

func TestRewriteCSSRoutesRelativeResources(t *testing.T) {
	base, _ := url.Parse("https://example.com/css/main.css")
	got := rewriteCSS(`body{background:url("../img/bg.png")} @import "theme.css";`, base, "http://127.0.0.1:8888")
	for _, want := range []string{
		`url("http://127.0.0.1:8888/asset?url=https%3A%2F%2Fexample.com%2Fimg%2Fbg.png")`,
		`@import "http://127.0.0.1:8888/asset?url=https%3A%2F%2Fexample.com%2Fcss%2Ftheme.css"`,
	} {
		if !strings.Contains(got, want) {
			t.Errorf("rewritten CSS missing %q: %s", want, got)
		}
	}
}

func TestInjectIncludesNavigationReporter(t *testing.T) {
	base, _ := url.Parse("https://example.com/final")
	got := injectInto("<html><head><title>x</title></head><body></body></html>", base, "http://127.0.0.1:8888", false)
	for _, want := range []string{
		`type:"ghoster-nav"`,
		`type:"ghoster-key"`,
		`type:"ghoster-open-tab"`,
		`type:"ghoster-context"`,
		`document.addEventListener("auxclick"`,
		`window.open=function`,
		`"https://example.com/final"`,
		`<base href="https://example.com/final">`,
	} {
		if !strings.Contains(got, want) {
			t.Errorf("injection missing %q", want)
		}
	}
}

func TestRewriteMetaRefresh(t *testing.T) {
	base, _ := url.Parse("https://example.com/start")
	got := rewriteHTML(`<meta http-equiv="refresh" content="0; url=/landing">`, base, "http://127.0.0.1:8888", false)
	if !strings.Contains(got, `url=http://127.0.0.1:8888/browse?js=0&amp;url=https%3A%2F%2Fexample.com%2Flanding`) {
		t.Fatalf("meta refresh did not stay in gateway: %s", got)
	}
}

func TestSiteJavaScriptDefaultOff(t *testing.T) {
	base, _ := url.Parse("https://example.com/")
	input := `<script>window.siteRan=true</script><button onclick="window.clicked=true">x</button><a href="javascript:alert(1)">bad</a>`
	got := rewriteHTML(input, base, "http://127.0.0.1:8888", false)
	for _, forbidden := range []string{"window.siteRan", "onclick=", "javascript:"} {
		if strings.Contains(got, forbidden) {
			t.Fatalf("site JS survived default-off rewrite (%s): %s", forbidden, got)
		}
	}
	injected := injectInto(got, base, "http://127.0.0.1:8888", false)
	if !strings.Contains(injected, `script-src 'nonce-`) || !strings.Contains(injected, `type:"ghoster-nav"`) {
		t.Fatalf("internal bridge was not nonce-allowed: %s", injected)
	}
}

func TestSiteJavaScriptExplicitlyEnabled(t *testing.T) {
	base, _ := url.Parse("https://example.com/")
	input := `<script>window.siteRan=true</script><button onclick="window.clicked=true">x</button><a href="/next">next</a>`
	got := rewriteHTML(input, base, "http://127.0.0.1:8888", true)
	for _, required := range []string{"window.siteRan", "onclick="} {
		if !strings.Contains(got, required) {
			t.Fatalf("explicitly enabled site JS was removed (%s): %s", required, got)
		}
	}
	if !strings.Contains(got, `/browse?js=1&amp;url=`) {
		t.Fatalf("enabled mode did not propagate to navigation: %s", got)
	}
}
