package main

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"math/big"

	"ghoster/proxy"
	"ghoster/search"
)

// App is the Wails backend, bound to the frontend via JS bindings.
type App struct {
	ctx         context.Context
	prox        *proxy.Proxy
	sessionHash string
	country     string
}

// NewApp creates the app and starts the local sanitizing proxy.
func NewApp() *App {
	p, _ := proxy.New()
	buf := make([]byte, 32)
	rand.Read(buf)
	return &App{
		prox:        p,
		sessionHash: hex.EncodeToString(buf),
		country:     "auto",
	}
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	if a.prox != nil {
		_ = a.prox.Start("8888")
	}
}

// ── Bound methods (callable from JS) ──

// TorStatus reports whether Tor's SOCKS port is reachable.
func (a *App) TorStatus() bool {
	return proxy.CheckTor()
}

// ProxyAddr returns the local proxy address the webview should use.
func (a *App) ProxyAddr() string {
	if a.prox == nil {
		return ""
	}
	return a.prox.Addr()
}

// SessionHash returns the per-launch integrity hash.
func (a *App) SessionHash() string {
	return a.sessionHash
}

// VerifyIntegrity returns sha256 of the input.
func (a *App) VerifyIntegrity(data string) string {
	h := sha256.Sum256([]byte(data))
	return hex.EncodeToString(h[:])
}

// SetMode switches UA between "phantom" and "stealth".
func (a *App) SetMode(mode string) string {
	if mode == "stealth" {
		a.prox.SetMode(proxy.Stealth)
	} else {
		a.prox.SetMode(proxy.Phantom)
		mode = "phantom"
	}
	return mode
}

// NewIdentity rotates the session hash (frontend also clears storage).
func (a *App) NewIdentity() string {
	buf := make([]byte, 32)
	rand.Read(buf)
	a.sessionHash = hex.EncodeToString(buf)
	search.ClearCache()
	return a.sessionHash[:16]
}

// Countries returns the nationality list.
func (a *App) Countries() []search.Country {
	return search.Countries
}

// SetCountry updates the active nationality and proxy language.
func (a *App) SetCountry(code string) search.Country {
	a.country = code
	c := search.FindCountry(code)
	a.prox.SetLang(c.Lang)
	return c
}

// GetGeo returns randomized coordinates for the active (or random) country.
func (a *App) GetGeo() search.Country {
	c := search.FindCountry(a.country)
	if a.country == "auto" {
		// pick a random non-auto country
		n, _ := rand.Int(rand.Reader, big.NewInt(int64(len(search.Countries)-1)))
		c = search.Countries[n.Int64()+1]
	}
	// jitter ±0.25 deg
	c.Lat += jitter()
	c.Lng += jitter()
	return c
}

func jitter() float64 {
	n, _ := rand.Int(rand.Reader, big.NewInt(1000))
	return (float64(n.Int64())/1000.0 - 0.5) * 0.5
}

// Search runs the memento multi-source search.
func (a *App) Search(query string) search.Results {
	return search.Search(query)
}

// SearchWeb returns clearnet results fast (for instant render).
func (a *App) SearchWeb(query string) search.Results {
	return search.SearchWeb(query)
}

// SearchMore returns the deep pages of the clearnet engines.
func (a *App) SearchMore(query string) search.Results {
	return search.SearchMore(query)
}

// SearchPage returns one page of clearnet results. page is 1-based.
func (a *App) SearchPage(query string, page int) search.Results {
	return search.SearchPage(query, page)
}

// SearchDarkPage returns one page of onion + torrent results. page is 1-based.
func (a *App) SearchDarkPage(query string, page int) search.Results {
	return search.SearchDarkPage(query, page)
}

// SearchDark returns onion + torrent results (fetched after web).
func (a *App) SearchDark(query string) search.Results {
	return search.SearchDark(query)
}
