// ── SPLASH / BOOT ──

const splashStatus = document.getElementById("splash-status");
const splashBar = document.getElementById("splash-bar");
const splashHash = document.getElementById("splash-hash");

async function boot() {
  const [hash, torCheck] = await Promise.all([
    window.ghoster.sessionHash(),
    window.ghoster.torStatus(),
  ]);
  splashHash.textContent = "sha:" + hash.slice(0, 16);

  if (torCheck.connected) {
    // Tor already running — skip splash, go straight in
    const integrity = await window.ghoster.verifyIntegrity(hash);
    document.getElementById("splash").classList.add("hidden");
    document.getElementById("browser").classList.remove("hidden");
    initBrowser();
    initTorMonitor();
    document.getElementById("status-hash").textContent = "sha256:" + integrity.hash.slice(0, 16);
    return;
  }

  // Tor not ready — show minimal splash while waiting
  splashBar.style.width = "30%";
  splashStatus.textContent = "waiting for tor...";

  for (let i = 0; i < 15; i++) {
    const s = await window.ghoster.torStatus();
    splashBar.style.width = (30 + i * 4.5) + "%";
    if (s.connected) break;
    await sleep(400);
  }

  const finalCheck = await window.ghoster.torStatus();
  if (!finalCheck.connected) {
    splashStatus.textContent = "tor offline — run: brew services start tor";
    splashBar.style.background = "var(--red)";
    return;
  }

  splashBar.style.width = "100%";
  document.getElementById("splash-ring").classList.add("done");
  await sleep(150);

  document.getElementById("splash").classList.add("hidden");
  document.getElementById("browser").classList.remove("hidden");
  initBrowser();
  initTorMonitor();
  const integrity = await window.ghoster.verifyIntegrity(hash);
  document.getElementById("status-hash").textContent = "sha256:" + integrity.hash.slice(0, 16);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ── BROWSER + TABS ──

const urlInput = document.getElementById("url");
const urlLock = document.getElementById("url-lock");
const statusText = document.getElementById("status-text");
const viewContainer = document.getElementById("view-container");
const tabsEl = document.getElementById("tabs");
let viewReady = false;

const tabs = [];
let activeTabId = null;
let tabCounter = 0;

function getMementoPath() {
  const base = window.location.href.replace(/\/[^/]*$/, "");
  return base + "/memento.html";
}

function getUA() {
  return "Mozilla/5.0 (PhantomOS 1.0; rv:1.0) Ghoster/0.1.0";
}

function createTab(url) {
  const id = "tab-" + (++tabCounter);
  const wv = document.createElement("webview");
  wv.id = id;
  wv.setAttribute("partition", "persist:ghoster");
  wv.setAttribute("allowpopups", "");
  wv.setAttribute("useragent", getUA());
  wv.src = url || getMementoPath();
  viewContainer.appendChild(wv);

  const tab = { id, webview: wv, title: "new tab", url: wv.src };
  tabs.push(tab);

  wv.addEventListener("did-start-loading", () => {
    if (activeTabId === id) statusText.textContent = "loading...";
  });
  wv.addEventListener("did-stop-loading", () => {
    if (activeTabId === id) statusText.textContent = "";
  });
  wv.addEventListener("did-navigate", (e) => {
    tab.url = e.url;
    if (activeTabId === id) { urlInput.value = e.url; updateLock(e.url); }
  });
  wv.addEventListener("did-navigate-in-page", (e) => {
    if (e.isMainFrame) { tab.url = e.url; if (activeTabId === id) urlInput.value = e.url; }
  });
  wv.addEventListener("page-title-updated", (e) => {
    tab.title = e.title || "untitled";
    renderTabs();
    if (activeTabId === id) document.title = tab.title + " — ghoster";
  });
  wv.addEventListener("did-fail-load", (e) => {
    if (e.errorCode === -3) return;
    if (activeTabId === id) statusText.textContent = "failed to load";
  });
  wv.addEventListener("dom-ready", () => injectGeoSpoof(wv));

  switchTab(id);
  renderTabs();
  return tab;
}

function switchTab(id) {
  activeTabId = id;
  tabs.forEach((t) => {
    t.webview.classList.toggle("active-view", t.id === id);
  });
  const tab = tabs.find((t) => t.id === id);
  if (tab) {
    urlInput.value = tab.url || "";
    updateLock(tab.url || "");
    document.title = (tab.title || "ghoster") + " — ghoster";
  }
  renderTabs();
}

function closeTab(id) {
  const idx = tabs.findIndex((t) => t.id === id);
  if (idx === -1) return;
  if (tabs.length === 1) {
    // Last tab — open a new one first
    createTab();
    const oldIdx = tabs.findIndex((t) => t.id === id);
    tabs[oldIdx].webview.remove();
    tabs.splice(oldIdx, 1);
    renderTabs();
    return;
  }
  const wasActive = activeTabId === id;
  tabs[idx].webview.remove();
  tabs.splice(idx, 1);
  if (wasActive) {
    const newIdx = Math.min(idx, tabs.length - 1);
    switchTab(tabs[newIdx].id);
  }
  renderTabs();
}

function renderTabs() {
  tabsEl.innerHTML = "";
  tabs.forEach((t) => {
    const el = document.createElement("div");
    el.className = "tab" + (t.id === activeTabId ? " active" : "");
    el.innerHTML = `<span class="tab-title">${escapeHtml(t.title)}</span><button class="tab-close">×</button>`;
    el.querySelector(".tab-title").addEventListener("click", () => switchTab(t.id));
    el.querySelector(".tab-close").addEventListener("click", (e) => { e.stopPropagation(); closeTab(t.id); });
    el.addEventListener("click", () => switchTab(t.id));
    tabsEl.appendChild(el);
  });
}

function getActiveWebview() {
  const tab = tabs.find((t) => t.id === activeTabId);
  return tab ? tab.webview : null;
}

function initBrowser() {
  createTab(getMementoPath());
  viewReady = true;
  initCountryPicker();
}

function navigateTo(input) {
  if (!input) return;
  let url = input.trim();
  if (url === "") return;

  const wv = getActiveWebview();
  if (!wv) return;

  if (url === "about:blank") { wv.src = "about:blank"; return; }
  if (url === "home" || url === "ghoster://home" || url === "memento") {
    wv.src = getMementoPath(); urlInput.value = ""; return;
  }

  if (!url.startsWith("http://") && !url.startsWith("https://") && !url.startsWith("file://")) {
    if (url.includes(".") && !url.includes(" ")) {
      url = "https://" + url;
    } else {
      url = getMementoPath() + "?q=" + encodeURIComponent(url);
    }
  }

  urlInput.value = url;
  wv.src = url;
  updateLock(url);
}

function updateLock(url) {
  urlLock.textContent = (url && url.startsWith("https://")) ? "🔒" : "⚠️";
}

function escapeHtml(s) {
  return (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// URL bar
urlInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") { navigateTo(urlInput.value); urlInput.blur(); }
});
urlInput.addEventListener("focus", () => urlInput.select());

// Nav buttons
document.getElementById("btn-back").addEventListener("click", () => { const w = getActiveWebview(); if (w) w.goBack(); });
document.getElementById("btn-fwd").addEventListener("click", () => { const w = getActiveWebview(); if (w) w.goForward(); });
document.getElementById("btn-reload").addEventListener("click", () => { const w = getActiveWebview(); if (w) w.reload(); });
document.getElementById("btn-home").addEventListener("click", () => { const w = getActiveWebview(); if (w) { w.src = getMementoPath(); urlInput.value = ""; } });

// New tab button
document.getElementById("btn-new-tab").addEventListener("click", () => createTab());

// New identity
document.getElementById("btn-newid").addEventListener("click", async () => {
  const result = await window.ghoster.newIdentity();
  statusText.textContent = "👻 new identity — " + result.hash.slice(0, 8);
  const w = getActiveWebview();
  if (w) w.reload();
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

    const geo = await window.ghoster.getGeo();
    const cData = countriesData[activeCountry];
    document.getElementById("shield-geo").innerHTML =
      `<span class="sg">●</span> geo: ${cData ? cData.flag + " " + cData.name : "auto"} (${geo.lat.toFixed(2)}, ${geo.lng.toFixed(2)})`;

    const hash = await window.ghoster.sessionHash();
    document.getElementById("shield-hash").textContent = "session: " + hash.slice(0, 32) + "...";
    updateModeUI();
    updateJSUI();
  }
});

