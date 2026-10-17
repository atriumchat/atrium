// Gomex desktop: the web app of a Gomex server in its own window, plus what a browser tab can't do —
// stay alive in the menu bar / tray so calls always ring, bring itself up on a call, keep mic and
// camera permission, badge the icon and show system notifications.
const {
  app,
  BrowserWindow,
  Menu,
  Notification,
  Tray,
  ipcMain,
  nativeImage,
  powerMonitor,
  safeStorage,
  session,
  shell,
  systemPreferences,
} = require('electron');
const fs = require('node:fs');
const path = require('node:path');

// Developer overrides, for `npm start` only: an installed app ignores them, so nothing in the environment can
// point it at another server, another update feed or another settings folder.
const devEnv = (name) => (app.isPackaged ? undefined : process.env[name]);

// A separate settings folder, to run a second copy next to the installed one.
if (devEnv('GOMEX_USER_DATA')) app.setPath('userData', devEnv('GOMEX_USER_DATA'));
const updater = require('./updater');
const ptt = require('./ptt');
const serverSetup = require('./server-setup');
const screenPicker = require('./screen-picker');
const reachable = require('./reachable');

// The server address can be changed from the tray ("Адрес сервера…") if Gomex ever has to move to a
// new domain — no reinstall. Stored in the app's settings folder.
const CONFIG_FILE = path.join(app.getPath('userData'), 'config.json');
function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch {
    return {};
  }
}

// A server is the default only in builds made for one: GOMEX_DEFAULT_URL in release-desktop.sh puts the address into
// package.json (electron-builder's extraMetadata). Any other build first asks where its server is.
const DEFAULT_URL = require('./package.json').gomexDefaultUrl || '';
const APP_URL = devEnv('GOMEX_URL') || readConfig().url || DEFAULT_URL;
const ORIGIN = APP_URL ? new URL(APP_URL).origin : '';
// An invite link pasted on first start (address:save): its path and query are opened once, so sign-up comes with
// the invite in place, then forgotten.
const PENDING = readConfig().open;
const START_URL = ORIGIN && typeof PENDING === 'string' && PENDING.startsWith('/') ? ORIGIN + PENDING : APP_URL;
if (PENDING !== undefined) {
  const { open: _open, ...rest } = readConfig();
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(rest, null, 2));
  } catch {
    // Not fatal: the invite would just open again next time.
  }
}
// Where "Свой сервер" on the first start leads.
const SERVER_GUIDE = 'https://gomex.party/server-install';
// The app's own updates come from the project's GitHub Releases whatever server it talks to, and only signed ones
// install (updater.js). release-desktop.sh puts the manifest's address into package.json, like the server's; a build
// without it never updates.
const UPDATE_MANIFEST = require('./package.json').gomexUpdateUrl || '';
const isMac = process.platform === 'darwin';

// The ringtone must play the moment a call comes in, without the user having clicked the page first.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

/** @type {BrowserWindow | null} */
let win = null;
/** @type {Tray | null} */
let tray = null;
/** @type {Notification | null} */
let callNotification = null;
let quitting = false;

const fromGomex = (url) => {
  if (!ORIGIN) return false;
  try {
    return new URL(url).origin === ORIGIN;
  } catch {
    return false;
  }
};

function showWindow() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 380,
    minHeight: 560,
    title: 'Gomex',
    backgroundColor: '#0b0b0d',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      // Keep sockets, timers and the ringtone running while the window is hidden: a throttled page can take up
      // to a minute to reconnect after a network drop, and miss a call meanwhile. The page itself goes idle
      // when nothing happens (no animation or polling outside calls), so this costs next to nothing.
      backgroundThrottling: false,
      spellcheck: true,
    },
  });

  win.webContents.on('context-menu', (_event, params) => showTextMenu(params));
  // A server that doesn't open (yet) shows a page that says so and retries, not a black window (reachable.js).
  reachable.open(win, START_URL);
  win.once('ready-to-show', () => win?.show());

  // Closing the window only hides it: Gomex keeps running in the menu bar / tray so calls still come in.
  win.on('close', (event) => {
    if (quitting) return;
    event.preventDefault();
    win?.hide();
  });

}

