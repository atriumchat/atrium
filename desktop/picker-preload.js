// Bridge for the screen-share picker window only (picker.html → screen-picker.js in the main process).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('gomexPicker', {
  /** "window" or "screen" → { sources: [{ id, name, thumb, icon }] }, or { error: true }. */
  list: (kind) => ipcRenderer.invoke('picker:list', String(kind)),
  /** Share this one; `sound` says whether the computer's sound goes with it. */
  choose: (id, sound) => ipcRenderer.send('picker:choose', String(id), sound === true),
  cancel: () => ipcRenderer.send('picker:cancel'),
});
