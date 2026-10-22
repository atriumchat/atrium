// Bridge for the splash only: it says when its animation is over, and the welcome window takes its place.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('atriumSplash', {
  done: () => ipcRenderer.send('splash:done'),
});
