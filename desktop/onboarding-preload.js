// Bridge for the "Свой сервер" window only (onboarding.html → server-setup.js in the main process).
const { contextBridge, ipcRenderer } = require('electron');

const call = (name, ...args) => ipcRenderer.invoke(`setup:${name}`, ...args);

contextBridge.exposeInMainWorld('gomexSetup', {
  openExternal: (url) => call('open-external', String(url)),
  /** { host, user, password } → { facts: { ip, os, size } } or { error, field? }. */
  connect: (login) => call('connect', login),
  register: (form) => call('register', form),
  /** Resolves once the link in deSEC's letter is pressed and the name points at the server. */
  waitMail: (where) => call('wait-mail', where),
  cancelMail: () => call('cancel-mail'),
  checkDomain: (domain) => call('check-domain', domain),
  connectDrive: () => call('connect-drive'),
  /**
   * Runs the installer; `onEvent` gets each step as it goes ({ step, state: run|done|fail|sub }, { state: 'out', text }),
   * then { state: 'ready', url } and, once the address answers from this computer, { state: 'open' }, or a failure.
   */
  install: (options, onEvent) => {
    ipcRenderer.removeAllListeners('setup:event');
    ipcRenderer.on('setup:event', (_event, data) => onEvent(data));
    return call('install', options);
  },
  /** Opens the new server in the app (its first-run wizard), for good. */
  openServer: (url) => call('open-server', String(url)),
});
