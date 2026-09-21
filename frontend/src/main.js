import "./style.css";
import iconUrl from "./assets/images/icon-ui.png";
import { recordHistory, stepHistory } from "./history.js";
import { nextTabIndex, numberedTabIndex, rememberClosed } from "./tab-actions.js";
import { ClipboardSetText, EventsOn } from "../wailsjs/runtime/runtime.js";
import {
  TorStatus, SessionHash, VerifyIntegrity, NewIdentity,
  Countries, SetCountry, GetGeo, SearchFast, SearchPage, SearchDarkPage, ProxyAddr,
} from "../wailsjs/go/main/App";

let PROXY = "http://127.0.0.1:8888";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = (s) => (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// ── BOOT ──
async function boot() {
  const proxyAddr = await ProxyAddr();
  document.getElementById("splash-logo").src = iconUrl;
  document.getElementById("ghost-icon").src = iconUrl;
  if (!proxyAddr) {
    document.getElementById("splash-status").textContent = "local gateway offline";
    document.getElementById("splash-bar").style.background = "var(--red)";
    return;
  }
  PROXY = "http://" + proxyAddr;
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
let tabs = [], closedTabs = [], activeId = null, counter = 0;

function newTab(url, options = {}) {
  const { activate = true, jsEnabled = false } = options;
  const id = "t" + (++counter);
  const tab = {
    id, title: "ghoster", url: url || "", isMemento: !url,
    searchData: null, searchFilter: "all", searchToken: 0,
    history: url ? [url] : [], historyIndex: url ? 0 : -1,
    pendingURL: url || "", jsEnabled,
  };

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
    f.src = browseURL(tab, url);
    f.addEventListener("load", () => finishLoad());
    viewContainer.appendChild(f);
    tab.el = f;
  }
  tabs.push(tab);
  if (activate) switchTab(id);
  renderTabs();
  if (tab.isMemento) wireMemento(tab);
  return tab;
}

function switchTab(id) {
  activeId = id;
  tabs.forEach((t) => t.el.classList.toggle("active-view", t.id === id));
  const t = tabs.find((x) => x.id === id);
  if (t) { urlInput.value = t.isMemento ? "" : t.url; document.getElementById("url-lock").textContent = t.isMemento ? "◈" : "▪"; }
  updateJSUI(t);
  renderTabs();
}

function closeTab(id, remember = true) {
  const i = tabs.findIndex((t) => t.id === id);
  if (i === -1) return;
  const closing = tabs[i];
  if (remember) {
    rememberClosed(closedTabs, {
      url: closing.url,
      query: closing.searchData?.query || "",
      jsEnabled: closing.jsEnabled,
    });
  }
  if (tabs.length === 1) { newTab(); }
  const wasActive = activeId === id;
  closing.el.remove();
  tabs.splice(i, 1);
  if (wasActive && tabs.length) switchTab(tabs[Math.min(i, tabs.length - 1)].id);
  renderTabs();
}

function reopenClosedTab() {
  const closed = closedTabs.pop();
  if (!closed) return;
  const tab = newTab(closed.url || undefined, { jsEnabled: closed.jsEnabled });
  if (closed.query) searchInTab(tab, closed.query);
}

function duplicateTab(tab = activeTab()) {
  if (!tab) return;
  if (tab.searchData?.query) {
    const copy = newTab();
    searchInTab(copy, tab.searchData.query);
    return;
  }
  newTab(tab.url || undefined, { jsEnabled: tab.jsEnabled });
}

function cycleTab(delta) {
  const current = tabs.findIndex((tab) => tab.id === activeId);
  const next = nextTabIndex(tabs.length, current, delta);
  if (next >= 0) switchTab(tabs[next].id);
}

function switchNumberedTab(number) {
  const index = numberedTabIndex(number, tabs.length);
  if (index >= 0) switchTab(tabs[index].id);
}

function renderTabs() {
  tabsEl.innerHTML = "";
  tabs.forEach((t) => {
    const el = document.createElement("div");
    el.className = "tab" + (t.id === activeId ? " active" : "");
    el.dataset.tabId = t.id;
    el.innerHTML = `<span class="tab-title">${esc(t.title)}</span><button class="tab-close">×</button>`;
    el.addEventListener("click", () => switchTab(t.id));
    el.querySelector(".tab-close").addEventListener("click", (e) => { e.stopPropagation(); closeTab(t.id); });
    tabsEl.appendChild(el);
  });
}

function activeTab() { return tabs.find((t) => t.id === activeId); }

const contextMenu = document.createElement("div");
contextMenu.className = "context-menu hidden";
document.body.appendChild(contextMenu);

function hideContextMenu() {
  contextMenu.classList.add("hidden");
  contextMenu.innerHTML = "";
}

function menuItem(label, action, disabled = false) {
  const button = document.createElement("button");
  button.className = "context-item";
  button.textContent = label;
  button.disabled = disabled;
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    hideContextMenu();
    if (!disabled) action();
  });
  contextMenu.appendChild(button);
}

