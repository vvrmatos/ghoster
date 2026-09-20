const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("ghoster", {
  torStatus: () => ipcRenderer.invoke("tor-status"),
  newIdentity: () => ipcRenderer.invoke("new-identity"),
  sessionHash: () => ipcRenderer.invoke("session-hash"),
  verifyIntegrity: (data) => ipcRenderer.invoke("verify-integrity", data),
  getCountries: () => ipcRenderer.invoke("get-countries"),
  setCountry: (code) => ipcRenderer.invoke("set-country", code),
  getGeo: () => ipcRenderer.invoke("get-geo"),
  getUAMode: () => ipcRenderer.invoke("get-ua-mode"),
  setUAMode: (mode) => ipcRenderer.invoke("set-ua-mode", mode),
  mementoSearch: (query) => ipcRenderer.invoke("memento-search", query),
  onTorReady: (cb) => ipcRenderer.on("tor-ready", (_e, ok) => cb(ok)),
});
