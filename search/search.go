// Package search is memento: a multi-source, zero-storage search engine that
// aggregates clearnet (DuckDuckGo, Brave, Marginalia), onion (Ahmia), and
// torrent (BTDigg) results, all fetched through Tor.
package search

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"html"
	"io"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
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
	Page    int      `json:"page"`
	HasMore bool     `json:"hasMore"`
}

const cacheTTL = 15 * time.Minute

type cachedResults struct {
	results Results
	expires time.Time
}

type resultFlight struct {
	done    chan struct{}
	results Results
}

var sessionCache = struct {
	sync.RWMutex
	items   map[string]cachedResults
	flights map[string]*resultFlight
}{
	items:   make(map[string]cachedResults),
	flights: make(map[string]*resultFlight),
}

func cacheKey(kind, query string, page int) string {
	return kind + "\x00" + strings.ToLower(strings.TrimSpace(query)) + "\x00" + itoa(page)
}

func cacheGet(key string) (Results, bool) {
	sessionCache.RLock()
	entry, ok := sessionCache.items[key]
	sessionCache.RUnlock()
	if !ok || time.Now().After(entry.expires) {
		if ok {
			sessionCache.Lock()
			delete(sessionCache.items, key)
			sessionCache.Unlock()
		}
		return Results{}, false
	}
	return entry.results, true
}

func cachePut(key string, results Results) {
	sessionCache.Lock()
	sessionCache.items[key] = cachedResults{results: results, expires: time.Now().Add(cacheTTL)}
	sessionCache.Unlock()
}

// cachedCall returns a cached result or joins the one in-flight request for
// this query/page. Repeated refreshes cannot fan out duplicate Tor searches.
func cachedCall(key string, valid func(Results) bool, load func() Results) Results {
	if cached, ok := cacheGet(key); ok {
		return cached
	}

	sessionCache.Lock()
	if flight, ok := sessionCache.flights[key]; ok {
		sessionCache.Unlock()
		<-flight.done
		return flight.results
	}
	flight := &resultFlight{done: make(chan struct{})}
	sessionCache.flights[key] = flight
	sessionCache.Unlock()

	results := load()

	sessionCache.Lock()
	flight.results = results
	if valid(results) {
		sessionCache.items[key] = cachedResults{results: results, expires: time.Now().Add(cacheTTL)}
	}
	delete(sessionCache.flights, key)
	close(flight.done)
	sessionCache.Unlock()
	return results
}

// ClearCache drops the in-memory search cache. Nothing is persisted to disk.
func ClearCache() {
	sessionCache.Lock()
	clear(sessionCache.items)
	sessionCache.Unlock()
}

// circuit returns a random SOCKS credential. Tor's IsolateSOCKSAuth (on by
// default) gives every distinct user/pass its own circuit and exit node, so
// each engine — and each retry — looks like a different visitor and the
// engines never share a rate limit.
func circuit() string {
	b := make([]byte, 8)
	if _, err := rand.Read(b); err != nil {
		return "g"
	}
	return hex.EncodeToString(b)
}

func torClient(timeout time.Duration, circ string) *http.Client {
	auth := &proxy.Auth{User: circ, Password: circ}
	dialer, err := proxy.SOCKS5("tcp", "127.0.0.1:9050", auth, &net.Dialer{Timeout: timeout})
	if err != nil {
		return &http.Client{Timeout: timeout}
	}
	return &http.Client{
		Transport: &http.Transport{Dial: dialer.Dial},
		Timeout:   timeout,
	}
}