function menuSeparator() {
  const separator = document.createElement("div");
  separator.className = "context-separator";
  contextMenu.appendChild(separator);
}

function showContextMenu({ x, y, linkURL = "", selection = "", tab = activeTab() }) {
  if (!tab) return;
  hideContextMenu();

  if (linkURL) {
    menuItem("Open Link in New Tab", () => newTab(linkURL, { activate: false, jsEnabled: tab.jsEnabled }));
    menuItem("Open Link in Current Tab", () => loadURL(tab, linkURL));
    menuItem("Copy Link Address", () => ClipboardSetText(linkURL));
    menuSeparator();
  }
  if (selection) {
    menuItem("Copy Selection", () => ClipboardSetText(selection));
    menuSeparator();
  }

  menuItem("Back", () => goBack(tab), tab.isMemento || tab.historyIndex <= 0);
  menuItem("Forward", () => goForward(tab), tab.isMemento || tab.historyIndex >= tab.history.length - 1);
  menuItem("Reload", () => refreshTab(tab));
  menuSeparator();
  menuItem("Duplicate Tab", () => duplicateTab(tab));
  menuItem("Copy Page Address", () => ClipboardSetText(tab.url), !tab.url);
  menuItem("New Tab", () => newTab());
  menuItem("Reopen Closed Tab", reopenClosedTab, closedTabs.length === 0);
  menuItem("Close Tab", () => closeTab(tab.id));

  contextMenu.classList.remove("hidden");
  const left = Math.max(8, Math.min(x, window.innerWidth - contextMenu.offsetWidth - 8));
  const top = Math.max(8, Math.min(y, window.innerHeight - contextMenu.offsetHeight - 8));
  contextMenu.style.left = left + "px";
  contextMenu.style.top = top + "px";
}

let lastShortcutAction = "", lastShortcutAt = 0;
function performShortcut(action) {
  const now = performance.now();
  if (action === lastShortcutAction && now - lastShortcutAt < 80) return;
  lastShortcutAction = action;
  lastShortcutAt = now;

  if (action === "new-tab") newTab();
  else if (action === "reopen-tab") reopenClosedTab();
  else if (action === "duplicate-tab") duplicateTab();
  else if (action === "close-tab") { if (activeId) closeTab(activeId); }
  else if (action === "back") goBack();
  else if (action === "forward") goForward();
  else if (action === "reload") refreshActive();
  else if (action === "focus-location") { urlInput.focus(); urlInput.select(); }
  else if (action === "next-tab") cycleTab(1);
  else if (action === "previous-tab") cycleTab(-1);
  else if (/^tab-[1-9]$/.test(action)) switchNumberedTab(Number(action.slice(4)));
}

EventsOn("ghoster:shortcut", performShortcut);