// UA mode toggle
const modePhantom = document.getElementById("mode-phantom");
const modeStealth = document.getElementById("mode-stealth");
const modeHint = document.getElementById("mode-hint");

async function updateModeUI() {
  const { mode } = await window.ghoster.getUAMode();
  modePhantom.classList.toggle("active", mode === "phantom");
  modeStealth.classList.toggle("active", mode === "stealth");
  modeHint.textContent = mode === "phantom"
    ? "phantom mode — sites see Ghoster on PhantomOS"
    : "stealth mode — sites see Firefox on Windows";
}

modePhantom.addEventListener("click", async () => {
  await window.ghoster.setUAMode("phantom");
  updateModeUI();
  const w = getActiveWebview();
  if (w) { w.setUserAgent("Mozilla/5.0 (PhantomOS 1.0; rv:1.0) Ghoster/0.1.0"); w.reload(); }
});

modeStealth.addEventListener("click", async () => {
  await window.ghoster.setUAMode("stealth");
  updateModeUI();
  const w = getActiveWebview();
  if (w) { w.setUserAgent("Mozilla/5.0 (Windows NT 10.0; rv:128.0) Gecko/20100101 Firefox/128.0"); w.reload(); }
});

// JS toggle
const jsToggleBtn = document.getElementById("btn-js-toggle");
const jsHint = document.getElementById("js-hint");