// fetchT fetches over a fresh Tor circuit. timeout is the TOTAL retry budget,
// not a per-attempt timeout. A dead engine cannot stall a search for three
// times the advertised duration.
func fetchT(url string, timeout time.Duration) (string, error) {
	var lastErr error
	deadline := time.Now().Add(timeout)
	for attempt := 0; attempt < 3; attempt++ {
		remaining := time.Until(deadline)
		if remaining <= 0 {
			break
		}
		attemptTimeout := min(remaining, 8*time.Second)
		body, code, err := fetchOnce(url, attemptTimeout, circuit())
		if err != nil {
			lastErr = err
			continue
		}
		if code == 429 || code == 403 || code >= 500 {
			lastErr = fmt.Errorf("%s: http %d", url, code)
			delay := time.Duration(attempt+1) * 500 * time.Millisecond
			if time.Until(deadline) <= delay {
				break
			}
			time.Sleep(delay)
			continue
		}
		return body, nil
	}
	if lastErr == nil {
		lastErr = fmt.Errorf("%s: timeout after %s", url, timeout)
	}
	return "", lastErr
}

func fetchOnce(url string, timeout time.Duration, circ string) (string, int, error) {
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return "", 0, err
	}
	req.Header.Set("User-Agent", ua)
	req.Header.Set("Accept-Language", "en-US,en;q=0.5")
	resp, err := torClient(timeout, circ).Do(req)
	if err != nil {
		return "", 0, err
	}
	defer resp.Body.Close()
	b, err := io.ReadAll(resp.Body)
	return string(b), resp.StatusCode, err
}

func fetch(url string) (string, error) { return fetchT(url, 12*time.Second) }

var tagRe = regexp.MustCompile(`<[^>]+>`)

func stripTags(s string) string {
	s = tagRe.ReplaceAllString(s, " ")
	s = html.UnescapeString(s)
	return strings.TrimSpace(spaceRe.ReplaceAllString(s, " "))
}

var spaceRe = regexp.MustCompile(`\s+`)

// isAd rejects sponsored slots and engine-internal redirectors, which are the
// only "results" that ever survive the parsers without being real pages.
func isAd(u string) bool {
	for _, bad := range []string{"duckduckgo.com/y.js", "bing.com/aclick", "/aclk?", "ad_provider=", "googleadservices."} {
		if strings.Contains(u, bad) {
			return true
		}
	}
	return false
}

// dedupeKey normalizes a URL so the same page from two engines collapses.
func dedupeKey(raw string) string {
	u, err := url.Parse(raw)
	if err != nil {
		return raw
	}
	host := strings.TrimPrefix(strings.ToLower(u.Host), "www.")
	path := strings.TrimSuffix(u.Path, "/")
	return host + path + "?" + u.RawQuery
}

// interleave merges per-engine result lists round-robin so the first page the
// user sees comes from every engine, not just the fastest one.
func interleave(lists [][]Result) []Result {
	seen := map[string]bool{}
	var out []Result
	for i := 0; ; i++ {
		added := false
		for _, l := range lists {
			if i >= len(l) {
				continue
			}
			added = true
			k := dedupeKey(l[i].URL)
			if seen[k] {
				continue
			}
			seen[k] = true
			out = append(out, l[i])
		}
		if !added {
			return out
		}
	}
}

// SearchPage fetches one page of clearnet results. Page 1 hits every engine
// that does not paginate (Brave, DuckDuckGo, Mwmbl) plus the first Bing and
// Marginalia pages. Later pages walk Bing (10 hits each) and Marginalia.
//
// Every job is waited on — there is no deadline that silently drops an engine,
// which is what made the result count jump from 25 to 70 to 197 on the same
// query. Each fetch still has its own timeout and circuit retries.
func clampPage(page int) int {
	if page < 1 {
		return 1
	}
	return page
}

// SearchFast returns the first useful first-page result set instead of waiting
// for every engine. Brave, DuckDuckGo, and Mwmbl race in parallel; as soon as
// at least 20 hits are available the UI can paint. The result is session-cached
// so refresh remains stable.
func SearchFast(query string) Results {
	key := cacheKey("fast", query, 1)
	return cachedCall(key,
		func(r Results) bool { return len(r.Web) >= 10 },
		func() Results {
			web := firstUseful([]func() []Result{
				func() []Result { return searchMwmbl(query) },
				func() []Result { return searchBrave(query) },
				func() []Result { return searchDDG(query) },
			}, 4*time.Second, 20)
			return Results{Query: query, Page: 1, Web: web, HasMore: len(web) >= 10}
		})
}