// Electron has no context menu of its own, not even copy and paste in a text field. This is the usual text one:
// copy for a selection; cut, copy, paste, select all and spelling for a field. Pictures and files in the chat have
// their own menu in the page, which cancels the browser's contextmenu event, so this event never comes for them;
// anywhere else there's nothing to offer and no menu is shown.
function showTextMenu(params) {
  const contents = win.webContents;
  const { editFlags } = params;
  const items = [];
  if (params.isEditable && params.misspelledWord) {
    for (const word of params.dictionarySuggestions.slice(0, 5)) {
      items.push({ label: word, click: () => contents.replaceMisspelling(word) });
    }
    if (items.length === 0) items.push({ label: 'Нет вариантов', enabled: false });
    items.push(
      { label: 'Добавить в словарь', click: () => contents.session.addWordToSpellCheckerDictionary(params.misspelledWord) },
      { type: 'separator' },
    );
  }
  if (params.isEditable) {
    items.push(
      { label: 'Вырезать', role: 'cut', enabled: editFlags.canCut },
      { label: 'Копировать', role: 'copy', enabled: editFlags.canCopy },
      { label: 'Вставить', role: 'paste', enabled: editFlags.canPaste },
      { type: 'separator' },
      { label: 'Выделить всё', role: 'selectAll', enabled: editFlags.canSelectAll },
    );
  } else if (params.selectionText) {
    items.push({ label: 'Копировать', role: 'copy', enabled: editFlags.canCopy });
  }
  if (items.length > 0) Menu.buildFromTemplate(items).popup();
}

// Every window — the main one, a Gomex pop-up (e.g. a chat image) and pop-ups of pop-ups — stays on Gomex:
// other links open in the normal browser, never inside the app.
function guardNavigation(contents) {
  contents.setWindowOpenHandler(({ url }) => {
    if (fromGomex(url)) return { action: 'allow', overrideBrowserWindowOptions: { autoHideMenuBar: true, backgroundColor: '#000000' } };
    if (url.startsWith('https://') || url.startsWith('http://')) shell.openExternal(url);
    return { action: 'deny' };
  });
  contents.on('will-navigate', (event, url) => {
    if (fromGomex(url)) return;
    event.preventDefault();
    if (url.startsWith('https://') || url.startsWith('http://')) shell.openExternal(url);
  });
}
app.on('web-contents-created', (_event, contents) => guardNavigation(contents));

function setUpPermissions() {
  // Mic, camera, screen share and notifications are granted to Gomex itself, once and for good —
  // no browser prompt on every call. Every other site and every other permission is refused.
  const allowed = new Set(['media', 'display-capture', 'notifications', 'fullscreen', 'clipboard-sanitized-write']);
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback, details) => {
    callback(allowed.has(permission) && fromGomex(details.requestingUrl));
  });
  // Electron passes the origin here with a trailing slash ("https://chat.example.com/"), so compare parsed origins.
  session.defaultSession.setPermissionCheckHandler((_wc, permission, requestingOrigin) => {
    return allowed.has(permission) && fromGomex(requestingOrigin);
  });

  // Screen sharing: the system picker where the OS has one (macOS); everywhere else Gomex's own (screen-picker.js),
  // with the computer's sound as a switch on Windows. Only Gomex itself may ask. GOMEX_PICKER=1 (development)
  // turns the system picker off to try Gomex's on a Mac.
  const ownPickerForced = Boolean(devEnv('GOMEX_PICKER'));
  session.defaultSession.setDisplayMediaRequestHandler(
    (request, callback) => {
      if (!fromGomex(request.securityOrigin || request.frame?.url || '')) return callback(null);
      screenPicker
        .choose(win, { sound: process.platform === 'win32' || ownPickerForced })
        .then((choice) =>
          // Nothing chosen: the page's getDisplayMedia rejects.
          callback(choice ? { video: choice.source, audio: choice.sound && process.platform === 'win32' ? 'loopback' : undefined } : null),
        )
        .catch(() => callback(null));
    },
    { useSystemPicker: !ownPickerForced },
  );
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'assets', isMac ? 'trayTemplate.png' : 'tray.png'));
  if (isMac) icon.setTemplateImage(true);
  tray = new Tray(icon);
  tray.setToolTip('Gomex');
  updateTrayMenu();
  // Windows/Linux: a click on the tray icon opens the window (macOS shows the menu).
  tray.on('click', () => {
    if (!isMac) showWindow();
  });
}