async function updateJSUI() {
  const { jsEnabled } = await window.ghoster.getJS();
  jsToggleBtn.textContent = jsEnabled ? "⚡ javascript: on" : "🚫 javascript: off";
  jsToggleBtn.classList.toggle("active", jsEnabled);
  jsHint.textContent = jsEnabled
    ? "JS on — fingerprints poisoned (canvas, WebGL, audio)"
    : "JS off — maximum safety, some sites will break";
  if (viewReady) {
    view.setAudioMuted(false);
    const wc = view.getWebContents ? view.getWebContents() : null;
    // webview doesn't expose webPreferences toggle directly,
    // but we inform the user to reload for the change to take effect
  }
}

jsToggleBtn.addEventListener("click", async () => {
  const { jsEnabled } = await window.ghoster.toggleJS();
  updateJSUI();
  statusText.textContent = jsEnabled ? "⚡ JS enabled" : "🚫 JS disabled";
  setTimeout(() => (statusText.textContent = ""), 2000);
  const w = getActiveWebview();
  if (w) w.reload();
});

// Close all panels on any click outside
document.addEventListener("click", (e) => {
  const target = e.target;
  if (!shieldPanel.contains(target) && target.id !== "btn-shield" && !target.closest("#btn-shield")) {
    shieldPanel.classList.add("hidden");
  }
  if (!countryPanel.contains(target) && target.id !== "btn-country" && !target.closest("#btn-country")) {
    countryPanel.classList.add("hidden");
  }
});

// ── COUNTRY / NATIONALITY PICKER ──

const countryPanel = document.getElementById("country-panel");
const countryList = document.getElementById("country-list");
const countrySearch = document.getElementById("country-search");
let countriesData = {};
let activeCountry = "auto";

async function initCountryPicker() {
  const { countries, current } = await window.ghoster.getCountries();
  countriesData = countries;
  activeCountry = current;
  renderCountries();
  updateCountryButton();
  injectGeoSpoof();
}

