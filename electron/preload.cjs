// Exposes exactly one capability to the page: reading the public USD→HNL rate (see main.cjs).
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('azDesktop', {
  fetchText: (url) => ipcRenderer.invoke('az-fetch-rate', String(url)),
});
