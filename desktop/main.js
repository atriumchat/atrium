// Gomex desktop: the web app of a Gomex server in its own window, plus what a browser tab can't do —
// stay alive in the menu bar / tray so calls always ring, bring itself up on a call, keep mic and
// camera permission, badge the icon and show system notifications.
const {
  app,
  BrowserWindow,
  Menu,
  Notification,
  Tray,
  desktopCapturer,
  ipcMain,
  nativeImage,
  powerMonitor,
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

  win.loadURL(START_URL);
  win.once('ready-to-show', () => win?.show());

  // Closing the window only hides it: Gomex keeps running in the menu bar / tray so calls still come in.
  win.on('close', (event) => {
    if (quitting) return;
    event.preventDefault();
    win?.hide();
  });

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

  // Screen sharing: the system picker where the OS has one (macOS); otherwise the whole main screen,
  // with the computer's sound on Windows. Only Gomex itself may ask. (With the macOS system picker the person
  // picks what to share in the OS's own window. Windows has no picker yet: it always shares the main screen.)
  session.defaultSession.setDisplayMediaRequestHandler(
    (request, callback) => {
      if (!fromGomex(request.securityOrigin || request.frame?.url || '')) return callback({});
      desktopCapturer
        .getSources({ types: ['screen'] })
        .then((sources) => callback({ video: sources[0], audio: process.platform === 'win32' ? 'loopback' : undefined }))
        .catch(() => callback({}));
    },
    { useSystemPicker: true },
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

app.on('second-instance', () => (win ? showWindow() : addressWindow?.focus()));
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
