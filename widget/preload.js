const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("aab", {
  getSettings: () => ipcRenderer.invoke("settings:get"),
  saveSettings: (patch) => ipcRenderer.invoke("settings:save", patch),
  captureLink: (url) => ipcRenderer.invoke("capture-link", url),
  captureLogin: (site) => ipcRenderer.invoke("capture-login", site),
  showPopup: (data) => ipcRenderer.invoke("popup:show", data),
  popupOpen: (id) => ipcRenderer.invoke("popup:open", id),
  popupClose: () => ipcRenderer.invoke("popup:close"),
  hide: () => ipcRenderer.invoke("window:hide"),
  openExternal: (url) => ipcRenderer.invoke("open-external", url),
  onOpenRequest: (fn) => ipcRenderer.on("open-request", (_e, id) => fn(id)),
  getUpdate: () => ipcRenderer.invoke("update:get"),
  checkUpdate: () => ipcRenderer.invoke("update:check"),
  installUpdate: () => ipcRenderer.invoke("update:install"),
  onUpdate: (fn) => ipcRenderer.on("update", (_e, u) => fn(u)),
});
