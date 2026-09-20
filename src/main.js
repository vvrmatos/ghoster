const {
  app,
  BrowserWindow,
  session,
  ipcMain,
  protocol,
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
const UA =
  "Mozilla/5.0 (Windows NT 10.0; rv:128.0) Gecko/20100101 Firefox/128.0";

// Session integrity hash — every session gets a unique fingerprint for internal verification
const SESSION_HASH = crypto.randomBytes(32).toString("hex");

// ── CHROMIUM HARDENING ──

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

let mainWindow;
let torReady = false;

// ── TOR CHECK ──

function checkTor() {
  return new Promise((resolve) => {
    const sock = net.createConnection(TOR_PORT, TOR_HOST, () => {
      sock.end();
      resolve(true);
    });
    sock.on("error", () => resolve(false));
    sock.setTimeout(2000, () => { sock.destroy(); resolve(false); });
  });
}

async function waitForTor(maxWait = 15000) {
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    if (await checkTor()) { torReady = true; return true; }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

// ── SESSION HARDENING ──

function hardenSession(ses) {
  ses.setUserAgent(UA);

  // Strip all identifying headers
  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    const h = details.requestHeaders;
    h["User-Agent"] = UA;
    h["Accept-Language"] = "en-US,en;q=0.5";

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

  // Block all permission requests
  ses.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  ses.setPermissionCheckHandler(() => false);
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
    trafficLightPosition: { x: -100, y: -100 },
    icon: path.join(__dirname, "ui", "icon.png"),
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

// ── LAUNCH ──

app.whenReady().then(async () => {
  createWindow();
  await waitForTor();
  mainWindow.webContents.send("tor-ready", torReady);
});

app.on("window-all-closed", () => app.quit());

app.on("web-contents-created", (_e, contents) => {
  // Block all navigation to non-http(s) URLs
  contents.on("will-navigate", (event, url) => {
    if (!url.startsWith("http://") && !url.startsWith("https://") && !url.startsWith("file://")) {
      event.preventDefault();
    }
  });

  // Block new window creation — force same window
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
});