/** The tray menu; its update line follows the updater (check / downloading / restart to install). */
function updateTrayMenu() {
  if (!tray) return;
  const update = updater.getState();
  const updateItem =
    update.status === 'ready'
      ? { label: `Перезапустить и обновить до ${update.version}`, click: () => updater.install() }
      : update.status === 'manual'
        ? { label: `Скачать Gomex ${update.version}…`, click: () => updater.install() }
        : update.status === 'checking'
          ? { label: 'Проверяем обновления…', enabled: false }
          : update.status === 'downloading'
            ? { label: `Скачиваем обновление… ${Math.round((update.progress ?? 0) * 100)}%`, enabled: false }
            : { label: 'Проверить обновления', click: () => updater.check() };
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Открыть Gomex', click: showWindow },
      { label: 'Адрес сервера…', click: () => openAddressWindow() },
      {
        label: 'Запускать при входе в систему',
        type: 'checkbox',
        checked: app.getLoginItemSettings().openAtLogin,
        click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked, openAsHidden: true }),
      },
      { type: 'separator' },
      updateItem,
      { label: `Версия ${app.getVersion()}`, enabled: false },
      { type: 'separator' },
      {
        label: 'Выйти из Gomex',
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ]),
  );
}

/** @type {BrowserWindow | null} */
let addressWindow = null;

/** firstRun: no server address yet, so this window is the whole app; closing it quits. */
function openAddressWindow({ firstRun = false } = {}) {
  if (addressWindow) return addressWindow.focus();
  addressWindow = new BrowserWindow({
    width: firstRun ? 480 : 460,
    height: firstRun ? 300 : 210,
    resizable: false,
    minimizable: false,
    maximizable: false,
    title: firstRun ? 'Gomex' : 'Адрес сервера',
    backgroundColor: '#0b0b0d',
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'address-preload.js'), contextIsolation: true, sandbox: true },
  });
  addressWindow.loadFile(path.join(__dirname, 'address.html'), {
    query: { current: APP_URL, first: firstRun ? '1' : '', placeholder: DEFAULT_URL || 'https://app.example.com' },
  });
  addressWindow.on('closed', () => {
    addressWindow = null;
  });
}

