const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('installer', {
  // Window controls
  minimize: () => ipcRenderer.send('win-min'),
  maximize: () => ipcRenderer.send('win-max'),
  close: () => ipcRenderer.send('win-close'),

  // Installer flow
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  checkLatestVersion: () => ipcRenderer.invoke('check-latest-version'),
  startDownload: (url, destPath) => ipcRenderer.invoke('start-download', { url, destPath }),
  cancelDownload: () => ipcRenderer.send('cancel-download'),
  installApp: (installerPath, installDir, password) => ipcRenderer.invoke('install-app', { installerPath, installDir, password }),
  launchApp: () => ipcRenderer.invoke('launch-app'),
  selectInstallDir: () => ipcRenderer.invoke('select-install-dir'),
  tryBrowser: () => ipcRenderer.invoke('try-browser'),
  quit: () => ipcRenderer.invoke('quit-installer'),

  // Events
  onInit: (cb) => ipcRenderer.on('init', (e, data) => cb(data)),
  onDownloadProgress: (cb) => ipcRenderer.on('download-progress', (e, p) => cb(p)),
  onInstallProgress: (cb) => ipcRenderer.on('install-progress', (e, s) => cb(s)),
});
