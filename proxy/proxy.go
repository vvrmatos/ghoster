// Package proxy is ghoster's privacy core: a local HTTP/HTTPS proxy that
// strips identifying headers, rewrites the User-Agent, and forwards every
// request through Tor's SOCKS5 port. The WebKit webview points at this proxy,
// so every byte the browser sends is sanitized before it reaches the network.
package proxy

import (
	"context"
	"crypto/tls"
	"io"
	"log"
	"net"
	"net/http"
	"sync"
	"time"

	"golang.org/x/net/proxy"
)

const (
	torSocks = "127.0.0.1:9050"
)

// Mode controls the spoofed identity.
type Mode int

const (
	Phantom Mode = iota
	Stealth
)

const (
	uaPhantom = "Mozilla/5.0 (PhantomOS 1.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0 Ghoster/1.0.1"
	uaStealth = "Mozilla/5.0 (Windows NT 10.0; rv:128.0) Gecko/20100101 Firefox/128.0"
)

// Headers that reveal the real browser/OS — stripped from every request.
var stripHeaders = []string{
	"Sec-Ch-Ua", "Sec-Ch-Ua-Platform", "Sec-Ch-Ua-Mobile",
	"Sec-Ch-Ua-Full-Version-List", "Sec-Ch-Ua-Arch",
	"Sec-Ch-Ua-Bitness", "Sec-Ch-Ua-Model",
	"Sec-Ch-Ua-Platform-Version", "Sec-Ch-Ua-Wow64",
	"Sec-Fetch-User", "X-Client-Data",
}

// Proxy is the local sanitizing proxy.
type Proxy struct {
	mu       sync.RWMutex
	mode     Mode
	lang     string
	dialer   proxy.Dialer
	server   *http.Server
	listener net.Listener
}

// New creates a proxy that forwards through Tor.
func New() (*Proxy, error) {
	dialer, err := proxy.SOCKS5("tcp", torSocks, nil, &net.Dialer{
		Timeout:   30 * time.Second,
		KeepAlive: 30 * time.Second,
	})
	if err != nil {
		return nil, err
	}
	return &Proxy{
		mode:   Phantom,
		lang:   "en-US,en;q=0.5",
		dialer: dialer,
	}, nil
}

// SetMode switches between phantom and stealth UA.
func (p *Proxy) SetMode(m Mode) {
	p.mu.Lock()
	p.mode = m
	p.mu.Unlock()
}

// SetLang updates the spoofed Accept-Language (for nationality switching).
func (p *Proxy) SetLang(lang string) {
	p.mu.Lock()
	p.lang = lang
	p.mu.Unlock()
}

func (p *Proxy) ua() string {
	p.mu.RLock()
	defer p.mu.RUnlock()
	if p.mode == Stealth {
		return uaStealth
	}
	return uaPhantom
}

func (p *Proxy) language() string {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return p.lang
}

// Addr returns the local listen address once started.
func (p *Proxy) Addr() string {
	if p.listener == nil {
		return ""
	}
	return p.listener.Addr().String()
}

// Start begins listening on 127.0.0.1:port (0 = random free port).
func (p *Proxy) Start(port string) error {
	ln, err := net.Listen("tcp", "127.0.0.1:"+port)
	if err != nil {
		return err
	}
	p.listener = ln
	p.server = &http.Server{
		Handler: http.HandlerFunc(p.handle),
	}
	go func() {
		if err := p.server.Serve(ln); err != nil && err != http.ErrServerClosed {
			log.Printf("proxy serve error: %v", err)
		}
	}()
	return nil
}

// Stop shuts the proxy down.
func (p *Proxy) Stop() error {
	if p.server != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		return p.server.Shutdown(ctx)
	}
	return nil
}

func (p *Proxy) handle(w http.ResponseWriter, r *http.Request) {
	// /browse?url= is the in-app rendering endpoint (iframe target)
	if r.URL.Path == "/browse" {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		p.serveBrowse(w, r)
		return
	}
	if r.Method == http.MethodConnect {
		p.handleConnect(w, r)
		return
	}
	p.handleHTTP(w, r)
}

// handleConnect handles HTTPS tunneling (CONNECT method).
// It opens a raw tunnel through Tor. Header stripping for HTTPS happens
// via the injected nuke.js (Client Hints are also disabled at the engine
// level), since the body is end-to-end encrypted.
func (p *Proxy) handleConnect(w http.ResponseWriter, r *http.Request) {
	destConn, err := p.dialer.Dial("tcp", r.Host)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	w.WriteHeader(http.StatusOK)

	hijacker, ok := w.(http.Hijacker)
	if !ok {
		http.Error(w, "hijack unsupported", http.StatusInternalServerError)
		destConn.Close()
		return
	}
	clientConn, _, err := hijacker.Hijack()
	if err != nil {
		destConn.Close()
		return
	}

	go transfer(destConn, clientConn)
	go transfer(clientConn, destConn)
}

// handleHTTP handles plain HTTP — strips headers and rewrites UA before forwarding.
func (p *Proxy) handleHTTP(w http.ResponseWriter, r *http.Request) {
	transport := &http.Transport{
		Dial:                p.dialer.Dial,
		TLSClientConfig:     &tls.Config{MinVersion: tls.VersionTLS12},
		TLSHandshakeTimeout: 15 * time.Second,
	}

	// Sanitize outgoing headers
	for _, h := range stripHeaders {
		r.Header.Del(h)
	}
	r.Header.Set("User-Agent", p.ua())
	r.Header.Set("Accept-Language", p.language())
	r.Header.Set("DNT", "1")
	r.Header.Del("X-Forwarded-For")
	r.Header.Del("Forwarded")
	r.Header.Del("Via")

	r.RequestURI = ""
	if r.URL.Scheme == "" {
		r.URL.Scheme = "http"
	}
	if r.URL.Host == "" {
		r.URL.Host = r.Host
	}

	resp, err := transport.RoundTrip(r)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()

	// Strip tracking cookies from responses
	resp.Header.Del("Set-Cookie")

	for k, vv := range resp.Header {
		for _, v := range vv {
			w.Header().Add(k, v)
		}
	}
	w.WriteHeader(resp.StatusCode)
	io.Copy(w, resp.Body)
}

func transfer(dst io.WriteCloser, src io.ReadCloser) {
	defer dst.Close()
	defer src.Close()
	io.Copy(dst, src)
}

// CheckTor returns true if Tor's SOCKS port is reachable.
func CheckTor() bool {
	conn, err := net.DialTimeout("tcp", torSocks, 800*time.Millisecond)
	if err != nil {
		return false
	}
	conn.Close()
	return true
}