ipcMain.handle('address:save', (event, value) => {
  // Only the local address window may change where the app points.
  if (!event.senderFrame?.url.startsWith('file://')) return 'Нельзя';
  let url;
  // "chat.example.com" is what people paste most; it means https.
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`;
  try {
    url = new URL(withScheme);
  } catch {
    return 'Это не похоже на адрес. Пример: https://app.example.com';
  }
  if (url.protocol !== 'https:') return 'Адрес должен начинаться с https://';
  fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
  // A pasted invite link (…/?invite=CODE) is opened once on the next start; a bare address just opens the app.
  const rest = url.pathname + url.search;
  const config = rest === '/' ? { url: url.origin } : { url: url.origin, open: rest };
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
  quitting = true;
  app.relaunch();
  app.exit(0);
});

ipcMain.handle('address:guide', (event) => {
  if (!event.senderFrame?.url.startsWith('file://')) return;
  shell.openExternal(SERVER_GUIDE);
});

/* ---------- "Свой сервер": setting up a server from the app (onboarding.html, server-setup.js) ---------- */

/** @type {BrowserWindow | null} */
let setupWindow = null;
/** The wait for the new address to answer (watchAddress); replaced or dropped, it stops. */
let addressWatch = null;

function openSetupWindow() {
  if (setupWindow) return setupWindow.focus();
  setupWindow = new BrowserWindow({
    width: 1040,
    height: 680,
    minWidth: 420,
    minHeight: 600,
    title: 'Свой сервер',
    backgroundColor: '#0c0c0e',
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'onboarding-preload.js'), contextIsolation: true, sandbox: true },
  });
  setupWindow.loadFile(path.join(__dirname, 'onboarding.html'));
  setupWindow.on('closed', () => {
    setupWindow = null;
    addressWatch = null;
    serverSetup.cancelMail();
    serverSetup.close();
  });
}

// "Свой сервер" on the first start: the setup window takes the place of the small one.
ipcMain.handle('address:setup', (event) => {
  if (!event.senderFrame?.url.startsWith('file://')) return;
  openSetupWindow();
  addressWindow?.close();
});

// What the app keeps for each server it set up: its SSH key (so it can update the server later) and the deSEC
// account behind a free name. Encrypted with the system's keychain where there is one.
const SERVERS_FILE = path.join(app.getPath('userData'), 'servers.json');
const seal = (text) =>
  safeStorage.isEncryptionAvailable() ? { sealed: safeStorage.encryptString(text).toString('base64') } : { plain: text };
function remember(domain, fields) {
  let all = {};
  try {
    all = JSON.parse(fs.readFileSync(SERVERS_FILE, 'utf8'));
  } catch {
    // First server.
  }
  all[domain] = { ...all[domain], ...fields, at: new Date().toISOString() };
  fs.mkdirSync(path.dirname(SERVERS_FILE), { recursive: true });
  fs.writeFileSync(SERVERS_FILE, JSON.stringify(all, null, 2), { mode: 0o600 });
}

/** The setup window's calls; nothing else may make them. */
const fromSetup = (event) => setupWindow && event.sender === setupWindow.webContents;
const setupCall = (name, fn) =>
  ipcMain.handle(`setup:${name}`, (event, ...args) => (fromSetup(event) ? fn(...args) : { error: 'Нельзя' }));

let freeAccount = null;
setupCall('open-external', (url) => {
  if (/^https:\/\/[^/]+/.test(url)) shell.openExternal(url);
});
setupCall('connect', (login) => serverSetup.connect(login));
setupCall('register', (form) => serverSetup.register(form));
setupCall('wait-mail', async (where) => {
  const answer = await serverSetup.waitMail(where);
  if (answer.ok) {
    freeAccount = { domain: answer.domain, account: answer.account };
    callBack('Почта подтверждена', 'Адрес готов, можно продолжать');
  }
  return answer.ok ? { ok: true } : answer;
});

/** The person is off in the browser (deSEC's page): bring the setup window back in front, and say why. */
function callBack(title, body) {
  if (!setupWindow) return;
  if (setupWindow.isMinimized()) setupWindow.restore();
  setupWindow.show();
  if (isMac) {
    app.focus({ steal: true });
    app.dock?.bounce('informational');
  } else {
    setupWindow.flashFrame(true);
    setupWindow.once('focus', () => setupWindow?.flashFrame(false));
  }
  setupWindow.focus();
  if (Notification.isSupported()) {
    const note = new Notification({ title, body, silent: true });
    note.on('click', () => setupWindow?.focus());
    note.show();
  }
}
setupCall('cancel-mail', () => serverSetup.cancelMail());
setupCall('check-domain', (domain) => serverSetup.checkDomain(domain));
setupCall('connect-drive', () => ({ error: 'Google Диск появится в следующей версии, пока можно без бэкапов' }));

/**
 * After the install: tells the setup window when the new address answers from this computer. A name made minutes ago
 * may not have reached the provider's DNS yet, and opening it too early left the main window black.
 */
async function watchAddress(url) {
  const me = (addressWatch = {});
  while (addressWatch === me && setupWindow) {
    if (await reachable.answers(url)) {
      if (addressWatch !== me || !setupWindow) return;
      setupWindow.webContents.send('setup:event', { state: 'open' });
      // The install takes minutes and the window may be away: it comes back when there's something to press.
      callBack('Сервер готов', 'Gomex установлен');
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
}

setupCall('install', ({ domain, turn }) =>
  serverSetup.install(
    { domain, turn, installer: devEnv('GOMEX_INSTALLER') },
    (data) => {
      setupWindow?.webContents.send('setup:event', data);
      if (data.state === 'ready') watchAddress(data.url);
      if (data.state === 'fail' && !data.step) callBack('Установка остановилась', data.why ?? '');
    },
    ({ privateKey, ...server }) => {
      const account = freeAccount?.domain === server.domain ? seal(JSON.stringify(freeAccount.account)) : undefined;
      remember(server.domain, { ...server, key: seal(privateKey), ...(account ? { desec: account } : {}) });
    },
  ),
);
// The new server becomes the app's server: its first-run wizard opens in the main window.
setupCall('open-server', (value) => {
  let url;
  try {
    url = new URL(value);
  } catch {
    return { error: 'Нет адреса' };
  }
  if (url.protocol !== 'https:') return { error: 'Нет адреса' };
  const rest = url.pathname + url.search;
  fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(rest === '/' ? { url: url.origin } : { url: url.origin, open: rest }, null, 2));
  quitting = true;
  app.relaunch();
  app.exit(0);
});

/** IPC from the page; only the Gomex page itself may send these. */
function listenToPage() {
  const trusted = (event) => fromGomex(event.senderFrame?.url ?? '');

  ipcMain.on('call:incoming', (event, { title, body }) => {
    if (!trusted(event)) return;
    showWindow();
    if (isMac) app.dock?.bounce('critical');
    else win?.flashFrame(true);
    if (Notification.isSupported()) {
      callNotification?.close();
      // Silent: the page already plays the ringtone.
      callNotification = new Notification({ title: title.slice(0, 120), body: body.slice(0, 200), silent: true });
      callNotification.on('click', showWindow);
      callNotification.show();
    }
  });

  ipcMain.on('call:handled', (event) => {
    if (!trusted(event)) return;
    callNotification?.close();
    callNotification = null;
    win?.flashFrame(false);
  });

  ipcMain.on('badge', (event, count) => {
    if (!trusted(event)) return;
    app.setBadgeCount(Math.max(0, Math.min(Number(count) || 0, 9999)));
  });

  // The app's own updates (updater.js); the page shows them and offers the restart.
  ipcMain.handle('update:get', (event) => (trusted(event) ? updater.getState() : null));
  ipcMain.handle('update:check', (event) => (trusted(event) ? updater.check() : null));
  ipcMain.handle('update:install', (event) => {
    if (trusted(event)) updater.install();
  });

  // Push-to-talk outside the window (ptt.js). Only the key the page asks for is watched, and the page may
  // switch to a new key at most once a second — a hijacked page can't sweep the keyboard to log typing.
  // Stopping (null) is never held back.
  let pttChangedAt = 0;
  let pttPending = null;
  ipcMain.on('ptt:watch', (event, code) => {
    if (!trusted(event)) return;
    const key = typeof code === 'string' && code && code.length <= 32 ? code : null;
    clearTimeout(pttPending);
    pttPending = null;
    if (!key) return ptt.watch(null);
    // Too soon after the last key: the newest request waits out the second rather than being lost (leaving
    // and rejoining a call quickly must still end up watching the key).
    const apply = () => {
      pttPending = null;
      pttChangedAt = Date.now();
      ptt.watch(key);
    };
    const wait = pttChangedAt + 1000 - Date.now();
    if (wait <= 0) apply();
    else pttPending = setTimeout(apply, wait);
  });
  ptt.onChange((down) => win?.webContents.send('ptt:state', down));

  ipcMain.on('notify', (event, { title, body, conversationId }) => {
    if (!trusted(event) || !Notification.isSupported()) return;
    const note = new Notification({ title: title.slice(0, 120), body: body.slice(0, 200) });
    note.on('click', () => {
      showWindow();
      win?.webContents.send('open-conversation', conversationId);
    });
    note.show();
  });
}

app.on('second-instance', () => (win ? showWindow() : (setupWindow ?? addressWindow)?.focus()));
app.on('before-quit', () => {
  quitting = true;
  ptt.stop();
  // A downloaded update installs as the app quits (on its own, without reopening).
  updater.installOnQuit();
});
// macOS: clicking the Dock icon brings the hidden window back.
app.on('activate', showWindow);

app.whenReady().then(async () => {
  app.setAppUserModelId('io.github.gomex-inc.gomex'); // Windows notifications need it
  setUpPermissions();
  listenToPage();
  if (!APP_URL) {
    openAddressWindow({ firstRun: true });
    return;
  }
  createWindow();
  updater.init({
    manifestUrl: devEnv('GOMEX_UPDATE_URL') || UPDATE_MANIFEST,
    onChange: (state) => {
      updateTrayMenu();
      win?.webContents.send('update:state', state);
    },
  });
  createTray();
  // After sleep, look for an update instead of waiting out the timer.
  powerMonitor.on('resume', () => updater.check());
  // macOS asks for the microphone once, for the app — not per call. Camera is asked on first use.
  if (isMac && app.isPackaged && systemPreferences.getMediaAccessStatus('microphone') === 'not-determined') {
    await systemPreferences.askForMediaAccess('microphone');
  }
});
