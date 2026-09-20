# Ghoster

Anonymous browser. Tor built-in. No traces.

## Download

| Platform | Download | Type |
|---|---|---|
| **macOS** (Apple Silicon) | `Ghoster-x.x.x-mac-arm64.dmg` | Installer |
| **macOS** (Apple Silicon) | `Ghoster-x.x.x-mac-arm64.zip` | Portable |
| **Windows** | `Ghoster-x.x.x-win-x64.exe` | Installer (NSIS) |
| **Windows** | `Ghoster-x.x.x-win-x64.exe` (portable) | No install needed |
| **Linux** | `Ghoster-x.x.x-linux-x64.AppImage` | Universal |
| **Linux** (Debian/Ubuntu) | `Ghoster-x.x.x-linux-x64.deb` | apt install |
| **Linux** | `Ghoster-x.x.x-linux-x64.tar.gz` | Extract and run |

## Requirements

- [Tor](https://www.torproject.org/) must be running on `127.0.0.1:9050`
  - **macOS**: `brew install tor && brew services start tor`
  - **Linux**: `sudo apt install tor && sudo systemctl start tor`
  - **Windows**: Install Tor Expert Bundle or run Tor Browser in the background

## What it does

- All traffic forced through Tor SOCKS5 proxy
- WebRTC killed — no IP leaks
- User-Agent spoofed to Tor Browser on Windows
- All Client Hints headers stripped
- Geolocation API spoofed (choose your country)
- Timezone, language, screen size spoofed
- All permissions denied (camera, mic, location, notifications)
- **memento** — built-in search engine that proxies Google through Tor, stores nothing
- New Identity button wipes all cookies, cache, storage instantly
- SHA-256 session integrity verification

## Build from source

```bash
# Clone
git clone https://github.com/vvrmatos/ghoster.git
cd ghoster

# Install dependencies
npm install

# Run in dev mode
npm start

# Build for your platform
npm run build:mac      # macOS DMG + ZIP
npm run build:win      # Windows NSIS installer + portable
npm run build:linux    # Linux AppImage + .deb + tar.gz
npm run build          # All platforms
```

### Build requirements

- Node.js >= 18
- npm >= 9
- For Windows builds on macOS/Linux: [Wine](https://www.winehq.org/) (optional, cross-compile works without it for NSIS)
- For Linux builds on macOS: no extra deps needed

## Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `Cmd/Ctrl + L` | Focus URL bar |
| `Cmd/Ctrl + Shift + N` | New identity |
| `Esc` | Close panels |

## Architecture

```
src/
├── main.js          # Electron main process, Tor proxy, session hardening
├── preload.js       # IPC bridge (contextIsolation)
├── search.js        # memento search engine (Google scraper through Tor)
├── countries.js     # 25 countries with geo/language/timezone data
└── ui/
    ├── index.html   # Shell (toolbar, webview, panels)
    ├── style.css    # Dark theme
    ├── browser.js   # Browser logic, country picker, geo injection
    ├── memento.html # Built-in search engine UI
    └── icon.png     # Ghost icon
```

## License

MIT
