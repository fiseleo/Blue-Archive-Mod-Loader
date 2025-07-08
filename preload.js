// preload.js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // 遊戲路徑相關
  selectGamePath: () => ipcRenderer.invoke('dialog:selectGamePath'),
  onUpdateGamePath: (callback) => ipcRenderer.on('update-game-path', (_event, value) => callback(value)),
  onUpdateStatus: (callback) => ipcRenderer.on('update-status', (_event, value) => callback(value)),

  // Mod 檔案相關
  selectModFiles: () => ipcRenderer.invoke('dialog:openFile'),
  getMods: () => ipcRenderer.invoke('mods:get'),
  updateMod: (mod) => ipcRenderer.invoke('mods:update', mod),
  deleteMod: (modId) => ipcRenderer.invoke('mods:delete', modId),

  applyMods: () => ipcRenderer.invoke('mods:apply'),
  uninstallMods: () => ipcRenderer.invoke('mods:uninstall'),
  launchGame: () => ipcRenderer.invoke('game:launch'),
});
contextBridge.exposeInMainWorld('config', {
  getGamePath: () => ipcRenderer.invoke('config:getGamePath')
});

contextBridge.exposeInMainWorld('i18n', {
  getLocale: () => ipcRenderer.invoke('i18n:getLocale'),
});