func SearchPage(query string, page int) Results {
	page = clampPage(page)
	key := cacheKey("web", query, page)
	return cachedCall(key,
		func(r Results) bool { return len(r.Web) >= 8 },
		func() Results {
			jobs := []func() []Result{
				func() []Result { return searchBing(query, 1+(page-1)*10) },
				func() []Result { return searchMarginalia(query, page) },
			}
			web, more := waitAll(jobs)
			return Results{Query: query, Page: page, Web: web, HasMore: more}
		})
}

// SearchDarkPage fetches one page of onion + torrent results.
func SearchDarkPage(query string, page int) Results {
	page = clampPage(page)
	key := cacheKey("dark", query, page)
	return cachedCall(key,
		func(r Results) bool { return len(r.Onion)+len(r.Torrent) >= 8 },
		func() Results {
			var onion, torrent []Result
			var wg sync.WaitGroup
			var tordex, ahmia []Result
			jobs := 2
			if page == 1 {
				jobs++
			}
			wg.Add(jobs)
			go func() { defer wg.Done(); tordex = searchTordex(query, page) }()
			if page == 1 {
				go func() { defer wg.Done(); ahmia = searchAhmia(query) }()
			}
			go func() { defer wg.Done(); torrent = btdiggPage(query, page-1) }()
			wg.Wait()
			onion = interleave([][]Result{tordex, ahmia})
			more := len(onion) >= 8 || len(torrent) >= 8
			return Results{Query: query, Page: page, Onion: onion, Torrent: torrent, HasMore: more}
		})
}

// SearchWeb aggregates both first-page tiers (kept for older callers).
func SearchWeb(query string) Results {
	var fast, paged Results
	var wg sync.WaitGroup
	wg.Add(2)
	go func() { defer wg.Done(); fast = SearchFast(query) }()
	go func() { defer wg.Done(); paged = SearchPage(query, 1) }()
	wg.Wait()
	return Results{
		Query:   query,
		Page:    1,
		Web:     interleave([][]Result{fast.Web, paged.Web}),
		HasMore: fast.HasMore || paged.HasMore,
	}
}

// SearchMore is page 2 of the clearnet engines (kept for older callers).
func SearchMore(query string) Results { return SearchPage(query, 2) }

// waitAll runs every job to completion and merges the lists. hasMore is true
// when at least one engine returned a full-looking page, so the UI can offer
// a Next button instead of guessing.
func waitAll(jobs []func() []Result) ([]Result, bool) {
	lists := make([][]Result, len(jobs))
	var wg sync.WaitGroup
	wg.Add(len(jobs))
	for i, job := range jobs {
		go func(i int, job func() []Result) {
			defer wg.Done()
			lists[i] = job()
		}(i, job)
	}
	wg.Wait()
	more := false
	for _, l := range lists {
		if len(l) >= 8 {
			more = true
			break
		}
	}
	return interleave(lists), more
}

func firstUseful(jobs []func() []Result, deadline time.Duration, minimum int) []Result {
	results := make(chan []Result, len(jobs))
	for _, job := range jobs {
		go func(job func() []Result) { results <- job() }(job)
	}
	var lists [][]Result
	timer := time.NewTimer(deadline)
	defer timer.Stop()
	for range jobs {
		select {
		case result := <-results:
			if len(result) > 0 {
				lists = append(lists, result)
			}
			merged := interleave(lists)
			if len(merged) >= minimum {
				return merged
			}
		case <-timer.C:
			return interleave(lists)
		}
	}
	return interleave(lists)
}

// SearchDark is page 1 of the dark sources (kept for older callers).
func SearchDark(query string) Results { return SearchDarkPage(query, 1) }

// Search runs all sources (kept for compatibility).
func Search(query string) Results {
	out := Results{Query: query}
	var wg sync.WaitGroup
	wg.Add(3)
	go func() { defer wg.Done(); out.Web = SearchWeb(query).Web }()
	go func() { defer wg.Done(); out.Onion = searchAhmia(query) }()
	go func() { defer wg.Done(); out.Torrent = searchBTDigg(query) }()
	wg.Wait()
	return out
}

