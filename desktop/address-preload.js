// Bridge for the "Server address" window only.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('atriumAddress', {
  /** Returns an error message if the address could not be used. `signIn`: open straight on sign-in. */
  save: (url, opts) => ipcRenderer.invoke('address:save', String(url), { signIn: Boolean(opts?.signIn) }),
  /** Opens the server install guide in the browser. */
  guide: () => ipcRenderer.invoke('address:guide'),
  /** The globe in the corner: switches the app's language ('ru' | 'en'), as the tray's menu does. */
  language: (choice) => ipcRenderer.invoke('address:language', choice),
  onLanguage: (callback) => {
    const listener = (_event, lang) => callback(lang);
    ipcRenderer.on('address:language', listener);
    return () => ipcRenderer.removeListener('address:language', listener);
  },
  /** "Your own server": opens the window that sets one up from here. */
  setup: () => ipcRenderer.invoke('address:setup'),
});
