# 👻 Ghoster

**Anonymous browser. Tor built-in. No traces.**

Ghoster is a privacy-first browser that routes all traffic through Tor, spoofs your entire digital identity, and stores nothing. Built-in search engine. Built-in VPN. Zero configuration.

Sites see: `Navegador: Ghoster` / `Sistema Operacional: PhantomOS`

Your real machine is invisible.

---

## Download

### macOS
| File | Type |
|---|---|
| [Ghoster-0.1.0-mac-arm64.dmg](../../releases/latest) | Installer (drag to Applications) |
| [Ghoster-0.1.0-mac-arm64.zip](../../releases/latest) | Portable (unzip and run) |

### Windows
| File | Type |
|---|---|
| [Ghoster-0.1.0-win-arm64.exe](../../releases/latest) | Installer (NSIS) |

### Linux
| File | Type |
|---|---|
| [Ghoster-0.1.0-linux-arm64.AppImage](../../releases/latest) | Universal (chmod +x, run) |
| [Ghoster-0.1.0-linux-arm64.deb](../../releases/latest) | Debian/Ubuntu (`sudo dpkg -i`) |
| [Ghoster-0.1.0-linux-arm64.tar.gz](../../releases/latest) | Portable (extract, run `ghoster`) |

---

## Requirements

Tor must be running on `127.0.0.1:9050` before launching Ghoster.

```bash
# macOS
brew install tor && brew services start tor

# Linux (Debian/Ubuntu)
sudo apt install tor && sudo systemctl start tor

# Windows
# Install Tor Expert Bundle: https://www.torproject.org/download/tor/
# Or run Tor Browser in the background
```

---

## Features

### Privacy
- **All traffic through Tor** — SOCKS5 proxy enforced at the Chromium engine level
- **WebRTC killed** — no IP leaks through peer connections
- **Client Hints stripped** — all `Sec-CH-UA-*` headers removed from every request
- **Cookies ephemeral** — wiped on new identity
- **All permissions denied** — camera, mic, location, notifications, clipboard
- **No telemetry** — sync, translate, background networking, component updates all disabled

### Identity
- **Phantom Mode** (default) — sites see `Ghoster/0.1.0` on `PhantomOS 1.0`
- **Stealth Mode** — blend in as Firefox 128 on Windows 10 (matches Tor Browser)
- **Nationality picker** — 25 countries with full spoofing:
  - Geolocation API (capital city coordinates)
  - Accept-Language header
  - Timezone (Intl.DateTimeFormat)
  - navigator.language / navigator.languages
- **New Identity** — one click wipes all cookies, cache, storage, DNS cache, auth

### Search
- **memento** — built-in search engine that stores nothing
  - Proxies Google results through Tor
  - Strips all Google tracking and redirects
  - No cookies, no search history, no JavaScript from Google
  - Default homepage and URL bar search

### Integrity
- SHA-256 session hash generated per launch
- Displayed in status bar and security panel

---

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Cmd/Ctrl + L` | Focus URL bar |
| `Cmd/Ctrl + Shift + N` | New identity (wipe everything) |
| `Esc` | Close panels |

---

## Build from Source

```bash
git clone https://github.com/vvrmatos/ghoster.git
cd ghoster
npm install
```

### Run in development
```bash
npm start
```

### Build executables
```bash
npm run build:mac      # macOS → .dmg + .zip
npm run build:win      # Windows → .exe (installer + portable)
npm run build:linux    # Linux → .AppImage + .deb + .tar.gz
npm run build          # All platforms
```

### Build requirements
- Node.js ≥ 18
- npm ≥ 9
- macOS, Linux, or Windows

---

## Architecture

```
ghoster/
├── src/
│   ├── main.js          # Electron main — Tor proxy, session hardening, IPC
│   ├── preload.js       # Context bridge (contextIsolation: true)
│   ├── search.js        # memento engine — Google scraper through Tor
│   ├── countries.js     # 25 countries: geo, language, timezone data
│   └── ui/
│       ├── index.html   # App shell — toolbar, webview, panels
│       ├── style.css    # Dark theme
│       ├── browser.js   # Browser logic, country picker, geo injection
│       ├── memento.html # Search engine UI
│       └── icon.png     # Ghost icon
├── build/
│   ├── icon.png         # 1024x1024 source icon
│   ├── icon.icns        # macOS icon
│   ├── icon.ico         # Windows icon
│   └── icon-linux.png   # Linux icon
└── package.json         # Build config (electron-builder)
```

### How it works

1. Electron starts with `--proxy-server=socks5://127.0.0.1:9050` — **all** Chromium network traffic goes through Tor
2. `--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1` — DNS also through Tor, no leaks
3. `webRequest.onBeforeSendHeaders` rewrites User-Agent and strips Client Hints on every request
4. WebRTC, idle detection, file system access, browsing topics, FLEDGE, attribution — all disabled via Chromium feature flags
5. Geolocation API overridden in webview via `executeJavaScript` injection on every page load
6. New Identity clears all session data, cache, DNS cache, and auth cache

### Chromium flags applied

```
--disable-features=UserAgentClientHint,WebRTC,IdleDetection,DirectSockets,
  FileSystemAccessLocal,BrowsingTopics,InterestGroupAPI,FencedFrames,
  Fledge,Attribution,SharedArrayBuffer
--enable-features=BlockInsecurePrivateNetworkRequests
--disable-webrtc
--webrtc-ip-handling-policy=disable_non_proxied_udp
--disable-background-networking
--disable-sync
--disable-translate
--no-pings
--disable-component-update
--disable-domain-reliability
```

---

## FAQ

**Q: Is this just Tor Browser?**
A: No. Tor Browser is a Firefox fork. Ghoster is a Chromium-based browser with its own identity (PhantomOS), built-in search engine (memento), nationality spoofing, and a different UI/UX philosophy.

**Q: Can I be traced?**
A: Ghoster routes all traffic through Tor and spoofs your fingerprint. However, no tool provides 100% anonymity. Don't log into personal accounts. Don't download files that phone home. Use common sense.

**Q: Why does it need Tor running separately?**
A: Ghoster connects to Tor's SOCKS5 proxy. Running Tor as a system service means it's always ready and you can use it with other apps too.

**Q: Can I use this for daily browsing?**
A: Yes, but expect Tor-level latency. Some sites may block Tor exit nodes or show CAPTCHAs.

---

## License

MIT
