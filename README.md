<div align="center">

<img src="build/appicon.png" alt="Ghoster" width="160">

# Ghoster

**Anonymous browser. Tor built-in. No traces.**

*memento*

[![Go](https://img.shields.io/badge/Go-1.26-00ADD8?logo=go&logoColor=white)](https://go.dev)
[![Engine](https://img.shields.io/badge/engine-WebKit-blue)](https://webkit.org)
[![Tor](https://img.shields.io/badge/network-Tor%20only-7D4698)](https://www.torproject.org)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)

</div>

---

Ghoster is a browser that only speaks through Tor. It is written entirely in **Go**
and renders with **WebKit** — no Chromium, no Google, no telemetry. Every request
passes through a local Go proxy that strips identifying headers, spoofs your
operating system and nationality, and poisons the fingerprinting APIs before the
page ever sees you.

## Highlights

- **Tor-only networking.** No direct connections. If Tor is down, nothing loads.
- **memento search** — a built-in engine that queries the clear web, onion services, and torrents at once, storing nothing.
- **Phantom / Stealth modes.** Appear as an OS that doesn't exist, or blend in as Firefox on Windows.
- **23 nationalities** (plus auto-randomize) with matching language, timezone, and jittered geolocation.
- **Fingerprint poisoning** on canvas, WebGL, WebGPU, audio, fonts, sensors, and 15 other vectors.
- **No cookies, ever** — `Set-Cookie` is deleted from every response before the page sees it.
- **New Identity** in one click — rotates the session identity and reloads the page.

## How it works

```
WebKit webview (Wails)
      │  iframe → http://127.0.0.1:8888/browse?url=...
      ▼
Go sanitizing proxy  ─── strips Client Hints, X-Frame-Options, cookies
      │                  rewrites User-Agent (phantom/stealth)
      │                  injects nuke.js fingerprint poison
      ▼
Tor SOCKS5 (127.0.0.1:9050)
      ▼
   internet
```

The proxy also strips `X-Frame-Options` and CSP so pages render in-app, and rewrites
every link so navigation can never escape the proxy and hit the network directly.

## memento

One query, three worlds. Search sources run in parallel, each on **its own Tor
circuit** (via SOCKS credential isolation), so the engines never share an exit IP and
cannot rate-limit each other. Results are merged round-robin and deduplicated, so a
dead engine thins the list instead of emptying it.

| Source | Index | Notes |
|---|---|---|
| Brave | clear web | ~20 results per query |
| DuckDuckGo | clear web | ~10 per query; pagination is blocked over Tor |
| Marginalia | clear web | independent crawler, 2 pages fetched — surfaces the small web |
| TorDex | onion | ~50 per page, 2 pages fetched |
| Ahmia | onion | used when its backend is reachable |
| BTDigg | torrents | magnet links, 3 pages fetched |

A 429 or 403 from any engine is retried on a **fresh circuit** rather than reported as
"no results". Sponsored slots are dropped, never rendered as hits.

## Identity

| Mode | What sites see |
|---|---|
| **Phantom** | `Mozilla/5.0 (PhantomOS 1.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0 Ghoster/1.0.1` — an OS that does not exist |
| **Stealth** | `Mozilla/5.0 (Windows NT 10.0; rv:128.0) Gecko/20100101 Firefox/128.0` — one face in the Tor Browser crowd |

Client Hints (`Sec-Ch-Ua*`), `X-Client-Data`, `X-Forwarded-For`, `Forwarded`, and `Via`
are deleted on the way out; `Set-Cookie` is deleted on the way back.

### What Ghoster does not do

Ghoster gives you Tor plus a consistent set of lies about your machine. It does not
make you invisible. A global adversary correlating traffic, a logged-in account, or
anything you type yourself will still identify you. Circuit isolation currently
applies to search; page loads share the browsing proxy's Tor dialer, so requests in
one session can leave through the same exit node.

## Requirements

- Go ≥ 1.26
- [Wails v2](https://wails.io) — `go install github.com/wailsapp/wails/v2/cmd/wails@latest`
- Tor listening on `127.0.0.1:9050` — `brew install tor && brew services start tor`

## Build

```bash
./build.sh
```

Output: `build/bin/Ghoster.app`

> **macOS SDK note:** the default 27.0 SDK ships malformed `.tbd` framework files that
> break CGo linking (`arm64e.x1` unknown architecture). `build.sh` auto-selects a
> working SDK (26.5 / 15.5). Building manually? Set `SDKROOT` yourself.

## Dev

```bash
export SDKROOT=/Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk
wails dev
```

## Tests

```bash
go test ./...                                  # offline: parsers vs saved pages
GHOSTER_LIVE=1 go test ./search -run Live -v   # live: real engines over Tor
```

The parser tests run against fixtures in `search/testdata/`, so when a search engine
changes its markup the test fails instead of the app quietly showing nothing.

## Layout

| Path | Role |
|---|---|
| `main.go` | Wails app + WebKit configuration |
| `app.go` | Go backend bound to the frontend |
| `proxy/proxy.go` | Local proxy → Tor, header stripping, UA spoofing |
| `proxy/browse.go` | `/browse?url=` renderer — frame-header stripping, URL rewriting, injection |
| `proxy/nuke.js` | Fingerprint poison injected ahead of every site script |
| `search/search.go` | memento multi-source engine |
| `search/countries.go` | nationalities with geo / language / timezone data |
| `frontend/` | UI — tabs, toolbar, panels, memento |

## License

MIT — spaceman y2k38
