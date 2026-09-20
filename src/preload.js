const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("ghoster", {
  torStatus: () => ipcRenderer.invoke("tor-status"),
  newIdentity: () => ipcRenderer.invoke("new-identity"),
  sessionHash: () => ipcRenderer.invoke("session-hash"),
  verifyIntegrity: (data) => ipcRenderer.invoke("verify-integrity", data),
  onTorReady: (cb) => ipcRenderer.on("tor-ready", (_e, ok) => cb(ok)),
});