function renderCountries(filter = "") {
  countryList.innerHTML = "";
  for (const [code, c] of Object.entries(countriesData)) {
    if (filter && !c.name.toLowerCase().includes(filter.toLowerCase())) continue;
    const div = document.createElement("div");
    div.className = "country-item" + (code === activeCountry ? " active" : "");
    div.innerHTML = `
      <span class="country-flag">${c.flag}</span>
      <span class="country-name">${c.name}</span>
      <span class="country-check">✓</span>
    `;
    div.addEventListener("click", () => selectCountry(code));
    countryList.appendChild(div);
  }
}

async function selectCountry(code) {
  const result = await window.ghoster.setCountry(code);
  if (!result.ok) return;
  activeCountry = code;
  renderCountries(countrySearch.value);
  updateCountryButton();
  countryPanel.classList.add("hidden");
  await injectGeoSpoof();
  statusText.textContent = `${countriesData[code].flag} ${countriesData[code].name}`;
  setTimeout(() => (statusText.textContent = ""), 3000);
  const w = getActiveWebview();
  if (w) w.reload();
}

function updateCountryButton() {
  const btn = document.getElementById("btn-country");
  const c = countriesData[activeCountry];
  if (c) btn.textContent = c.flag;
}

async function injectAntiFingerprint(wv) {
  if (!wv) wv = getActiveWebview();
  if (!wv) return;
  const poisonScript = `
    (function() {
      // Canvas fingerprint poisoning — add subtle noise to every canvas read
      const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
      HTMLCanvasElement.prototype.toDataURL = function() {
        const ctx = this.getContext('2d');
        if (ctx) {
          const img = ctx.getImageData(0, 0, this.width, this.height);
          for (let i = 0; i < img.data.length; i += 4) {
            img.data[i] ^= (Math.random() * 2) | 0;
          }
          ctx.putImageData(img, 0, 0);
        }
        return origToDataURL.apply(this, arguments);
      };

      const origToBlob = HTMLCanvasElement.prototype.toBlob;
      HTMLCanvasElement.prototype.toBlob = function(cb, type, quality) {
        const ctx = this.getContext('2d');
        if (ctx) {
          const img = ctx.getImageData(0, 0, this.width, this.height);
          for (let i = 0; i < img.data.length; i += 4) {
            img.data[i] ^= (Math.random() * 2) | 0;
          }
          ctx.putImageData(img, 0, 0);
        }
        return origToBlob.call(this, cb, type, quality);
      };

      const origGetImageData = CanvasRenderingContext2D.prototype.getImageData;
      CanvasRenderingContext2D.prototype.getImageData = function() {
        const img = origGetImageData.apply(this, arguments);
        for (let i = 0; i < img.data.length; i += 4) {
          img.data[i] ^= (Math.random() * 2) | 0;
        }
        return img;
      };

      // WebGL fingerprint poisoning
      const origGetParameter = WebGLRenderingContext.prototype.getParameter;
      WebGLRenderingContext.prototype.getParameter = function(p) {
        if (p === 37445) return 'Generic GPU';        // UNMASKED_VENDOR_WEBGL
        if (p === 37446) return 'Generic Renderer';    // UNMASKED_RENDERER_WEBGL
        if (p === 7937)  return 'WebGL 1.0 (Ghoster)'; // VERSION
        if (p === 35724) return 'WebGL GLSL ES 1.0';   // SHADING_LANGUAGE_VERSION
        return origGetParameter.call(this, p);
      };
      if (typeof WebGL2RenderingContext !== 'undefined') {
        const origGetParam2 = WebGL2RenderingContext.prototype.getParameter;
        WebGL2RenderingContext.prototype.getParameter = function(p) {
          if (p === 37445) return 'Generic GPU';
          if (p === 37446) return 'Generic Renderer';
          if (p === 7937)  return 'WebGL 2.0 (Ghoster)';
          if (p === 35724) return 'WebGL GLSL ES 3.0';
          return origGetParam2.call(this, p);
        };
      }

      // AudioContext fingerprint poisoning
      if (typeof AudioContext !== 'undefined') {
        const origCreateOscillator = AudioContext.prototype.createOscillator;
        AudioContext.prototype.createOscillator = function() {
          const osc = origCreateOscillator.call(this);
          const origConnect = osc.connect.bind(osc);
          osc.connect = function(dest) {
            if (dest instanceof AnalyserNode) {
              const gain = this.context.createGain();
              gain.gain.value = 1 + (Math.random() * 0.001 - 0.0005);
              origConnect(gain);
              gain.connect(dest);
              return dest;
            }
            return origConnect(dest);
          };
          return osc;
        };
      }

      // Battery API — hide
      if (navigator.getBattery) {
        navigator.getBattery = undefined;
        delete Navigator.prototype.getBattery;
      }

      // Performance timing — reduce precision to 100ms
      const origNow = Performance.prototype.now;
      Performance.prototype.now = function() {
        return Math.round(origNow.call(this) / 100) * 100;
      };

      // Plugins — empty (Firefox-like)
      Object.defineProperty(Navigator.prototype, 'plugins', {
        get: () => Object.create(PluginArray.prototype, { length: { value: 0 } })
      });
      Object.defineProperty(Navigator.prototype, 'mimeTypes', {
        get: () => Object.create(MimeTypeArray.prototype, { length: { value: 0 } })
      });
    })();
  `;
  try { await wv.executeJavaScript(poisonScript); } catch {}
}

