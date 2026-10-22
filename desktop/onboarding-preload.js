// Bridge for the "Your own server" window only (desktop/ui's onboarding page → server-setup.js in the main process).
const { contextBridge, ipcRenderer } = require('electron');

const call = (name, ...args) => ipcRenderer.invoke(`setup:${name}`, ...args);

contextBridge.exposeInMainWorld('atriumSetup', {
  openExternal: (url) => call('open-external', String(url)),
  /** { host, user, password } → { facts: { ip, os, size } } or { error, field? }. */
  connect: (login) => call('connect', login),
  /** "No server?": a new key for the app (its public line), the server rented with it, then into it as root. */
  appKey: () => call('app-key'),
  connectKey: (host) => call('connect-key', String(host)),
  /** One request to HostVDS's API ({ method, url, body?, token? } → { status, token?, json }). */
  hostvds: (request) => call('hostvds', request),
  register: (form) => call('register', form),
  /** Resolves once the link in deSEC's letter is pressed and the name points at the server. */
  waitMail: (where) => call('wait-mail', where),
  cancelMail: () => call('cancel-mail'),
  /** { domain } of the free address an earlier server here left, or { domain: null }. */
  savedAddress: () => call('saved-address'),
  /** Points that saved address at the new server: { ok, domain } or { error }. */
  useSaved: (where) => call('use-saved', where),
  checkDomain: (domain) => call('check-domain', domain),
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
