const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ipc', {
  send: (channel, data) => ipcRenderer.send(channel, data),
  on: (channel, cb) => ipcRenderer.on(channel, (e, ...args) => cb(...args)),
  invoke: (channel, data) => ipcRenderer.invoke(channel, data),
});