async function injectGeoSpoof(wv) {
  if (!wv) wv = getActiveWebview();
  if (!wv) return;
  await injectAntiFingerprint(wv);
  const geo = await window.ghoster.getGeo();
  const spoofScript = `
    (function() {
      const _lat = ${geo.lat};
      const _lng = ${geo.lng};
      const _tz = "${geo.tz}";

      // Override Geolocation API
      if (navigator.geolocation) {
        const fakePos = {
          coords: {
            latitude: _lat,
            longitude: _lng,
            accuracy: 50 + Math.random() * 50,
            altitude: null,
            altitudeAccuracy: null,
            heading: null,
            speed: null,
          },
          timestamp: Date.now(),
        };
        navigator.geolocation.getCurrentPosition = function(s, e, o) {
          setTimeout(() => s(fakePos), 100 + Math.random() * 200);
        };
        navigator.geolocation.watchPosition = function(s, e, o) {
          setTimeout(() => s(fakePos), 100 + Math.random() * 200);
          return Math.floor(Math.random() * 1000);
        };
        navigator.geolocation.clearWatch = function() {};
      }

      // Override timezone
      const _origDTF = Intl.DateTimeFormat;
      Intl.DateTimeFormat = function(...args) {
        if (!args[1]) args[1] = {};
        if (!args[1].timeZone) args[1].timeZone = _tz;
        return new _origDTF(...args);
      };
      Object.setPrototypeOf(Intl.DateTimeFormat, _origDTF);
      Object.setPrototypeOf(Intl.DateTimeFormat.prototype, _origDTF.prototype);

      const _origRO = _origDTF.prototype.resolvedOptions;
      Intl.DateTimeFormat.prototype.resolvedOptions = function() {
        const opts = _origRO.call(this);
        opts.timeZone = _tz;
        return opts;
      };

      // Override navigator.language
      Object.defineProperty(Navigator.prototype, 'language', { get: () => "${geo.locale}" });
      Object.defineProperty(Navigator.prototype, 'languages', { get: () => Object.freeze(["${geo.locale}"]) });
    })();
  `;

  try {
    await wv.executeJavaScript(spoofScript);
  } catch {}
}

document.getElementById("btn-country").addEventListener("click", () => {
  countryPanel.classList.toggle("hidden");
  shieldPanel.classList.add("hidden");
  if (!countryPanel.classList.contains("hidden")) {
    countrySearch.value = "";
    countrySearch.focus();
    renderCountries();
  }
});

countrySearch.addEventListener("input", () => {
  renderCountries(countrySearch.value);
});

// (click-outside handled by unified handler above)

// ── KEYBOARD SHORTCUTS ──

document.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === "t") {
    e.preventDefault();
    createTab();
  }
  if ((e.metaKey || e.ctrlKey) && e.key === "w") {
    e.preventDefault();
    if (activeTabId) closeTab(activeTabId);
  }
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
    countryPanel.classList.add("hidden");
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
