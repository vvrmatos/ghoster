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
- **PhantomOS identity only.** Sites always receive Ghoster's PhantomOS user agent; there is no Stealth mode.
- **Site JavaScript off by default.** Enable it explicitly per tab from the security panel; new tabs, Home, New Identity, and app restarts return to off.
- **23 nationalities** (plus auto-randomize) with matching language, timezone, and jittered geolocation.
- **Fingerprint poisoning** on canvas, WebGL, WebGPU, audio, fonts, sensors, and 15 other vectors.
- **No cookies, ever** — `Set-Cookie` is deleted from every response before the page sees it.
- **New Identity** in one click — rotates the session identity and reloads the page.

## How it works

```
WebKit webview (Wails)
      │  page → /browse?url=...  resources → /asset?url=...
      ▼
Pooled Go gateway  ─── strips Client Hints, X-Frame-Options, cookies
      │                rewrites navigation + CSS resource URLs
      │                syncs address/title with postMessage
      │                injects nuke.js fingerprint poison
      ▼
Tor SOCKS5 (127.0.0.1:9050)
      ▼
   internet
```

The gateway follows redirects, strips `X-Frame-Options` and CSP, rewrites links,
forms, frames, media, scripts, stylesheets, `srcset`, CSS `url()` and meta-refresh
targets to absolute local gateway URLs, and reports the logical URL/title back to
the browser chrome after navigation. Its shared transport reuses Tor connections
instead of building a new transport for every resource.

## memento

One query, three worlds. The UI shows **20 results per page** with prev / next.
The fast tier races Mwmbl, Brave, and DuckDuckGo and paints as soon as 20 useful
hits arrive; Bing and Marginalia merge behind it without moving those first 20.
Dark sources load independently. Clicking next fetches further Bing, Marginalia,
TorDex, and BTDigg pages until the visible page is full or the sources end.

Successful pages live in a **15-minute memory-only cache**. Refreshing the same
query therefore gives the same ordering and result set immediately instead of
rolling the dice on a new collection of Tor exits. The cache never touches disk
and **New Identity** clears it. The toolbar refresh button and `Cmd/Ctrl+R`
both rerun the current search; dark-web and torrent sources fill in behind the
web results and cannot delay the first page.

| Source | Index | Notes |
|---|---|---|
| Brave | clear web | ~20 results, first page only (further offsets 429 over Tor) |
| DuckDuckGo | clear web | ~10 per query; pagination is blocked over Tor |
| Bing | clear web | 10 per page, walks `&first=` on each Next |
| Mwmbl | clear web | independent JSON index, first page |
| Marginalia | clear web | independent crawler, one page per Next |
| TorDex | onion | ~50 per page, one page per Next |
| Ahmia | onion | first page, when its backend is reachable |
| BTDigg | torrents | 10 magnets per page, one page per Next |

A 429 or 403 from any engine is retried on a **fresh circuit** rather than reported as
"no results". Sponsored slots are dropped, never rendered as hits.

## Navigation

| Shortcut | Action |
|---|---|
| `Cmd/Ctrl+L` | focus and select the address bar |
| `Cmd/Ctrl+R` | reload the current page or rerun the current search |
| `Cmd/Ctrl+T` | new tab |
| `Cmd/Ctrl+Shift+T` | reopen the last closed tab |
| `Cmd/Ctrl+W` | close tab |
| `Cmd/Ctrl+1…8` | switch to a numbered tab |
| `Cmd/Ctrl+9` | switch to the last tab |
| `Ctrl+Tab / Ctrl+Shift+Tab` | cycle tabs forward / backward |
| `Cmd+[ / Cmd+]` or `Alt+← / Alt+→` | back / forward |
| `Shift+F10` | open the Ghoster context menu |

Cmd/Ctrl-click and middle-click open links in a background Ghoster tab;
`target=_blank` and `window.open()` open a foreground Ghoster tab instead of an
external browser. Right-click provides link open/copy, selection copy,
back/forward/reload, duplicate tab, copy page address, new/reopen/close tab actions.

## Identity and JavaScript

Sites always see:

`Mozilla/5.0 (PhantomOS 1.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0 Ghoster/1.0.1`

Site JavaScript is removed and blocked by a nonce CSP unless the user explicitly
enables it for that tab. Ghoster's own nonce-authorized privacy/navigation bridge
continues running while site JavaScript is off, so fingerprint poisoning,
address/title synchronization, and browser shortcuts still work. Enabling site
JavaScript propagates only through that tab's navigations.

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
./scripts/ci-policy.sh
go vet ./proxy ./search
go test -race ./proxy ./search
cd frontend && npm ci && npm test && npm run build

# Optional: real external engines through a running Tor daemon
GHOSTER_LIVE=1 go test ./search \
  -run 'TestFastLive|TestSearchPageLive' -count=1 -v -timeout=10m
```

`.github/workflows/ci.yml` runs policy checks, race tests, a 45% core coverage
floor, frontend history tests, the production bundle, and a real macOS Wails
package build on every push and pull request. `.github/workflows/live-tor-smoke.yml`
is manual because Tor exits and third-party engines are external and inherently
flaky; it starts a fresh Tor daemon and exercises the real search sources.

Parser fixtures catch upstream markup changes without network access. Gateway
integration tests cover redirects, permanent Phantom headers, cookie stripping,
absolute link/resource rewriting, JavaScript default-off CSP, and explicit JS opt-in.

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

MIT — © 2026 Ghoster
