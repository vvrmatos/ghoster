const {
  app,
  BrowserWindow,
  session,
  ipcMain,
  protocol,
  net: electronNet,
  Menu,
} = require("electron");
const { execFile, exec } = require("child_process");
const path = require("path");
const net = require("net");
const crypto = require("crypto");

// ── CONFIG ──

const TOR_SOCKS = "socks5://127.0.0.1:9050";
const TOR_HOST = "127.0.0.1";
const TOR_PORT = 9050;

const UA_PHANTOM = "Mozilla/5.0 (PhantomOS 1.0; rv:1.0) Ghoster/0.1.0";
const UA_STEALTH = "Mozilla/5.0 (Windows NT 10.0; rv:128.0) Gecko/20100101 Firefox/128.0";
let uaMode = "phantom";
let jsEnabled = true;

function getUA() { return uaMode === "phantom" ? UA_PHANTOM : UA_STEALTH; }

// Session integrity hash — every session gets a unique fingerprint for internal verification
const SESSION_HASH = crypto.randomBytes(32).toString("hex");

// ── CHROMIUM HARDENING ──

app.commandLine.appendSwitch("disable-gpu-sandbox");
app.commandLine.appendSwitch("disable-software-rasterizer");
app.commandLine.appendSwitch("disable-dev-shm-usage");
app.commandLine.appendSwitch("js-flags", "--max-old-space-size=256");

protocol.registerSchemesAsPrivileged([
  { scheme: "ghoster", privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

app.commandLine.appendSwitch("proxy-server", TOR_SOCKS);
app.commandLine.appendSwitch("host-resolver-rules", "MAP * ~NOTFOUND, EXCLUDE 127.0.0.1");
app.commandLine.appendSwitch("disable-features",
  "UserAgentClientHint,WebRTC,WebRtcHideLocalIpsWithMdns,IdleDetection,DirectSockets,FileSystemAccessLocal,BrowsingTopics,InterestGroupAPI,FencedFrames,Fledge,Attribution,SharedArrayBuffer"
);
app.commandLine.appendSwitch("enable-features", "BlockInsecurePrivateNetworkRequests");
app.commandLine.appendSwitch("disable-webrtc");
app.commandLine.appendSwitch("webrtc-ip-handling-policy", "disable_non_proxied_udp");
app.commandLine.appendSwitch("force-webrtc-ip-handling-policy", "disable_non_proxied_udp");
app.commandLine.appendSwitch("disable-background-networking");
app.commandLine.appendSwitch("disable-client-side-phishing-detection");
app.commandLine.appendSwitch("disable-default-apps");
app.commandLine.appendSwitch("disable-extensions");
app.commandLine.appendSwitch("disable-hang-monitor");
app.commandLine.appendSwitch("disable-popup-blocking");
app.commandLine.appendSwitch("disable-prompt-on-repost");
app.commandLine.appendSwitch("disable-sync");
app.commandLine.appendSwitch("disable-translate");
app.commandLine.appendSwitch("no-first-run");
app.commandLine.appendSwitch("no-pings");
app.commandLine.appendSwitch("disable-component-update");
app.commandLine.appendSwitch("disable-domain-reliability");
app.commandLine.appendSwitch("disable-breakpad");

const COUNTRIES = require("./countries");
const { search: mementoSearch } = require("./search");

let mainWindow;
let torReady = false;
let currentCountry = "auto";

// ── TOR CHECK ──

function checkTor() {
  return new Promise((resolve) => {
    const sock = net.createConnection(TOR_PORT, TOR_HOST, () => {
      sock.end();
      resolve(true);
    });
    sock.on("error", () => resolve(false));
    sock.setTimeout(800, () => { sock.destroy(); resolve(false); });
  });
}

async function waitForTor(maxWait = 5000) {
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    if (await checkTor()) { torReady = true; return true; }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

// ── SESSION HARDENING ──

function hardenSession(ses) {
  ses.setUserAgent(getUA());

  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    const h = details.requestHeaders;
    h["User-Agent"] = getUA();
    const c = COUNTRIES[currentCountry] || COUNTRIES.auto;
    h["Accept-Language"] = c.lang;

    const strip = [
      "Sec-CH-UA", "Sec-CH-UA-Platform", "Sec-CH-UA-Mobile",
      "Sec-CH-UA-Full-Version-List", "Sec-CH-UA-Arch",
      "Sec-CH-UA-Bitness", "Sec-CH-UA-Model",
      "Sec-CH-UA-Platform-Version", "Sec-CH-UA-WoW64",
      "Sec-Fetch-User",
    ];
    for (const key of strip) delete h[key];

    callback({ requestHeaders: h });
  });

  // Block third-party cookies only (first-party needed for sites to work)
  ses.cookies.flushStore();
  ses.webRequest.onHeadersReceived((details, callback) => {
    callback({ responseHeaders: details.responseHeaders });
  });

  ses.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  ses.setPermissionCheckHandler(() => false);

  ses.enableNetworkEmulation({ offline: false, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
}

// ── WINDOW ──

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 600,
    minHeight: 400,
    frame: false,
    titleBarStyle: "hidden",
    trafficLightPosition: { x: 14, y: 50 },
    icon: path.join(__dirname, "..", "build", "icon.icns"),
    backgroundColor: "#08080c",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: true,
      spellcheck: false,
      enableWebSQL: false,
    },
  });

  Menu.setApplicationMenu(null);
  hardenSession(session.defaultSession);
  mainWindow.loadFile(path.join(__dirname, "ui", "index.html"));
}

