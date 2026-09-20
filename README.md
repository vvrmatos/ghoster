# Ghoster

**Anonymous browser. Tor built-in. No traces.**

Built entirely in **Go** with a **WebKit** engine (via Wails). No Chromium, no Google.

## Architecture

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

Every request the browser makes goes through the Go proxy, which sanitizes it and
forwards it through Tor. The proxy also strips `X-Frame-Options`/CSP so pages render
in-app, and injects fingerprint-poisoning JS into every page.

## Components

| File | Role |
|---|---|
| `proxy/proxy.go` | Local HTTP/HTTPS proxy → Tor, header stripping, UA spoofing |
| `proxy/browse.go` | `/browse?url=` rendering endpoint (frame-header stripping, URL rewriting, nuke.js) |
| `search/search.go` | memento multi-source engine (DuckDuckGo + Ahmia + BTDigg) through Tor |
| `search/countries.go` | 24 nationalities with geo/lang/tz data |
| `app.go` | Wails backend bound to the frontend |
| `main.go` | Wails app + WebKit config |
| `frontend/` | UI (tabs, toolbar, panels, memento) |

## Requirements

- Go ≥ 1.24
- [Wails v2](https://wails.io): `go install github.com/wailsapp/wails/v2/cmd/wails@latest`
- Tor on `127.0.0.1:9050`: `brew install tor && brew services start tor`

## Build

```bash
./build.sh
```

> **Note:** The default macOS 27.0 SDK ships malformed `.tbd` framework files that
> break CGo linking (`arm64e.x1` unknown architecture). `build.sh` auto-selects a
> working SDK (26.5 / 15.5). If you build manually, set `SDKROOT` to a working SDK.

Output: `build/bin/ghoster.app`

## Dev

```bash
export SDKROOT=/Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk
wails dev
```

## License

MIT — spaceman y2k38