// Browsed documents run on the local proxy origin, so they report their
// logical remote URL/title with postMessage. This keeps chrome synchronized
// after link clicks, redirects, back, and forward.
window.addEventListener("message", (event) => {
  const data = event.data;
  if (!data) return;
  const tab = tabs.find((t) => t.el.tagName === "IFRAME" && t.el.contentWindow === event.source);
  if (!tab) return;
  if (data.type === "ghoster-open-tab" && /^https?:\/\//.test(data.url || "")) {
    newTab(data.url, { activate: !data.background, jsEnabled: tab.jsEnabled });
    return;
  }
  if (data.type === "ghoster-context") {
    const rect = tab.el.getBoundingClientRect();
    showContextMenu({
      x: rect.left + Number(data.x || 0),
      y: rect.top + Number(data.y || 0),
      linkURL: /^https?:\/\//.test(data.linkURL || "") ? data.linkURL : "",
      selection: data.selection || "",
      tab,
    });
    return;
  }
  if (data.type === "ghoster-key") {
    if (data.altKey && data.key === "ArrowLeft") performShortcut("back");
    else if (data.altKey && data.key === "ArrowRight") performShortcut("forward");
    return;
  }
  if (data.type !== "ghoster-nav" || !/^https?:\/\//.test(data.url || "")) return;
  if (tab.pendingURL) {
    if (data.url !== tab.pendingURL && tab.historyIndex >= 0) {
      // A redirect replaces the requested entry instead of adding a loop.
      tab.history[tab.historyIndex] = data.url;
    }
    tab.pendingURL = "";
  } else if (data.url !== tab.url) {
    recordHistory(tab, data.url);
  }
  tab.url = data.url;
  if (data.title) tab.title = data.title;
  if (tab.id === activeId) urlInput.value = tab.url;
  renderTabs();
});

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

function loadURL(t, url, record = true) {
  startLoad();
  t.searchToken++;
  t.searchData = null;
  if (record) recordHistory(t, url);
  t.pendingURL = url;
  t.isMemento = false; t.url = url; t.title = new URL(url).hostname;
  if (t.el.tagName !== "IFRAME") {
    const f = document.createElement("iframe");
    f.id = t.id; f.addEventListener("load", () => finishLoad());
    t.el.replaceWith(f); t.el = f;
  }
  t.el.src = browseURL(t, url);
  t.el.classList.add("active-view");
  urlInput.value = url;
  document.getElementById("url-lock").textContent = "▪";
  renderTabs();
}

function loadMemento(t) {
  t.searchToken++;
  t.searchData = null;
  t.searchFilter = "all";
  t.jsEnabled = false;
  t.pendingURL = "";
  t.isMemento = true; t.url = ""; t.title = "ghoster";
  const div = document.createElement("div");
  div.className = "memento-view active-view"; div.id = t.id;
  div.innerHTML = mementoHTML();
  t.el.replaceWith(div); t.el = div;
  urlInput.value = "";
  document.getElementById("url-lock").textContent = "◈";
  wireMemento(t);
  updateJSUI(t);
  renderTabs();
}

function browseURL(tab, url) {
  return PROXY + "/browse?js=" + (tab.jsEnabled ? "1" : "0") + "&url=" + encodeURIComponent(url);
}

// ── MEMENTO (native, in-app) ──

// ghostMark is the real app icon with a light that travels along the ring
// already drawn in the artwork. icon-ui.png is a transparent crop of the real
// icon; the ring is centred at 180,180 with radius 144 in its 360px space.
function ghostMark() {
  return `<img class="m-mark" src="${iconUrl}" alt="ghoster">
  <svg class="m-halo" viewBox="0 0 360 360" aria-hidden="true">
    <circle class="m-ring-arc" cx="180" cy="180" r="144" fill="none"
      stroke="#9fe3ff" stroke-width="26" stroke-linecap="round"/>
  </svg>`;
}

function mementoHTML() {
  return `
  <div class="m-wrap">
    <div class="m-home" id="m-home">
      <div class="m-logo"><span class="m-logo-wrap">${ghostMark()}</span><span>ghoster</span></div>
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
    .m-logo-wrap{position:relative;display:inline-flex;width:52px;height:52px;}
    .m-mark{width:100%;height:100%;}
    /* a light runs along the icon's own ring: slow idle, fast while searching */
    .m-halo{position:absolute;inset:0;width:100%;height:100%;mix-blend-mode:screen;pointer-events:none;}
    .m-ring-arc{opacity:.5;stroke-dasharray:110 795;transform-box:view-box;transform-origin:180px 180px;animation:m-orbit 3.6s linear infinite;}
    .m-logo-wrap.searching .m-ring-arc{opacity:.85;stroke-dasharray:300 605;animation-duration:.8s;}
    .m-home.has .m-logo-wrap{width:34px;height:34px;}
    @keyframes m-orbit{to{transform:rotate(360deg);}}
    .m-logo span{font-size:38px;font-weight:300;letter-spacing:8px;}
    .m-philo{font-size:11px;color:#5a5a6e;letter-spacing:6px;text-transform:lowercase;opacity:.6;margin-top:-14px;text-align:center;width:100%;}
    .m-home.has .m-logo span{font-size:22px;}
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
    .m-pager{display:flex;align-items:center;justify-content:center;gap:14px;margin:28px 0 8px;}
    .m-page{background:#0e0e14;border:1px solid #252535;color:#d0d0dc;border-radius:8px;padding:8px 18px;font-size:12px;letter-spacing:1px;cursor:pointer;}
    .m-page:disabled{opacity:.25;cursor:default;}
    .m-page:not(:disabled):hover{border-color:#8b7cf6;color:#fff;}
    .m-page-n{font-size:12px;color:#5a5a6e;letter-spacing:3px;}
    .m-range{text-align:center;font-size:11px;color:#5a5a6e;letter-spacing:1px;margin-bottom:8px;}
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

const PAGE = 20;

function filtered(tab) {
  const data = tab.searchData;
  if (!data) return [];
  const web = data.web || [], onion = data.onion || [], torrent = data.torrent || [];
  if (tab.searchFilter === "web") return web;
  if (tab.searchFilter === "onion") return onion;
  if (tab.searchFilter === "torrent") return torrent;
  return [...web, ...onion, ...torrent];
}

async function doSearch(tab, query) {
  query = query.trim();
  if (!query) return;
  const token = ++tab.searchToken;
  const root = tab.el;
  root.querySelector(".m-home").classList.add("has");
  const ring = root.querySelector(".m-logo-wrap");
  if (ring) ring.classList.add("searching");
  const rc = root.querySelector(".m-results");
  rc.innerHTML = '<div class="m-load">searching…</div>';
  tab.title = query;
  renderTabs();
  const box = root.querySelector(".m-input");
  if (box) box.value = query;

  tab.searchData = {
    web: [], onion: [], torrent: [], query, page: 1,
    webEnginePage: 1, darkEnginePage: 1,
    webHasMore: true, darkHasMore: true, loading: true,
  };
  tab.searchFilter = "all";

  // The Wails bridge may serialize bound calls, so the fast tier must be sent
  // first. Starting deep/dark calls before it can queue first paint behind the
  // slowest onion request.
  try {
    const fast = await SearchFast(query);
    if (token !== tab.searchToken) return;
    tab.searchData.web = fast.web || [];
    tab.searchData.webHasMore = !!fast.hasMore;
    if (!tab.searchData.web.length) {
      const fallback = await SearchPage(query, 1);
      if (token !== tab.searchToken) return;
      tab.searchData.web = fallback.web || [];
      tab.searchData.webHasMore = !!fallback.hasMore;
    }
  } catch (e) {
    if (token !== tab.searchToken) return;
    try {
      const fallback = await SearchPage(query, 1);
      if (token !== tab.searchToken) return;
      tab.searchData.web = fallback.web || [];
      tab.searchData.webHasMore = !!fallback.hasMore;
    } catch (_) {
      tab.searchData.webHasMore = false;
    }
  }
  if (token !== tab.searchToken) return;
  tab.searchData.loading = false;
  if (ring) ring.classList.remove("searching");
  renderResults(tab);

  // Deeper tiers begin only after the first result screen is visible.
  const paged = SearchPage(query, 1);
  const dark = SearchDarkPage(query, 1);
  paged.then((more) => {
    if (token !== tab.searchToken || !tab.searchData) return;
    tab.searchData.web = mergeResults(tab.searchData.web, more.web || []);
    tab.searchData.webHasMore = tab.searchData.webHasMore || !!more.hasMore;
    if (activeTab() === tab) renderResults(tab);
    // Warm the next web page so the first Next click is normally a cache hit.
    SearchPage(query, 2).catch(() => {});
  }).catch(() => {});

  dark.then((darkResults) => {
    if (token !== tab.searchToken || !tab.searchData) return;
    tab.searchData.onion = darkResults.onion || [];
    tab.searchData.torrent = darkResults.torrent || [];
    tab.searchData.darkHasMore = !!darkResults.hasMore;
    if (activeTab() === tab) renderResults(tab);
  }).catch(() => {
    if (token === tab.searchToken && tab.searchData) tab.searchData.darkHasMore = false;
  });
}

// mergeResults appends new hits, skipping URLs already on screen.
function mergeResults(current, extra) {
  const key = (u) => (u || "").replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");
  const seen = new Set(current.map((r) => key(r.url)));
  for (const r of extra) {
    const k = key(r.url);
    if (seen.has(k)) continue;
    seen.add(k);
    current.push(r);
  }
  return current;
}

async function goPage(tab, dir) {
  const data = tab.searchData;
  if (!data || data.loading) return;
  const next = data.page + dir;
  if (next < 1) return;
  const need = next * PAGE;
  const wantsWeb = tab.searchFilter === "all" || tab.searchFilter === "web";
  const wantsDark = tab.searchFilter === "all" || tab.searchFilter === "onion" || tab.searchFilter === "torrent";
  let canFetch = (wantsWeb && data.webHasMore) || (wantsDark && data.darkHasMore);
  if (filtered(tab).length < need && canFetch) {
    const ring = tab.el.querySelector(".m-logo-wrap");
    if (ring) ring.classList.add("searching");
    data.loading = true;
    renderResults(tab);

    // An engine page is commonly only 10 hits. Keep walking until the visible
    // UI page has 20, the engines are exhausted, or four sweeps have run.
    for (let sweep = 0; sweep < 4 && filtered(tab).length < need && canFetch; sweep++) {
      const jobs = [];
      if (wantsWeb && data.webHasMore) {
        const page = ++data.webEnginePage;
        jobs.push(SearchPage(data.query, page).then((web) => {
          data.web = mergeResults(data.web, web.web || []);
          data.webHasMore = !!web.hasMore;
        }).catch(() => { data.webHasMore = false; }));
      }
      if (wantsDark && data.darkHasMore) {
        const page = ++data.darkEnginePage;
        jobs.push(SearchDarkPage(data.query, page).then((dark) => {
          data.onion = mergeResults(data.onion, dark.onion || []);
          data.torrent = mergeResults(data.torrent, dark.torrent || []);
          data.darkHasMore = !!dark.hasMore;
        }).catch(() => { data.darkHasMore = false; }));
      }
      await Promise.all(jobs);
      if (tab.searchData !== data) return;
      canFetch = (wantsWeb && data.webHasMore) || (wantsDark && data.darkHasMore);
    }

    data.loading = false;
    if (ring) ring.classList.remove("searching");
  }
  const have = filtered(tab).length;
  const stillMore = (wantsWeb && data.webHasMore) || (wantsDark && data.darkHasMore);
  if (dir > 0 && have <= (data.page - 1) * PAGE && !stillMore) return;
  if (next > Math.ceil(have / PAGE) && !stillMore) return;
  data.page = next;
  renderResults(tab);
}

function renderResults(tab) {
  const data = tab.searchData;
  if (!data) return;
  const rc = tab.el.querySelector(".m-results");
  const list = filtered(tab);
  if (!list.length) { rc.innerHTML = '<div class="m-empty">nothing found — even ghosts have limits</div>'; return; }

  const pages = Math.max(1, Math.ceil(list.length / PAGE));
  if (data.page > pages) data.page = pages;
  const from = (data.page - 1) * PAGE;
  const slice = list.slice(from, from + PAGE);
  const to = from + slice.length;
  const more = ((tab.searchFilter === "all" || tab.searchFilter === "web") && data.webHasMore) ||
    ((tab.searchFilter === "all" || tab.searchFilter === "onion" || tab.searchFilter === "torrent") && data.darkHasMore);
  const canPrev = data.page > 1;
  const canNext = !data.loading && (data.page < pages || more);

  let h = '<div class="m-tabs">';
  h += stab(tab, "all", "all") + stab(tab, "web", "◈ web") + stab(tab, "onion", "▣ onion") + stab(tab, "torrent", "▾ torrents");
  h += "</div>";
  h += `<div class="m-range">results ${from + 1}–${to}${more ? " · more available" : ""}</div>`;
  for (const r of slice) {
    const b = r.source === "onion" ? "b-onion" : r.source === "torrent" ? "b-torrent" : "b-web";
    let disp = r.url;
    try { if (r.source !== "torrent") disp = new URL(r.url).hostname; else disp = "magnet"; } catch {}
    h += `<div class="m-res"><div class="m-url"><span class="m-badge ${b}">${r.source}</span>${esc(disp)}</div><a class="m-title" data-url="${esc(r.url)}" data-src="${r.source}">${esc(r.title)}</a>${r.snippet ? `<div class="m-snip">${esc(r.snippet)}</div>` : ""}</div>`;
  }
  h += `<div class="m-pager"><button class="m-page" id="m-prev" ${canPrev && !data.loading ? "" : "disabled"}>← prev</button><span class="m-page-n">${data.loading ? "loading…" : "page " + data.page}</span><button class="m-page" id="m-next" ${canNext ? "" : "disabled"}>next →</button></div>`;
  rc.innerHTML = h;
  rc.querySelectorAll(".m-stab").forEach((t) => t.addEventListener("click", () => { tab.searchFilter = t.dataset.src; data.page = 1; renderResults(tab); }));
  const prev = rc.querySelector("#m-prev");
  const next = rc.querySelector("#m-next");
  if (prev) prev.addEventListener("click", () => goPage(tab, -1));
  if (next) next.addEventListener("click", () => goPage(tab, 1));
  rc.querySelectorAll(".m-title").forEach((a) => a.addEventListener("click", () => {
    const url = a.dataset.url;
    if (a.dataset.src === "torrent") { window.runtime && window.runtime.BrowserOpenURL(url); }
    else loadURL(activeTab(), url);
  }));
}
function stab(tab, src, label) { return `<button class="m-stab${tab.searchFilter === src ? " active" : ""}" data-src="${src}">${label}</button>`; }

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
    el.addEventListener("click", async () => { activeCountry = c.code; await SetCountry(c.code); renderCountries(filter); document.getElementById("country-panel").classList.add("hidden"); const t = activeTab(); if (t && !t.isMemento) loadURL(t, t.url, false); });
    list.appendChild(el);
  });
}

// ── TOOLBAR + PANELS ──
function goBack(t = activeTab()) {
  if (!t || t.el.tagName !== "IFRAME") return;
  const url = stepHistory(t, -1);
  if (url) loadURL(t, url, false);
}
function goForward(t = activeTab()) {
  if (!t || t.el.tagName !== "IFRAME") return;
  const url = stepHistory(t, 1);
  if (url) loadURL(t, url, false);
}
document.getElementById("btn-back").addEventListener("click", goBack);
document.getElementById("btn-fwd").addEventListener("click", goForward);
function refreshTab(t) {
  if (!t) return;
  if (t.isMemento) {
    const query = t.searchData?.query || t.el.querySelector(".m-input")?.value || "";
    if (query.trim()) doSearch(t, query);
    else loadMemento(t);
    return;
  }
  startLoad();
  t.pendingURL = t.url;
  t.el.src = browseURL(t, t.url);
}
function refreshActive() { refreshTab(activeTab()); }
document.getElementById("btn-reload").addEventListener("click", refreshActive);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") { hideContextMenu(); return; }
  // Packaged builds use native menu accelerators so shortcuts work even while
  // WebKit content owns focus. Keep JS bindings only for browser-based dev.
  if (window.runtime) return;
  const mod = e.metaKey || e.ctrlKey;
  const key = e.key.toLowerCase();
  if (mod && key === "r") { e.preventDefault(); performShortcut("reload"); }
  else if (mod && key === "l") { e.preventDefault(); performShortcut("focus-location"); }
  else if (mod && e.shiftKey && key === "t") { e.preventDefault(); performShortcut("reopen-tab"); }
  else if (mod && key === "t") { e.preventDefault(); performShortcut("new-tab"); }
  else if (mod && key === "w") { e.preventDefault(); performShortcut("close-tab"); }
  else if (e.ctrlKey && key === "tab") { e.preventDefault(); performShortcut(e.shiftKey ? "previous-tab" : "next-tab"); }
  else if (mod && /^[1-9]$/.test(key)) { e.preventDefault(); performShortcut("tab-" + key); }
  else if ((mod && e.key === "[") || (e.altKey && e.key === "ArrowLeft")) { e.preventDefault(); performShortcut("back"); }
  else if ((mod && e.key === "]") || (e.altKey && e.key === "ArrowRight")) { e.preventDefault(); performShortcut("forward"); }
});
document.getElementById("btn-home").addEventListener("click", () => { const t = activeTab(); if (t) loadMemento(t); });
document.getElementById("btn-new-tab").addEventListener("click", () => newTab());
document.getElementById("btn-newid").addEventListener("click", async () => {
  const h = await NewIdentity();
  tabs.forEach((tab) => { tab.jsEnabled = false; });
  statusText.textContent = "◈ new identity — " + h;
  setTimeout(() => statusText.textContent = "", 3000);
  const t = activeTab();
  updateJSUI(t);
  if (t && !t.isMemento) loadURL(t, t.url, false);
});

urlInput.addEventListener("keydown", (e) => { if (e.key === "Enter") { navigate(urlInput.value); urlInput.blur(); } });
urlInput.addEventListener("focus", () => urlInput.select());

const shield = document.getElementById("shield-panel");
const country = document.getElementById("country-panel");
document.getElementById("btn-shield").addEventListener("click", async (e) => { e.stopPropagation(); country.classList.add("hidden"); shield.classList.toggle("hidden"); if (!shield.classList.contains("hidden")) { updateJSUI(activeTab()); const ip = document.getElementById("shield-ip"); ip.textContent = "◐ checking exit ip…"; try { const r = await fetch(PROXY + "/browse?js=0&url=" + encodeURIComponent("https://check.torproject.org/api/ip")); const txt = await r.text(); const m = txt.match(/"IP":"([^"]+)"/); ip.innerHTML = '<span class="sg">●</span> exit ip: ' + (m ? m[1] : "unknown"); } catch { ip.innerHTML = '<span class="sg">●</span> exit ip: unknown'; } const hash = await SessionHash(); document.getElementById("shield-hash").textContent = "session: " + hash.slice(0, 32) + "…"; } });
document.getElementById("btn-country").addEventListener("click", (e) => { e.stopPropagation(); shield.classList.add("hidden"); country.classList.toggle("hidden"); if (!country.classList.contains("hidden")) document.getElementById("country-search").focus(); });
document.getElementById("country-search").addEventListener("input", (e) => renderCountries(e.target.value));
document.addEventListener("click", (e) => { hideContextMenu(); if (!shield.contains(e.target) && e.target.id !== "btn-shield") shield.classList.add("hidden"); if (!country.contains(e.target) && e.target.id !== "btn-country") country.classList.add("hidden"); });
document.addEventListener("contextmenu", (event) => {
  if (contextMenu.contains(event.target)) return;
  event.preventDefault();
  const result = event.target.closest?.("[data-url]");
  const tabElement = event.target.closest?.("[data-tab-id]");
  const tab = tabElement ? tabs.find((item) => item.id === tabElement.dataset.tabId) : activeTab();
  showContextMenu({
    x: event.clientX,
    y: event.clientY,
    linkURL: result?.dataset.url || "",
    selection: window.getSelection()?.toString().trim() || "",
    tab,
  });
});
window.addEventListener("blur", hideContextMenu);

function updateJSUI(tab) {
  const button = document.getElementById("btn-js");
  const hint = document.getElementById("js-hint");
  if (!button || !hint) return;
  const enabled = !!tab?.jsEnabled;
  button.classList.toggle("active", enabled);
  button.textContent = "javascript: " + (enabled ? "on" : "off");
  hint.textContent = enabled ? "site javascript enabled for this tab" : "site javascript is blocked by default";
}

document.getElementById("btn-js").addEventListener("click", () => {
  const tab = activeTab();
  if (!tab) return;
  tab.jsEnabled = !tab.jsEnabled;
  updateJSUI(tab);
  if (!tab.isMemento && tab.url) loadURL(tab, tab.url, false);
});

function initTabs() { newTab(); }

boot();
