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

// ── BROWSER ──

const view = document.getElementById("view");
const urlInput = document.getElementById("url");
const urlLock = document.getElementById("url-lock");
const statusText = document.getElementById("status-text");
let viewReady = false;

const MEMENTO_HOME = "ghoster://home";

function initBrowser() {
  view.src = MEMENTO_HOME;

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
    if (e.errorCode === -3) return;
    statusText.textContent = "failed to load";
  });

  view.addEventListener("dom-ready", () => injectGeoSpoof());

  viewReady = true;
  initCountryPicker();
}

function navigateTo(input) {
  if (!input) return;
  let url = input.trim();

  if (url === "") return;

  // Internal commands
  if (url === "about:blank") {
    view.src = "about:blank";
    return;
  }
  if (url === "ghoster://home" || url === "home") {
    view.src = MEMENTO_HOME;
    urlInput.value = "";
    return;
  }

  if (!url.startsWith("http://") && !url.startsWith("https://") && !url.startsWith("ghoster://")) {
    if (url.includes(".") && !url.includes(" ")) {
      url = "https://" + url;
    } else {
      url = "ghoster://search?q=" + encodeURIComponent(url);
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

document.getElementById("btn-home").addEventListener("click", () => {
  view.src = MEMENTO_HOME;
  urlInput.value = "";
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

    const geo = await window.ghoster.getGeo();
    const cData = countriesData[activeCountry];
    document.getElementById("shield-geo").innerHTML =
      `<span class="sg">●</span> geo: ${cData ? cData.flag + " " + cData.name : "auto"} (${geo.lat.toFixed(2)}, ${geo.lng.toFixed(2)})`;

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
  if (viewReady) view.reload();
}

function updateCountryButton() {
  const btn = document.getElementById("btn-country");
  const c = countriesData[activeCountry];
  if (c) btn.textContent = c.flag;
}

async function injectGeoSpoof() {
  if (!viewReady) return;
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
    await view.executeJavaScript(spoofScript);
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

document.addEventListener("click", (e) => {
  if (
    !countryPanel.contains(e.target) &&
    e.target.id !== "btn-country" &&
    !countryPanel.classList.contains("hidden")
  ) {
    countryPanel.classList.add("hidden");
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
