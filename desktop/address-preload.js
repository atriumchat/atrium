// Bridge for the "Адрес сервера" window only.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('gomexAddress', {
  /** Resolves to an error message, or never (the app restarts on success). */
  save: (url) => ipcRenderer.invoke('address:save', String(url)),
});
