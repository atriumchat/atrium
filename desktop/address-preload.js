// Bridge for the "Server address" window only.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('atriumAddress', {
  /** Resolves to an error message, or never (the app restarts on success). */
  save: (url) => ipcRenderer.invoke('address:save', String(url)),
  /** Opens the server install guide in the browser. */
  guide: () => ipcRenderer.invoke('address:guide'),
  /** "Your own server": opens the window that sets one up from here. */
  setup: () => ipcRenderer.invoke('address:setup'),
});