var (
	ddgResultRe = regexp.MustCompile(`(?is)<a[^>]*class="result__a"[^>]*>.*?</a>`)
	ddgHrefRe   = regexp.MustCompile(`(?is)href="([^"]+)"`)
	ddgSnipRe   = regexp.MustCompile(`(?is)<a[^>]+class="result__snippet"[^>]*>(.*?)</a>`)
	uddgRe      = regexp.MustCompile(`uddg=([^&]+)`)
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
		if !strings.HasPrefix(u, "http") || title == "" || seen[u] || isAd(u) {
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

var (
	braveHrefRe  = regexp.MustCompile(`(?is)<a href="(https?://[^"]+)"`)
	braveTitleRe = regexp.MustCompile(`(?is)<div class="title search-snippet-title[^"]*"[^>]*>(.*?)</div>`)
	braveSnipRe  = regexp.MustCompile(`(?is)<div class="content [^"]*"[^>]*>(.*?)</div>`)
)

// searchBrave scrapes Brave Search, which serves its own index and answers
// plain HTML over Tor (20 hits per query, no CAPTCHA).
func searchBrave(query string) []Result {
	h, err := fetchT("https://search.brave.com/search?q="+urlEncode(query), 12*time.Second)
	if err != nil {
		return nil
	}
	return parseBrave(h)
}

func parseBrave(h string) []Result {
	var results []Result
	seen := map[string]bool{}
	for _, chunk := range strings.Split(h, `data-type="web"`)[1:] {
		hm := braveHrefRe.FindStringSubmatch(chunk)
		if hm == nil {
			continue
		}
		u := hm[1]
		if strings.Contains(u, "imgs.search.brave.com") || seen[u] {
			continue
		}
		tm := braveTitleRe.FindStringSubmatch(chunk)
		if tm == nil {
			continue
		}
		title := stripTags(tm[1])
		if title == "" {
			continue
		}
		seen[u] = true
		r := Result{URL: u, Title: title, Source: "web"}
		if sm := braveSnipRe.FindStringSubmatch(chunk); sm != nil {
			r.Snippet = truncate(stripTags(sm[1]), 200)
		}
		results = append(results, r)
	}
	return results
}

var (
	bingBlockRe = regexp.MustCompile(`(?is)<li class="b_algo".*?(?:</li>|$)`)
	bingTitleRe = regexp.MustCompile(`(?is)<h2[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>(.*?)</a>`)
	bingSnipRe  = regexp.MustCompile(`(?is)<p class="b_lineclamp[^"]*"[^>]*>(.*?)</p>`)
	bingRedirRe = regexp.MustCompile(`u=a1([A-Za-z0-9_-]+)`)
)

// searchBing walks Bing 10 hits at a time. Its ck/a links hide the real URL in
// a base64 "u=a1…" parameter, which is decoded back to the destination so no
// click ever passes through Bing.
func searchBing(query string, first int) []Result {
	u := "https://www.bing.com/search?q=" + urlEncode(query) + "&setmkt=en-US&setlang=en"
	if first > 1 {
		u += "&first=" + itoa(first)
	}
	h, err := fetchT(u, 12*time.Second)
	if err != nil {
		return nil
	}
	return parseBing(h)
}

func parseBing(h string) []Result {
	var results []Result
	seen := map[string]bool{}
	for _, block := range bingBlockRe.FindAllString(h, -1) {
		tm := bingTitleRe.FindStringSubmatch(block)
		if tm == nil {
			continue
		}
		u := bingURL(tm[1])
		title := stripTags(tm[2])
		if u == "" || title == "" || seen[u] || isAd(u) {
			continue
		}
		seen[u] = true
		r := Result{URL: u, Title: title, Source: "web"}
		if sm := bingSnipRe.FindStringSubmatch(block); sm != nil {
			r.Snippet = truncate(stripTags(sm[1]), 200)
		}
		results = append(results, r)
	}
	return results
}

func bingURL(raw string) string {
	raw = html.UnescapeString(raw)
	if m := bingRedirRe.FindStringSubmatch(raw); m != nil {
		if b, err := base64.RawURLEncoding.DecodeString(strings.TrimRight(m[1], "=")); err == nil {
			raw = string(b)
		}
	}
	if !strings.HasPrefix(raw, "http") || strings.Contains(raw, "bing.com/") {
		return ""
	}
	return raw
}

// mwmblResult mirrors the api.mwmbl.org response: an independent, community
// crawled index that answers JSON without blocking Tor.
type mwmblResult struct {
	URL     string                   `json:"url"`
	Title   []struct{ Value string } `json:"title"`
	Extract []struct{ Value string } `json:"extract"`
}

func searchMwmbl(query string) []Result {
	body, err := fetchT("https://api.mwmbl.org/api/v1/search/?s="+urlEncode(query), 12*time.Second)
	if err != nil {
		return nil
	}
	var raw []mwmblResult
	if json.Unmarshal([]byte(body), &raw) != nil {
		return nil
	}
	var results []Result
	for _, r := range raw {
		title := ""
		for _, t := range r.Title {
			title += t.Value
		}
		if !strings.HasPrefix(r.URL, "http") || strings.TrimSpace(title) == "" {
			continue
		}
		snippet := ""
		for _, e := range r.Extract {
			snippet += e.Value
		}
		results = append(results, Result{
			URL:     r.URL,
			Title:   stripTags(title),
			Snippet: truncate(stripTags(snippet), 200),
			Source:  "web",
		})
	}
	return results
}

var marginaliaRe = regexp.MustCompile(`(?is)<section[^>]*class="card search-result"[^>]*>(.*?)</section>`)
var margTitleRe = regexp.MustCompile(`(?is)<a[^>]*class="title"[^>]*href="([^"]+)"[^>]*>(.*?)</a>`)
var margDescRe = regexp.MustCompile(`(?is)<p class="description">(.*?)</p>`)

// searchMarginalia queries Marginalia, an independent crawler that surfaces the
// small/old web the big engines bury. It allows deep pagination over Tor.
func searchMarginalia(query string, page int) []Result {
	u := "https://old-search.marginalia.nu/search?query=" + urlEncode(query)
	if page > 1 {
		u += "&page=" + itoa(page)
	}
	h, err := fetchT(u, 12*time.Second)
	if err != nil {
		return nil
	}
	return parseMarginalia(h)
}

func parseMarginalia(h string) []Result {
	var results []Result
	for _, m := range marginaliaRe.FindAllStringSubmatch(h, -1) {
		tm := margTitleRe.FindStringSubmatch(m[1])
		if tm == nil {
			continue
		}
		r := Result{URL: tm[1], Title: stripTags(tm[2]), Source: "web"}
		if r.Title == "" {
			continue
		}
		if dm := margDescRe.FindStringSubmatch(m[1]); dm != nil {
			r.Snippet = truncate(stripTags(dm[1]), 200)
		}
		results = append(results, r)
	}
	return results
}

var (
	tordexBlockRe = regexp.MustCompile(`(?is)<div class="result[^"]*">(.*?)</div>\s*</div>`)
	tordexTitleRe = regexp.MustCompile(`(?is)<h5 id="title"[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>(.*?)</a>`)
	tordexDescRe  = regexp.MustCompile(`(?is)<p id="desc"[^>]*>(.*?)</p>`)
)

// searchTordex queries TorDex, an onion index that stays up when Ahmia does not.
func searchTordex(query string, page int) []Result {
	u := "http://tordexu73joywapk2txdr54jed4imqledpcvcuf75qsas2gwdgksvnyd.onion/search?query=" + urlEncode(query)
	if page > 1 {
		u += "&page=" + itoa(page)
	}
	h, err := fetchT(u, 35*time.Second)
	if err != nil {
		return nil
	}
	return parseTordex(h)
}

func parseTordex(h string) []Result {
	var results []Result
	seen := map[string]bool{}
	for _, m := range tordexBlockRe.FindAllStringSubmatch(h, -1) {
		tm := tordexTitleRe.FindStringSubmatch(m[1])
		if tm == nil || !strings.Contains(tm[1], ".onion") || seen[tm[1]] {
			continue
		}
		title := stripTags(tm[2])
		if title == "" {
			continue
		}
		seen[tm[1]] = true
		r := Result{URL: tm[1], Title: title, Source: "onion"}
		if dm := tordexDescRe.FindStringSubmatch(m[1]); dm != nil {
			r.Snippet = truncate(stripTags(dm[1]), 200)
		}
		results = append(results, r)
	}
	return results
}

var ahmiaRe = regexp.MustCompile(`(?is)<a[^>]+href="([^"]*(?:redirect_url=|http[^"]*\.onion)[^"]*)"[^>]*>(.*?)</a>`)
var redirectRe = regexp.MustCompile(`redirect_url=([^&"]+)`)

func searchAhmia(query string) []Result {
	// Ahmia redirects clearnet-over-Tor to its onion; hit the onion directly.
	// The onion 504s on bad circuits, so give it a second shot.
	var page string
	for attempt := 0; attempt < 2 && page == ""; attempt++ {
		h, err := fetchT("http://juhanurmihxlp77nkq76byazcldy2hlmovfu2epvl5ankdibsot4csyd.onion/search/?q="+urlEncode(query), 25*time.Second)
		if err == nil && strings.Contains(h, "redirect_url=") {
			page = h
		}
	}
	if page == "" {
		return nil
	}
	var results []Result
	seen := map[string]bool{}
	for _, m := range ahmiaRe.FindAllStringSubmatch(page, -1) {
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
	btNameRe = regexp.MustCompile(`(?is)<div class="torrent_name"[^>]*>.*?<a[^>]*>(.*?)</a>`)
	btMagRe  = regexp.MustCompile(`href="(magnet:\?[^"]+)"`)
	btSizeRe = regexp.MustCompile(`(?is)<div class="torrent_size"[^>]*>(.*?)</div>`)
)

func searchBTDigg(query string) []Result {
	pages := make([][]Result, 3)
	var wg sync.WaitGroup
	wg.Add(len(pages))
	for i := range pages {
		go func(i int) { defer wg.Done(); pages[i] = btdiggPage(query, i) }(i)
	}
	wg.Wait()
	return capResults(interleave(pages), 50)
}

func btdiggPage(query string, page int) []Result {
	u := "https://btdig.com/search?q=" + urlEncode(query)
	if page > 0 {
		u += "&p=" + itoa(page)
	}
	h, err := fetchT(u, 20*time.Second)
	if err != nil {
		return nil
	}
	return parseBTDigg(h)
}

// parseBTDigg walks each one_result block. The blocks nest dozens of file-tree
// divs, so they are split on the class marker rather than matched as a unit.
func parseBTDigg(h string) []Result {
	var results []Result
	for _, block := range strings.Split(h, `class="one_result"`)[1:] {
		name := btNameRe.FindStringSubmatch(block)
		mag := btMagRe.FindStringSubmatch(block)
		if name == nil || mag == nil {
			continue
		}
		title := stripTags(name[1])
		if title == "" {
			continue
		}
		snippet := ""
		if size := btSizeRe.FindStringSubmatch(block); size != nil {
			snippet = "size: " + stripTags(size[1])
		}
		results = append(results, Result{
			URL:     html.UnescapeString(mag[1]),
			Title:   title,
			Snippet: snippet,
			Source:  "torrent",
		})
	}
	return capResults(results, 50)
}

func capResults(r []Result, max int) []Result {
	if len(r) > max {
		return r[:max]
	}
	return r
}

func itoa(n int) string { return strconv.Itoa(n) }

func truncate(s string, n int) string {
	if len(s) > n {
		return s[:n]
	}
	return s
}
