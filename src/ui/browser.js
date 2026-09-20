// ── SPLASH / BOOT ──

const splashStatus = document.getElementById("splash-status");
const splashBar = document.getElementById("splash-bar");
const splashHash = document.getElementById("splash-hash");

async function boot() {
  const hash = await window.ghoster.sessionHash();
  splashHash.textContent = "sha:" + hash.slice(0, 24) + "...";

  splashBar.style.width = "20%";
  splashStatus.textContent = "connecting to tor...";

  const maxAttempts = 20;
  let connected = false;
  for (let i = 0; i < maxAttempts; i++) {
    const s = await window.ghoster.torStatus();
    splashBar.style.width = Math.min(20 + (i / maxAttempts) * 60, 80) + "%";
    if (s.connected) { connected = true; break; }
    await sleep(500);
  }

  if (!connected) {
    splashStatus.textContent = "tor offline — start tor first";
    splashBar.style.width = "100%";
    splashBar.style.background = "var(--red)";
    return;
  }

  splashBar.style.width = "85%";
  splashStatus.textContent = "hardening session...";
  await sleep(300);

  splashBar.style.width = "95%";
  splashStatus.textContent = "verifying integrity...";
  const integrity = await window.ghoster.verifyIntegrity(hash);
  await sleep(200);

  splashBar.style.width = "100%";
  splashStatus.textContent = "ready";
  await sleep(400);

  document.getElementById("splash").classList.add("hidden");
  document.getElementById("browser").classList.remove("hidden");

  initBrowser();
  initTorMonitor();

  document.getElementById("status-hash").textContent =
    "sha256:" + integrity.hash.slice(0, 16);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ── BROWSER ──

const view = document.getElementById("view");
const urlInput = document.getElementById("url");
const urlLock = document.getElementById("url-lock");
const statusText = document.getElementById("status-text");
let viewReady = false;

function initBrowser() {
  navigateTo("https://duckduckgo.com");

  view.addEventListener("did-start-loading", () => {
    statusText.textContent = "loading...";
  });

  view.addEventListener("did-stop-loading", () => {
    statusText.textContent = "";
  });

  view.addEventListener("did-navigate", (e) => {
    urlInput.value = e.url;
    updateLock(e.url);
  });

  view.addEventListener("did-navigate-in-page", (e) => {
    if (e.isMainFrame) urlInput.value = e.url;
  });

  view.addEventListener("page-title-updated", (e) => {
    document.title = e.title + " — ghoster";
  });

  view.addEventListener("did-fail-load", (e) => {
    if (e.errorCode === -3) return; // aborted, ignore
    statusText.textContent = "failed to load";
  });

  viewReady = true;
}

function navigateTo(input) {
  if (!input) return;
  let url = input.trim();

  if (url === "") return;

  // Internal commands
  if (url === "about:blank" || url === "ghoster://home") {
    view.src = "about:blank";
    return;
  }

  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    if (url.includes(".") && !url.includes(" ")) {
      url = "https://" + url;
    } else {
      url = "https://duckduckgo.com/?q=" + encodeURIComponent(url);
    }
  }

  urlInput.value = url;
  view.src = url;
  updateLock(url);
}

function updateLock(url) {
  urlLock.textContent = url.startsWith("https://") ? "🔒" : "⚠️";
}

// URL bar
urlInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    navigateTo(urlInput.value);
    urlInput.blur();
  }
});

urlInput.addEventListener("focus", () => urlInput.select());

// Nav buttons
document.getElementById("btn-back").addEventListener("click", () => {
  if (viewReady) view.goBack();
});

document.getElementById("btn-fwd").addEventListener("click", () => {
  if (viewReady) view.goForward();
});

document.getElementById("btn-reload").addEventListener("click", () => {
  if (viewReady) view.reload();
});

// New identity
document.getElementById("btn-newid").addEventListener("click", async () => {
  const result = await window.ghoster.newIdentity();
  statusText.textContent = "👻 new identity — " + result.hash.slice(0, 8);
  if (viewReady) view.reload();
  setTimeout(() => (statusText.textContent = ""), 3000);
});

// ── TOR MONITOR ──

function initTorMonitor() {
  const dot = document.getElementById("tor-dot");
  async function check() {
    const s = await window.ghoster.torStatus();
    dot.className = "tb tor-dot " + (s.connected ? "on" : "off");
    dot.title = s.connected ? "Tor: connected" : "Tor: disconnected";
  }
  check();
  setInterval(check, 8000);
}

// ── SHIELD PANEL ──

const shieldPanel = document.getElementById("shield-panel");

document.getElementById("btn-shield").addEventListener("click", async () => {
  shieldPanel.classList.toggle("hidden");

  if (!shieldPanel.classList.contains("hidden")) {
    // Fetch real tor IP
    const ipEl = document.getElementById("shield-ip");
    ipEl.innerHTML = '<span class="sg">●</span> exit ip: checking...';
    try {
      const r = await fetch("https://check.torproject.org/api/ip");
      const d = await r.json();
      if (d.IsTor) {
        ipEl.innerHTML = `<span class="sg">●</span> exit ip: ${d.IP}`;
      } else {
        ipEl.innerHTML = `<span class="sr">●</span> NOT on tor: ${d.IP}`;
      }
    } catch {
      ipEl.innerHTML = '<span class="sr">●</span> exit ip: unknown';
    }

    const hash = await window.ghoster.sessionHash();
    document.getElementById("shield-hash").textContent = "session: " + hash.slice(0, 32) + "...";
  }
});

// Close shield on click outside
document.addEventListener("click", (e) => {
  if (
    !shieldPanel.contains(e.target) &&
    e.target.id !== "btn-shield" &&
    !shieldPanel.classList.contains("hidden")
  ) {
    shieldPanel.classList.add("hidden");
  }
});

// ── KEYBOARD SHORTCUTS ──

document.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === "l") {
    e.preventDefault();
    urlInput.focus();
    urlInput.select();
  }
  if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "n") {
    e.preventDefault();
    document.getElementById("btn-newid").click();
  }
  if (e.key === "Escape") {
    shieldPanel.classList.add("hidden");
  }
});

// ── INIT ──

window.ghoster.onTorReady((ok) => {
  if (ok && !viewReady) {
    document.getElementById("splash").classList.add("hidden");
    document.getElementById("browser").classList.remove("hidden");
    initBrowser();
    initTorMonitor();
  }
});

document.addEventListener("DOMContentLoaded", boot);
