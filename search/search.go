// Package search is memento: a multi-source, zero-storage search engine that
// aggregates clearnet (DuckDuckGo), onion (Ahmia), and torrent (BTDigg) results,
// all fetched through Tor.
package search

import (
	"io"
	"net"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"time"

	"golang.org/x/net/proxy"
)

const ua = "Mozilla/5.0 (Windows NT 10.0; rv:128.0) Gecko/20100101 Firefox/128.0"

// Result is a single search hit.
type Result struct {
	URL     string `json:"url"`
	Title   string `json:"title"`
	Snippet string `json:"snippet"`
	Source  string `json:"source"` // web | onion | torrent
}

// Results groups hits by source.
type Results struct {
	Web     []Result `json:"web"`
	Onion   []Result `json:"onion"`
	Torrent []Result `json:"torrent"`
	Query   string   `json:"query"`
}

func torClient(timeout time.Duration) *http.Client {
	dialer, err := proxy.SOCKS5("tcp", "127.0.0.1:9050", nil, &net.Dialer{Timeout: timeout})
	if err != nil {
		return &http.Client{Timeout: timeout}
	}
	return &http.Client{
		Transport: &http.Transport{Dial: dialer.Dial},
		Timeout:   timeout,
	}
}

func fetchT(url string, timeout time.Duration) (string, error) {
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("User-Agent", ua)
	req.Header.Set("Accept-Language", "en-US,en;q=0.5")
	resp, err := torClient(timeout).Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	b, err := io.ReadAll(resp.Body)
	return string(b), err
}

func fetch(url string) (string, error) { return fetchT(url, 12*time.Second) }

var tagRe = regexp.MustCompile(`<[^>]+>`)

func stripTags(s string) string {
	return strings.TrimSpace(tagRe.ReplaceAllString(s, ""))
}

// SearchWeb returns only clearnet results — fast, so the UI can render instantly.
func SearchWeb(query string) Results {
	return Results{Query: query, Web: searchDDG(query)}
}

// SearchDark returns onion + torrent results (slower; fetched after web).
func SearchDark(query string) Results {
	out := Results{Query: query}
	var wg sync.WaitGroup
	wg.Add(2)
	go func() { defer wg.Done(); out.Onion = searchAhmia(query) }()
	go func() { defer wg.Done(); out.Torrent = searchBTDigg(query) }()
	wg.Wait()
	return out
}

// Search runs all three sources (kept for compatibility).
func Search(query string) Results {
	out := Results{Query: query}
	var wg sync.WaitGroup
	wg.Add(3)
	go func() { defer wg.Done(); out.Web = searchDDG(query) }()
	go func() { defer wg.Done(); out.Onion = searchAhmia(query) }()
	go func() { defer wg.Done(); out.Torrent = searchBTDigg(query) }()
	wg.Wait()
	return out
}

var (
	ddgResultRe = regexp.MustCompile(`(?is)<a[^>]*class="result__a"[^>]*>.*?</a>`)
	ddgHrefRe   = regexp.MustCompile(`(?is)href="([^"]+)"`)
	ddgSnipRe   = regexp.MustCompile(`(?is)<a[^>]+class="result__snippet"[^>]*>(.*?)</a>`)
	uddgRe = regexp.MustCompile(`uddg=([^&]+)`)
)

func parseDDGPage(html string, seen map[string]bool) []Result {
	var results []Result
	blocks := ddgResultRe.FindAllString(html, -1)
	snips := ddgSnipRe.FindAllStringSubmatch(html, -1)
	for i, block := range blocks {
		hm := ddgHrefRe.FindStringSubmatch(block)
		if hm == nil {
			continue
		}
		u := hm[1]
		if loc := uddgRe.FindStringSubmatch(u); loc != nil {
			u = urlDecode(loc[1])
		} else if strings.HasPrefix(u, "//") {
			u = "https:" + u
		}
		title := stripTags(block)
		if !strings.HasPrefix(u, "http") || title == "" || seen[u] {
			continue
		}
		seen[u] = true
		r := Result{URL: u, Title: title, Source: "web"}
		if i < len(snips) {
			r.Snippet = truncate(stripTags(snips[i][1]), 200)
		}
		results = append(results, r)
	}
	return results
}

func searchDDG(query string) []Result {
	seen := map[string]bool{}
	var results []Result
	if html, err := fetch("https://html.duckduckgo.com/html/?q=" + urlEncode(query)); err == nil {
		results = append(results, parseDDGPage(html, seen)...)
	}
	return capResults(results, 60)
}

var ahmiaRe = regexp.MustCompile(`(?is)<a[^>]+href="([^"]*(?:redirect_url=|http[^"]*\.onion)[^"]*)"[^>]*>(.*?)</a>`)
var redirectRe = regexp.MustCompile(`redirect_url=([^&"]+)`)

func searchAhmia(query string) []Result {
	// Ahmia redirects clearnet-over-Tor to its onion; hit the onion directly.
	html, err := fetchT("http://juhanurmihxlp77nkq76byazcldy2hlmovfu2epvl5ankdibsot4csyd.onion/search/?q="+urlEncode(query), 20*time.Second)
	if err != nil {
		return nil
	}
	var results []Result
	seen := map[string]bool{}
	for _, m := range ahmiaRe.FindAllStringSubmatch(html, -1) {
		u := m[1]
		if loc := redirectRe.FindStringSubmatch(u); loc != nil {
			u = urlDecode(loc[1])
		}
		title := stripTags(m[2])
		if !strings.Contains(u, ".onion") || title == "" || seen[u] {
			continue
		}
		seen[u] = true
		results = append(results, Result{URL: u, Title: title, Source: "onion"})
	}
	return capResults(results, 50)
}

var (
	btBlockRe = regexp.MustCompile(`(?is)<div class="one_result".*?</div>\s*</div>`)
	btNameRe  = regexp.MustCompile(`(?is)<div class="torrent_name"[^>]*>.*?<a[^>]*>(.*?)</a>`)
	btMagRe   = regexp.MustCompile(`href="(magnet:\?[^"]+)"`)
	btSizeRe  = regexp.MustCompile(`(?is)<span class="torrent_size"[^>]*>(.*?)</span>`)
)

func searchBTDigg(query string) []Result {
	html, err := fetch("https://btdig.com/search?q=" + urlEncode(query))
	if err != nil {
		return nil
	}
	var results []Result
	for _, block := range btBlockRe.FindAllString(html, -1) {
		name := btNameRe.FindStringSubmatch(block)
		mag := btMagRe.FindStringSubmatch(block)
		if name == nil || mag == nil {
			continue
		}
		title := stripTags(name[1])
		snippet := ""
		if size := btSizeRe.FindStringSubmatch(block); size != nil {
			snippet = "size: " + stripTags(size[1])
		}
		results = append(results, Result{URL: mag[1], Title: title, Snippet: snippet, Source: "torrent"})
	}
	return capResults(results, 50)
}

func capResults(r []Result, max int) []Result {
	if len(r) > max {
		return r[:max]
	}
	return r
}

func truncate(s string, n int) string {
	if len(s) > n {
		return s[:n]
	}
	return s
}
