// preload.js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  openFile: () => ipcRenderer.invoke('dialog:openFile'),
  selectGamePath: () => ipcRenderer.invoke('dialog:selectGamePath'),
  onUpdateGamePath: (callback) => ipcRenderer.on('update-game-path', (_event, value) => callback(value)),
  // 新增：監聽狀態更新
  onUpdateStatus: (callback) => ipcRenderer.on('update-status', (_event, value) => callback(value))
});

contextBridge.exposeInMainWorld('config', {
  getGamePath: () => ipcRenderer.invoke('config:getGamePath')
});

contextBridge.exposeInMainWorld('i18n', {
  getLocale: () => ipcRenderer.invoke('i18n:getLocale'),
});