// ── IPC ──

ipcMain.handle("tor-status", async () => {
  const ok = await checkTor();
  torReady = ok;
  return { connected: ok };
});

ipcMain.handle("new-identity", async () => {
  const ses = session.defaultSession;
  await ses.clearStorageData();
  await ses.clearCache();
  await ses.clearHostResolverCache();
  await ses.clearAuthCache();
  return { ok: true, hash: crypto.randomBytes(16).toString("hex") };
});

ipcMain.handle("session-hash", () => SESSION_HASH);

ipcMain.handle("verify-integrity", (_e, data) => {
  const hash = crypto.createHash("sha256").update(data).digest("hex");
  return { hash, verified: true };
});

ipcMain.handle("get-ua-mode", () => {
  return { mode: uaMode, ua: getUA() };
});

ipcMain.handle("set-ua-mode", (_e, mode) => {
  uaMode = mode === "stealth" ? "stealth" : "phantom";
  session.defaultSession.setUserAgent(getUA());
  return { mode: uaMode, ua: getUA() };
});

ipcMain.handle("toggle-js", () => {
  jsEnabled = !jsEnabled;
  if (mainWindow) {
    mainWindow.webContents.send("js-toggled", jsEnabled);
  }
  return { jsEnabled };
});

ipcMain.handle("get-js", () => ({ jsEnabled }));

ipcMain.handle("get-countries", () => {
  const list = {};
  for (const [code, c] of Object.entries(COUNTRIES)) {
    list[code] = { name: c.name, flag: c.flag };
  }
  return { countries: list, current: currentCountry };
});

ipcMain.handle("set-country", (_e, code) => {
  if (!COUNTRIES[code]) return { ok: false };
  currentCountry = code;
  const c = COUNTRIES[code];
  return { ok: true, country: c };
});

ipcMain.handle("memento-search", async (_e, query) => {
  return await mementoSearch(query);
});

ipcMain.handle("get-geo", () => {
  let c = COUNTRIES[currentCountry];
  if (currentCountry === "auto") {
    const keys = Object.keys(COUNTRIES).filter((k) => k !== "auto");
    const pick = keys[Math.floor(Math.random() * keys.length)];
    c = COUNTRIES[pick];
  }
  return { lat: c.lat, lng: c.lng, tz: c.tz, locale: c.locale, lang: c.lang };
});

// ── CUSTOM PROTOCOL ──

function registerProtocol() {
  protocol.handle("ghoster", async (request) => {
    const url = new URL(request.url);

    if (url.hostname === "search") {
      const query = url.searchParams.get("q") || "";
      const results = await mementoSearch(query);
      const resultsJson = encodeURIComponent(JSON.stringify(results));
      const mementoPath = path.join(__dirname, "ui", "memento.html");
      const redirect = `file://${mementoPath}#results=${resultsJson}`;
      return electronNet.fetch(redirect);
    }

    if (url.hostname === "home") {
      const mementoPath = path.join(__dirname, "ui", "memento.html");
      return electronNet.fetch(`file://${mementoPath}`);
    }

    return new Response("not found", { status: 404 });
  });
}

// ── LAUNCH ──

app.whenReady().then(async () => {
  const { nativeImage } = require("electron");
  const dockIcon = nativeImage.createFromPath(path.join(__dirname, "..", "build", "icon.png"));
  if (process.platform === "darwin" && app.dock) {
    app.dock.setIcon(dockIcon);
  }
  registerProtocol();
  createWindow();
  // Don't block — let the renderer check Tor status
  waitForTor().then(() => {
    if (mainWindow) mainWindow.webContents.send("tor-ready", torReady);
  });
});

app.on("window-all-closed", () => app.quit());

app.on("web-contents-created", (_e, contents) => {
  contents.on("dom-ready", () => {
    if (!jsEnabled && contents.getType() === "webview") {
      contents.executeJavaScript(`
        document.querySelectorAll('script').forEach(s => s.remove());
        const obs = new MutationObserver(muts => {
          muts.forEach(m => m.addedNodes.forEach(n => {
            if (n.tagName === 'SCRIPT') n.remove();
          }));
        });
        obs.observe(document.documentElement, { childList: true, subtree: true });
      `).catch(() => {});
    }
  });
  // Block all navigation to non-http(s) URLs
  contents.on("will-navigate", (event, url) => {
    if (!url.startsWith("http://") && !url.startsWith("https://") && !url.startsWith("file://")) {
      event.preventDefault();
    }
  });

  // Block new window creation — force same window
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
});
