import "./style.css";
import iconUrl from "./assets/images/icon.png";
import {
  TorStatus, SessionHash, VerifyIntegrity, SetMode, NewIdentity,
  Countries, SetCountry, GetGeo, SearchWeb, SearchDark,
} from "../wailsjs/go/main/App";

const PROXY = "http://127.0.0.1:8888";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = (s) => (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// ── BOOT ──
async function boot() {
  document.getElementById("splash-logo").src = iconUrl;
  document.getElementById("ghost-icon").src = iconUrl;
  const hash = await SessionHash();
  document.getElementById("splash-hash").textContent = "sha:" + hash.slice(0, 16);
  document.getElementById("splash-bar").style.width = "40%";

  let connected = false;
  for (let i = 0; i < 12; i++) {
    connected = await TorStatus();
    document.getElementById("splash-bar").style.width = (40 + i * 5) + "%";
    if (connected) break;
    await sleep(400);
  }

  if (!connected) {
    document.getElementById("splash-status").textContent = "tor offline — start tor first";
    document.getElementById("splash-bar").style.background = "var(--red)";
    return;
  }

  document.getElementById("splash-bar").style.width = "100%";
  document.getElementById("splash-ring").classList.add("done");
  await sleep(250);
  document.getElementById("splash").classList.add("hidden");
  document.getElementById("browser").classList.remove("hidden");

  const integ = await VerifyIntegrity(hash);
  document.getElementById("status-hash").textContent = "sha256:" + integ.slice(0, 16);

  initTabs();
  initTor();
  initCountries();
}

// ── TABS ──
const viewContainer = document.getElementById("view-container");
const tabsEl = document.getElementById("tabs");
const urlInput = document.getElementById("url");
const statusText = document.getElementById("status-text");
let tabs = [], activeId = null, counter = 0;

function newTab(url) {
  const id = "t" + (++counter);
  const tab = { id, title: "ghoster", url: url || "", isMemento: !url };

  if (tab.isMemento) {
    const div = document.createElement("div");
    div.className = "memento-view";
    div.id = id;
    div.innerHTML = mementoHTML();
    viewContainer.appendChild(div);
    tab.el = div;
  } else {
    const f = document.createElement("iframe");
    f.id = id;
    f.src = PROXY + "/browse?url=" + encodeURIComponent(url);
    f.addEventListener("load", () => finishLoad());
    viewContainer.appendChild(f);
    tab.el = f;
  }
  tabs.push(tab);
  switchTab(id);
  renderTabs();
  if (tab.isMemento) wireMemento(tab);
  return tab;
}

function switchTab(id) {
  activeId = id;
  tabs.forEach((t) => t.el.classList.toggle("active-view", t.id === id));
  const t = tabs.find((x) => x.id === id);
  if (t) { urlInput.value = t.isMemento ? "" : t.url; document.getElementById("url-lock").textContent = t.isMemento ? "◈" : "▪"; }
  renderTabs();
}

function closeTab(id) {
  const i = tabs.findIndex((t) => t.id === id);
  if (i === -1) return;
  if (tabs.length === 1) { newTab(); }
  const wasActive = activeId === id;
  tabs[i].el.remove();
  tabs.splice(i, 1);
  if (wasActive && tabs.length) switchTab(tabs[Math.min(i, tabs.length - 1)].id);
  renderTabs();
}

function renderTabs() {
  tabsEl.innerHTML = "";
  tabs.forEach((t) => {
    const el = document.createElement("div");
    el.className = "tab" + (t.id === activeId ? " active" : "");
    el.innerHTML = `<span class="tab-title">${esc(t.title)}</span><button class="tab-close">×</button>`;
    el.addEventListener("click", () => switchTab(t.id));
    el.querySelector(".tab-close").addEventListener("click", (e) => { e.stopPropagation(); closeTab(t.id); });
    tabsEl.appendChild(el);
  });
}

function activeTab() { return tabs.find((t) => t.id === activeId); }

function navigate(input) {
  const t = activeTab();
  if (!t) return;
  let url = input.trim();
  if (!url) return;
  if (url === "home" || url === "memento") { loadMemento(t); return; }

  if (!/^https?:\/\//.test(url)) {
    if (url.includes(".") && !url.includes(" ")) url = "https://" + url;
    else { searchInTab(t, url); return; }
  }
  loadURL(t, url);
}

function loadURL(t, url) {
  startLoad();
  t.isMemento = false; t.url = url; t.title = new URL(url).hostname;
  if (t.el.tagName !== "IFRAME") {
    const f = document.createElement("iframe");
    f.id = t.id; f.addEventListener("load", () => finishLoad());
    t.el.replaceWith(f); t.el = f;
  }
  t.el.src = PROXY + "/browse?url=" + encodeURIComponent(url);
  t.el.classList.add("active-view");
  urlInput.value = url;
  document.getElementById("url-lock").textContent = "▪";
  renderTabs();
}

function loadMemento(t) {
  t.isMemento = true; t.url = ""; t.title = "ghoster";
  const div = document.createElement("div");
  div.className = "memento-view active-view"; div.id = t.id;
  div.innerHTML = mementoHTML();
  t.el.replaceWith(div); t.el = div;
  urlInput.value = "";
  document.getElementById("url-lock").textContent = "◈";
  wireMemento(t);
  renderTabs();
}

// ── MEMENTO (native, in-app) ──
function mementoHTML() {
  return `
  <div class="m-wrap">
    <div class="m-home" id="m-home">
      <div class="m-logo"><span class="m-logo-wrap"><span class="m-ring"></span><img src="${iconUrl}"></span><span>ghoster</span></div>
      <div class="m-philo">memento</div>
      <div class="m-box"><span class="m-ic">⌕</span><input class="m-input" placeholder="memoria oblivio" spellcheck="false"><button class="m-go">→</button></div>
      <div class="m-tag">trust no one.</div>
      <div class="m-feat"><span>● no logs</span><span>● no cookies</span><span>● no tracking</span><span>● tor routed</span></div>
    </div>
    <div class="m-results"></div>
  </div>
  <style>
    .m-wrap{height:100%;overflow-y:auto;background:#08080c;color:#d0d0dc;font-family:-apple-system,sans-serif;}
    .m-home{display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:80vh;gap:22px;}
    .m-home.has{min-height:auto;padding:30px 0 10px;}
    .m-logo{display:flex;align-items:center;gap:12px;}
    .m-logo-wrap{position:relative;display:inline-flex;width:40px;height:40px;}
    .m-logo-wrap img{width:40px;height:40px;border-radius:10px;position:relative;z-index:2;}
    .m-ring{position:absolute;top:-6px;left:-6px;width:52px;height:52px;border-radius:50%;border:2px solid transparent;z-index:1;opacity:0;transition:opacity .2s;}
    .m-logo-wrap.searching .m-ring{opacity:1;border-top-color:#00a8ff;border-right-color:#8b7cf6;animation:mspin .9s linear infinite;}
    .m-home.has .m-logo-wrap{width:26px;height:26px;}
    .m-home.has .m-logo-wrap img{width:26px;height:26px;}
    .m-home.has .m-ring{width:36px;height:36px;top:-5px;left:-5px;}
    @keyframes mspin{to{transform:rotate(360deg);}}
    .m-logo span{font-size:38px;font-weight:300;letter-spacing:8px;}
    .m-philo{font-size:11px;color:#5a5a6e;letter-spacing:6px;text-transform:lowercase;opacity:.6;margin-top:-14px;text-align:center;width:100%;}
    .m-home.has .m-logo img{width:26px;height:26px;} .m-home.has .m-logo span{font-size:22px;}
    .m-home.has .m-philo{display:none;}
    .m-box{width:90%;max-width:620px;display:flex;align-items:center;background:#0e0e14;border:1px solid #252535;border-radius:24px;padding:0 18px;height:48px;}
    .m-box:focus-within{border-color:#8b7cf6;}
    .m-ic{color:#5a5a6e;margin-right:10px;} .m-input{flex:1;background:none;border:none;color:#d0d0dc;font-size:15px;outline:none;font-family:inherit;}
    .m-go{background:none;border:none;color:#8b7cf6;font-size:16px;cursor:pointer;}
    .m-tag{font-size:12px;color:#5a5a6e;letter-spacing:2px;} .m-home.has .m-tag{display:none;}
    .m-feat{display:flex;gap:26px;font-size:11px;color:#34d399;} .m-home.has .m-feat{display:none;}
    .m-results{max-width:720px;margin:0 auto;padding:0 20px 40px;}
    .m-tabs{display:flex;gap:6px;margin-bottom:16px;padding-bottom:12px;border-bottom:1px solid #252535;flex-wrap:wrap;}
    .m-stab{background:#0e0e14;border:1px solid #252535;color:#5a5a6e;border-radius:6px;padding:5px 12px;font-size:11px;cursor:pointer;}
    .m-stab.active{background:#8b7cf6;color:#fff;border-color:#8b7cf6;}
    .m-res{margin-bottom:18px;padding:12px 16px;border-radius:10px;}
    .m-res:hover{background:#0e0e14;}
    .m-url{font-size:11px;color:#5a5a6e;margin-bottom:3px;}
    .m-badge{display:inline-block;font-size:9px;padding:1px 6px;border-radius:3px;margin-right:6px;text-transform:uppercase;}
    .b-web{background:#1e3a5f;color:#7cc4ff;} .b-onion{background:#3a1e5f;color:#c47cff;} .b-torrent{background:#5f3a1e;color:#ffb47c;}
    .m-title{font-size:16px;font-weight:500;color:#8b7cf6;text-decoration:none;display:block;cursor:pointer;margin-bottom:4px;}
    .m-title:hover{text-decoration:underline;}
    .m-snip{font-size:13px;color:#5a5a6e;line-height:1.5;}
    .m-load,.m-empty{text-align:center;padding:50px;color:#5a5a6e;font-size:13px;}
  </style>`;
}

function wireMemento(tab) {
  const root = tab.el;
  const input = root.querySelector(".m-input");
  const go = root.querySelector(".m-go");
  const run = () => doSearch(tab, input.value);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") run(); });
  go.addEventListener("click", run);
  input.focus();
}

function searchInTab(t, q) {
  if (!t.isMemento) loadMemento(t);
  const tab = activeTab();
  const input = tab.el.querySelector(".m-input");
  if (input) input.value = q;
  doSearch(tab, q);
}

let lastData = null, curFilter = "all";
async function doSearch(tab, query) {
  if (!query.trim()) return;
  const root = tab.el;
  root.querySelector(".m-home").classList.add("has");
  const ring = root.querySelector(".m-logo-wrap");
  if (ring) ring.classList.add("searching");
  const rc = root.querySelector(".m-results");
  rc.innerHTML = '<div class="m-load">searching…</div>';
  tab.title = query;
  renderTabs();

  // Web results first — fast render
  const web = await SearchWeb(query);
  lastData = { web: web.web || [], onion: [], torrent: [], query };
  curFilter = "all";
  renderResults(tab, lastData, true);

  // Dark sources (onion + torrent) fill in after
  SearchDark(query).then((dark) => {
    if (ring) ring.classList.remove("searching");
    if (activeTab() !== tab) { lastData.onion = dark.onion || []; lastData.torrent = dark.torrent || []; return; }
    lastData.onion = dark.onion || [];
    lastData.torrent = dark.torrent || [];
    renderResults(tab, lastData, false);
  }).catch(() => { if (ring) ring.classList.remove("searching"); });
}

function renderResults(tab, data, darkPending) {
  const rc = tab.el.querySelector(".m-results");
  const web = data.web || [], onion = data.onion || [], torrent = data.torrent || [];
  const total = web.length + onion.length + torrent.length;
  if (!total) { rc.innerHTML = '<div class="m-empty">nothing found — even ghosts have limits</div>'; return; }

  let list = curFilter === "web" ? web : curFilter === "onion" ? onion : curFilter === "torrent" ? torrent : [...web, ...onion, ...torrent];
  const pending = darkPending ? " …" : "";
  let h = '<div class="m-tabs">';
  h += stab("all", "all (" + total + ")") + stab("web", "◈ web (" + web.length + ")") + stab("onion", "▣ onion (" + (onion.length || 0) + pending + ")") + stab("torrent", "▾ torrents (" + (torrent.length || 0) + pending + ")");
  h += "</div>";
  for (const r of list) {
    const b = r.source === "onion" ? "b-onion" : r.source === "torrent" ? "b-torrent" : "b-web";
    let disp = r.url;
    try { if (r.source !== "torrent") disp = new URL(r.url).hostname; else disp = "magnet"; } catch {}
    h += `<div class="m-res"><div class="m-url"><span class="m-badge ${b}">${r.source}</span>${esc(disp)}</div><a class="m-title" data-url="${esc(r.url)}" data-src="${r.source}">${esc(r.title)}</a>${r.snippet ? `<div class="m-snip">${esc(r.snippet)}</div>` : ""}</div>`;
  }
  rc.innerHTML = h;
  rc.querySelectorAll(".m-stab").forEach((t) => t.addEventListener("click", () => { curFilter = t.dataset.src; renderResults(tab, lastData, false); }));
  rc.querySelectorAll(".m-title").forEach((a) => a.addEventListener("click", () => {
    const url = a.dataset.url;
    if (a.dataset.src === "torrent") { window.runtime && window.runtime.BrowserOpenURL(url); }
    else loadURL(activeTab(), url);
  }));
}
function stab(src, label) { return `<button class="m-stab${curFilter === src ? " active" : ""}" data-src="${src}">${label}</button>`; }

// ── LOAD BAR ──
const lbFill = document.getElementById("loadbar-fill");
let lbInt = null, lbP = 0;
function startLoad() { clearInterval(lbInt); lbP = 8; lbFill.className = "loadbar-fill"; lbFill.style.opacity = "1"; lbFill.style.width = "8%"; lbInt = setInterval(() => { if (lbP < 90) { lbP += (90 - lbP) * 0.08; lbFill.style.width = lbP + "%"; } }, 100); }
function finishLoad() { clearInterval(lbInt); lbFill.style.width = "100%"; lbFill.className = "loadbar-fill done"; setTimeout(() => { lbFill.className = "loadbar-fill"; lbFill.style.width = "0"; lbP = 0; }, 600); }

// ── TOR ──
function initTor() {
  const dot = document.getElementById("tor-dot");
  const s = document.getElementById("s-tor");
  async function check() { const ok = await TorStatus(); dot.className = "tb tor-dot " + (ok ? "on" : "off"); if (s) s.textContent = ok ? "active" : "offline"; }
  check(); setInterval(check, 8000);
}

// ── COUNTRIES ──
let countryData = [], activeCountry = "auto";
async function initCountries() {
  countryData = await Countries();
  renderCountries("");
}
function renderCountries(filter) {
  const list = document.getElementById("country-list");
  list.innerHTML = "";
  countryData.filter((c) => !filter || c.name.toLowerCase().includes(filter.toLowerCase())).forEach((c) => {
    const el = document.createElement("div");
    el.className = "country-item" + (c.code === activeCountry ? " active" : "");
    el.innerHTML = `<span class="country-flag">${c.flag}</span><span>${c.name}</span>`;
    el.addEventListener("click", async () => { activeCountry = c.code; await SetCountry(c.code); renderCountries(filter); document.getElementById("country-panel").classList.add("hidden"); const t = activeTab(); if (t && !t.isMemento) loadURL(t, t.url); });
    list.appendChild(el);
  });
}

// ── TOOLBAR + PANELS ──
document.getElementById("btn-back").addEventListener("click", () => { const t = activeTab(); if (t && t.el.tagName === "IFRAME") t.el.contentWindow.history.back(); });
document.getElementById("btn-fwd").addEventListener("click", () => { const t = activeTab(); if (t && t.el.tagName === "IFRAME") t.el.contentWindow.history.forward(); });
document.getElementById("btn-reload").addEventListener("click", () => { const t = activeTab(); if (t && t.el.tagName === "IFRAME") { startLoad(); t.el.src = t.el.src; } });
document.getElementById("btn-home").addEventListener("click", () => { const t = activeTab(); if (t) loadMemento(t); });
document.getElementById("btn-new-tab").addEventListener("click", () => newTab());
document.getElementById("btn-newid").addEventListener("click", async () => { const h = await NewIdentity(); statusText.textContent = "◈ new identity — " + h; setTimeout(() => statusText.textContent = "", 3000); const t = activeTab(); if (t && !t.isMemento) loadURL(t, t.url); });

urlInput.addEventListener("keydown", (e) => { if (e.key === "Enter") { navigate(urlInput.value); urlInput.blur(); } });
urlInput.addEventListener("focus", () => urlInput.select());

const shield = document.getElementById("shield-panel");
const country = document.getElementById("country-panel");
document.getElementById("btn-shield").addEventListener("click", async (e) => { e.stopPropagation(); country.classList.add("hidden"); shield.classList.toggle("hidden"); if (!shield.classList.contains("hidden")) { const ip = document.getElementById("shield-ip"); ip.textContent = "◐ checking exit ip…"; try { const r = await fetch(PROXY + "/browse?url=" + encodeURIComponent("https://check.torproject.org/api/ip")); const txt = await r.text(); const m = txt.match(/"IP":"([^"]+)"/); ip.innerHTML = '<span class="sg">●</span> exit ip: ' + (m ? m[1] : "unknown"); } catch { ip.innerHTML = '<span class="sg">●</span> exit ip: unknown'; } const hash = await SessionHash(); document.getElementById("shield-hash").textContent = "session: " + hash.slice(0, 32) + "…"; } });
document.getElementById("btn-country").addEventListener("click", (e) => { e.stopPropagation(); shield.classList.add("hidden"); country.classList.toggle("hidden"); if (!country.classList.contains("hidden")) document.getElementById("country-search").focus(); });
document.getElementById("country-search").addEventListener("input", (e) => renderCountries(e.target.value));
document.addEventListener("click", (e) => { if (!shield.contains(e.target) && e.target.id !== "btn-shield") shield.classList.add("hidden"); if (!country.contains(e.target) && e.target.id !== "btn-country") country.classList.add("hidden"); });

document.getElementById("mode-phantom").addEventListener("click", async () => { await SetMode("phantom"); document.getElementById("mode-phantom").classList.add("active"); document.getElementById("mode-stealth").classList.remove("active"); document.getElementById("mode-hint").textContent = "phantom — sites see Ghoster on PhantomOS"; const t = activeTab(); if (t && !t.isMemento) loadURL(t, t.url); });
document.getElementById("mode-stealth").addEventListener("click", async () => { await SetMode("stealth"); document.getElementById("mode-stealth").classList.add("active"); document.getElementById("mode-phantom").classList.remove("active"); document.getElementById("mode-hint").textContent = "stealth — sites see Firefox on Windows"; const t = activeTab(); if (t && !t.isMemento) loadURL(t, t.url); });

function initTabs() { newTab(); }

boot();
