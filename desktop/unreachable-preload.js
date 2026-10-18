// Bridge for the "Server unreachable" page only.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('gomexUnreachable', {
  /** Checks the server right now; resolves once the check is over (the window moves on by itself if it answers). */
  retry: () => ipcRenderer.invoke('unreachable:retry'),
});
