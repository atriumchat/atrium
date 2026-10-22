// The only bridge between the Atrium web app and the desktop shell. The page gets these few calls and
// nothing else: no Node, no file system, no Electron internals.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('gomexDesktop', {
  platform: process.platform,
  /** Someone is calling: bring the window up, bounce/flash, show a system notification. */
  incomingCall: (title, body) => ipcRenderer.send('call:incoming', { title: String(title), body: String(body) }),
  /** Answered, declined or stopped ringing. */
  callHandled: () => ipcRenderer.send('call:handled'),
  /** Unread count on the Dock / taskbar icon. */
  setBadge: (count) => ipcRenderer.send('badge', Number(count) || 0),
  /** A system notification for a new message while the window is hidden; clicking it opens `conversationId`. */
  notify: (title, body, conversationId) =>
    ipcRenderer.send('notify', { title: String(title), body: String(body), conversationId: String(conversationId) }),
  /** Called with a conversation id when a message notification is clicked. */
  onOpenConversation: (callback) => {
    ipcRenderer.on('open-conversation', (_event, id) => callback(String(id)));
  },
  /** Push-to-talk held anywhere (since 1.3.0): watch a key, hear it go down and up. */
  ptt: {
    watch: (code) => ipcRenderer.send('ptt:watch', code === null ? null : String(code)),
    onChange: (callback) => {
      ipcRenderer.on('ptt:state', (_event, down) => callback(Boolean(down)));
    },
  },
  /** The language choice shared with the desktop's tray menu: 'ru', 'en' or null (follow the system). A change made in the tray reaches the page as a `gomex-language` event on window, detail = the new choice. */
  language: {
    get: () => ipcRenderer.invoke('language:get'),
    set: (lang) => ipcRenderer.invoke('language:set', lang === 'ru' || lang === 'en' ? lang : null),
  },
  /** The app updating itself (since 1.2.0): its state, a check now, and restart-to-install. */
  update: {
    get: () => ipcRenderer.invoke('update:get'),
    check: () => ipcRenderer.invoke('update:check'),
    install: () => ipcRenderer.invoke('update:install'),
    onChange: (callback) => {
      ipcRenderer.on('update:state', (_event, state) => callback(state));
    },
  },
});
