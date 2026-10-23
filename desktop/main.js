// Atrium desktop: the web app of an Atrium server in its own window, plus what a browser tab can't do —
// stay alive in the menu bar / tray so calls always ring, bring itself up on a call, keep mic and
// camera permission, badge the icon and show system notifications.
const {
  app,
  BrowserWindow,
  Menu,
  clipboard,
  Notification,
  Tray,
  ipcMain,
  nativeImage,
  net,
  powerMonitor,
  safeStorage,
  screen,
  session,
  shell,
  systemPreferences,
} = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

// Developer overrides, for `npm start` only: an installed app ignores them, so nothing in the environment can
// point it at another server, another update feed or another settings folder.
const devEnv = (name) => (app.isPackaged ? undefined : process.env[name]);

// A separate settings folder, to run a second copy next to the installed one.
if (devEnv('ATRIUM_USER_DATA')) app.setPath('userData', devEnv('ATRIUM_USER_DATA'));
const updater = require('./updater');
const ptt = require('./ptt');
const serverSetup = require('./server-setup');
const screenPicker = require('./screen-picker');
const reachable = require('./reachable');
const i18n = require('./i18n');
const { t } = i18n;

// The server address can be changed from the tray ("Server address…") if Atrium ever has to move to a
// new domain — no reinstall. Stored in the app's settings folder.
const CONFIG_FILE = path.join(app.getPath('userData'), 'config.json');
function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch {
    return {};
  }
}

/** Writes the config, keeping the language choice, which isn't part of where the app points. */
function writeConfig(next) {
  const { language } = readConfig();
  fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(language ? { ...next, language } : next, null, 2));
}

// A server is the default only in builds made for one: ATRIUM_DEFAULT_URL in release-desktop.sh puts the address into
// package.json (electron-builder's extraMetadata). Any other build first asks where its server is.
const DEFAULT_URL = require('./package.json').atriumDefaultUrl || '';
// The server the app opens. Set once at start, or by the first window / "Your own server" when they're done (useServer):
// the main window then opens in their place, no restart.
let APP_URL = devEnv('ATRIUM_URL') || readConfig().url || DEFAULT_URL;
let ORIGIN = '';
try {
  ORIGIN = APP_URL ? new URL(APP_URL).origin : '';
} catch {
  // A config.json that isn't an address any more: as if there were no server yet, so the first window asks again.
  APP_URL = '';
}
let START_URL = APP_URL;
// Where "Your own server" on the first start leads.
const SERVER_GUIDE = { ru: 'https://www.atriumcalls.app/server-install', en: 'https://www.atriumcalls.app/en/server-install' };
// The app's own updates come from the project's GitHub Releases whatever server it talks to, and only signed ones
// install (updater.js). release-desktop.sh puts the manifest's address into package.json, like the server's; a build
// without it never updates.
const UPDATE_MANIFEST = require('./package.json').atriumUpdateUrl || '';
const isMac = process.platform === 'darwin';

/**
 * No system title bar: every window's content runs to its top edge. On a Mac the traffic lights sit over it, on
 * Windows and Linux the window's buttons are drawn over it in its own colours; the pages leave that strip empty and
 * drag the window by it (TOP_STRIP: the web app's App.tsx and desktop/ui's pages keep the same heights).
 */
function frameless(background) {
  return isMac
    ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 16, y: 16 } }
    : { titleBarStyle: 'hidden', titleBarOverlay: { color: background, symbolColor: '#ededef', height: 36 } };
}
/** The first window and "Your own server" are one size, so going from one to the other doesn't jump. */
const FLOW_WINDOW = { width: 1040, height: 720, minWidth: 420, minHeight: 600 };
/**
 * Where a new window of this size stands dead in the middle of the screen the pointer is on. Left to itself macOS puts
 * a new window a little above the middle.
 */
function centred(width, height) {
  const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  return {
    x: Math.round(area.x + (area.width - Math.min(width, area.width)) / 2),
    y: Math.round(area.y + (area.height - Math.min(height, area.height)) / 2),
  };
}

// The ringtone must play the moment a call comes in, without the user having clicked the page first.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

if (!app.requestSingleInstanceLock()) {
  app.exit(0);
}

/** @type {BrowserWindow | null} */
let win = null;
/** @type {Tray | null} */
let tray = null;
/** @type {Notification | null} */
let callNotification = null;
let quitting = false;

const fromAtrium = (url) => {
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

/** The main window; `bounds` puts it where the window it takes over from stood (useServer), else in the middle. */
function createWindow(bounds = null) {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    ...centred(1280, 820),
    ...(bounds ?? {}),
    minWidth: 380,
    minHeight: 560,
    title: 'Atrium',
    backgroundColor: '#0b0b0d',
    ...frameless('#000000'),
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
  setupLinkStart(win);
  win.once('ready-to-show', () => win?.show());

  // Closing the window only hides it: Atrium keeps running in the menu bar / tray so calls still come in.
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
    if (items.length === 0) items.push({ label: t('menu.noSuggestions'), enabled: false });
    items.push(
      { label: t('menu.addWord'), click: () => contents.session.addWordToSpellCheckerDictionary(params.misspelledWord) },
      { type: 'separator' },
    );
  }
  if (params.isEditable) {
    items.push(
      { label: t('menu.cut'), role: 'cut', enabled: editFlags.canCut },
      { label: t('menu.copy'), role: 'copy', enabled: editFlags.canCopy },
      { label: t('menu.paste'), role: 'paste', enabled: editFlags.canPaste },
      { type: 'separator' },
      { label: t('menu.selectAll'), role: 'selectAll', enabled: editFlags.canSelectAll },
    );
  } else if (params.selectionText) {
    items.push({ label: t('menu.copy'), role: 'copy', enabled: editFlags.canCopy });
  }
  if (items.length > 0) Menu.buildFromTemplate(items).popup();
}

// Every window — the main one, an Atrium pop-up (e.g. a chat image) and pop-ups of pop-ups — stays on Atrium:
// other links open in the normal browser, never inside the app.
function guardNavigation(contents) {
  contents.setWindowOpenHandler(({ url }) => {
    if (fromAtrium(url)) return { action: 'allow', overrideBrowserWindowOptions: { autoHideMenuBar: true, backgroundColor: '#000000' } };
    if (url.startsWith('https://') || url.startsWith('http://')) shell.openExternal(url);
    return { action: 'deny' };
  });
  contents.on('will-navigate', (event, url) => {
    if (fromAtrium(url)) return;
    event.preventDefault();
    if (url.startsWith('https://') || url.startsWith('http://')) shell.openExternal(url);
  });
}
app.on('web-contents-created', (_event, contents) => guardNavigation(contents));

function setUpPermissions() {
  // Mic, camera, screen share and notifications are granted to Atrium itself, once and for good —
  // no browser prompt on every call. Every other site and every other permission is refused.
  const allowed = new Set(['media', 'display-capture', 'notifications', 'fullscreen', 'clipboard-sanitized-write']);
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback, details) => {
    callback(allowed.has(permission) && fromAtrium(details.requestingUrl));
  });
  // Electron passes the origin here with a trailing slash ("https://chat.example.com/"), so compare parsed origins.
  session.defaultSession.setPermissionCheckHandler((_wc, permission, requestingOrigin) => {
    return allowed.has(permission) && fromAtrium(requestingOrigin);
  });

  // Screen sharing: the system picker where the OS has one (macOS); everywhere else Atrium's own (screen-picker.js),
  // with the computer's sound as a switch on Windows. Only Atrium itself may ask. ATRIUM_PICKER=1 (development)
  // turns the system picker off to try Atrium's on a Mac.
  const ownPickerForced = Boolean(devEnv('ATRIUM_PICKER'));
  session.defaultSession.setDisplayMediaRequestHandler(
    (request, callback) => {
      if (!fromAtrium(request.securityOrigin || request.frame?.url || '')) return callback(null);
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
  tray.setToolTip('Atrium');
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
      ? { label: t('tray.updateReady', { version: update.version }), click: () => updater.install() }
      : update.status === 'manual'
        ? { label: t('tray.updateManual', { version: update.version }), click: () => updater.install() }
        : update.status === 'checking'
          ? { label: t('tray.updateChecking'), enabled: false }
          : update.status === 'downloading'
            ? { label: t('tray.updateDownloading', { percent: Math.round((update.progress ?? 0) * 100) }), enabled: false }
            : { label: t('tray.updateCheck'), click: () => updater.check() };
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: t('tray.open'), click: showWindow },
      { label: t('tray.address'), click: () => openAddressWindow() },
      {
        label: t('tray.login'),
        type: 'checkbox',
        checked: app.getLoginItemSettings().openAtLogin,
        click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked, openAsHidden: true }),
      },
      {
        label: t('tray.language'),
        submenu: [
          { label: t('tray.langSystem'), value: null },
          { label: 'Русский', value: 'ru' },
          { label: 'English', value: 'en' },
        ].map(({ label, value }) => ({
          label,
          type: 'radio',
          checked: (readConfig().language ?? null) === value,
          click: () => setLanguage(value, { fromPage: false }),
        })),
      },
      { type: 'separator' },
      updateItem,
      { label: t('tray.version', { version: app.getVersion() }), enabled: false },
      { type: 'separator' },
      {
        label: t('tray.quit'),
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ]),
  );
}

/**
 * The language choice: 'ru', 'en' or null (follow the system). Kept in the config, applied at once to the tray, the
 * open windows and, from the tray, the Atrium page (which tells its own language setting through the bridge).
 */
function setLanguage(choice, { fromPage }) {
  const config = readConfig();
  if (choice) config.language = choice;
  else delete config.language;
  fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
  i18n.setLang(choice ?? i18n.pick(app.getLocale()));
  updateTrayMenu();
  addressWindow?.setTitle(firstRunAddress ? 'Atrium' : t('address.windowTitle'));
  setupWindow?.setTitle(t('setup.title'));
  relocalize(addressWindow?.webContents);
  // The setup window holds a half-made server's answers: it switches its words in place instead of reloading.
  setupWindow?.webContents.send('setup:language', i18n.getLang());
  screenPicker.relocalize();
  reachable.relocalize();
  // The page learns of a change made here; one it made itself needs no echo.
  if (!fromPage && win && !win.isDestroyed() && fromAtrium(win.webContents.getURL())) {
    win.webContents.executeJavaScript(
      `window.dispatchEvent(new CustomEvent('atrium-language', { detail: ${JSON.stringify(choice)} }))`,
    ).catch(() => undefined);
  }
}

/** Reloads one of the app's own pages in the current language. */
function relocalize(contents) {
  if (!contents || contents.isDestroyed()) return;
  const url = new URL(contents.getURL());
  url.searchParams.set('lang', i18n.getLang());
  contents.loadURL(url.href);
}

/** @type {BrowserWindow | null} */
let addressWindow = null;
let firstRunAddress = false;

/**
 * The first start's splash: only the app's icon, in a small transparent window with no frame, its ticks lighting up
 * over a swelling chord (desktop/ui's splash page). It stands exactly where the welcome window (`under`, made hidden)
 * has its icon; when it's done the window fades in around it while the splash fades out, so the icon stays put and
 * the window grows round it. It can't be clicked and goes by itself.
 */
function showSplash(under) {
  const SIZE = 320;
  const splash = new BrowserWindow({
    width: SIZE,
    height: SIZE,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    hasShadow: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: false,
    show: false,
    webPreferences: { preload: path.join(__dirname, 'splash-preload.js'), contextIsolation: true, sandbox: true },
  });
  let finished = false;
  const finish = (handOver) => {
    if (finished) return;
    finished = true;
    ipcMain.removeListener('splash:done', onDone);
    // The splash fades by itself (its page) and closes a little later: the sound's tail plays out after the icon.
    setTimeout(() => !splash.isDestroyed() && splash.destroy(), 5000);
    if (!under || under.isDestroyed()) return;
    if (handOver) {
      // The welcome starts with its ring already lit (it's the same icon) and only its words rising.
      under.webContents.executeJavaScript(`document.body.classList.add('from-splash')`).catch(() => undefined);
      fadeIn(under, 500);
    } else {
      under.show();
    }
  };
  const onDone = (event) => event.sender === splash.webContents && finish(true);
  ipcMain.on('splash:done', onDone);

  // Over the welcome's icon: where it is in its page, once the page is there; the screen's middle until then.
  const place = async () => {
    try {
      const at = await under.webContents.executeJavaScript(
        `(() => { const r = document.querySelector('.welcome-icon')?.getBoundingClientRect(); return r && { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`,
      );
      if (at) {
        const b = under.getContentBounds();
        splash.setPosition(Math.round(b.x + at.x - SIZE / 2), Math.round(b.y + at.y - SIZE / 2));
      }
    } catch {
      // Left in the middle of the screen.
    }
  };
  const ready = Promise.all([
    new Promise((resolve) => splash.once('ready-to-show', resolve)),
    under.webContents.isLoading() ? new Promise((resolve) => under.webContents.once('did-finish-load', resolve)) : Promise.resolve(),
  ]);
  ready.then(place).then(() => !splash.isDestroyed() && splash.showInactive());
  // A page that never answers (it failed to load) doesn't hold the app up.
  setTimeout(() => finish(false), 8000);
  splash.loadFile(path.join(__dirname, 'ui-dist', 'splash.html'));
}

/** Shows a hidden window by fading it in over `ms`. */
function fadeIn(win, ms) {
  win.setOpacity(0);
  win.show();
  const start = Date.now();
  const tick = setInterval(() => {
    if (win.isDestroyed()) return clearInterval(tick);
    const k = Math.min(1, (Date.now() - start) / ms);
    win.setOpacity(1 - Math.pow(1 - k, 3));
    if (k === 1) clearInterval(tick);
  }, 16);
}

/** firstRun: no server address yet, so this window is the whole app; closing it quits. `show: false`: made hidden. */
/** The first window; `bounds` opens it where another stood, `step` on one of its steps (back from "Your own server"). */
function openAddressWindow({ firstRun = false, show = true, bounds = null, step = '' } = {}) {
  if (addressWindow) return addressWindow.focus();
  firstRunAddress = firstRun;
  addressWindow = new BrowserWindow({
    ...FLOW_WINDOW,
    ...centred(FLOW_WINDOW.width, FLOW_WINDOW.height),
    ...(bounds ?? {}),
    title: firstRun ? 'Atrium' : t('address.windowTitle'),
    backgroundColor: '#0c0c0e',
    ...frameless('#0c0c0e'),
    show,
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'address-preload.js'), contextIsolation: true, sandbox: true },
  });
  addressWindow.loadFile(path.join(__dirname, 'ui-dist', 'start.html'), {
    query: { lang: i18n.getLang(), current: APP_URL, first: firstRun ? '1' : '', step, placeholder: DEFAULT_URL || 'https://app.example.com' },
  });
  addressWindow.on('closed', () => {
    addressWindow = null;
  });
}

/**
 * An Atrium server's root domain is only its cover page; the app is on app.DOMAIN. An address typed as the root (what
 * people mostly know) becomes the app's own, when app.DOMAIN answers as an Atrium server; anything else stays.
 */
async function appOrigin(origin) {
  const { protocol, host } = new URL(origin);
  if (host.startsWith('app.') || protocol !== 'https:') return origin;
  try {
    const res = await net.fetch(`https://app.${host}/api/setup`, { cache: 'no-store', signal: AbortSignal.timeout(6000) });
    if (res.ok && 'needed' in (await res.json())) return `https://app.${host}`;
  } catch {
    // No such app next to it: the address is used as typed.
  }
  return origin;
}

/** From the app's own page `page` (in ui-dist), its top frame: the first window's calls are made only from there. */
function fromPage(event, page) {
  const frame = event.senderFrame;
  if (!frame || frame !== event.sender.mainFrame) return false;
  const own = pathToFileURL(path.join(__dirname, 'ui-dist', page)).href;
  return frame.url === own || frame.url.startsWith(`${own}?`) || frame.url.startsWith(`${own}#`);
}

ipcMain.handle('address:save', async (event, value, opts) => {
  // Only the local address window may change where the app points.
  if (!fromPage(event, 'start.html')) return t('address.denied');
  let url;
  // "chat.example.com" is what people paste most; it means https.
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`;
  try {
    url = new URL(withScheme);
  } catch {
    return t('address.notAddress');
  }
  // Run from source, a server on this computer (http://localhost:…) is fine too, for trying the app against a local one.
  const local = !app.isPackaged && url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !local) return t('address.needHttps');
  // A pasted invite link (…/?invite=CODE) is opened once on the next start; a bare address just opens the app.
  // "I have an account" opens on sign-in (the web's ?signin), not on the question it was just asked.
  const rest = url.pathname + url.search;
  const open = rest === '/' ? (opts?.signIn ? '/?signin' : null) : rest;
  useServer(await appOrigin(url.origin), open, addressWindow);
});

// The first window's globe: the same choice as the tray's Language menu; the window reloads in it.
ipcMain.handle('address:language', (event, choice) => {
  if (!fromPage(event, 'start.html')) return;
  if (choice === 'ru' || choice === 'en') setLanguage(choice, { fromPage: false });
});

ipcMain.handle('address:guide', (event) => {
  if (!fromPage(event, 'start.html')) return;
  shell.openExternal(SERVER_GUIDE[i18n.getLang()] ?? SERVER_GUIDE.ru);
});

/* ---------- "Your own server": setting up a server from the app (desktop/ui's onboarding page, built into ui-dist; server-setup.js) ---------- */

/** @type {BrowserWindow | null} */
let setupWindow = null;
/** The wait for the new address to answer (watchAddress); replaced or dropped, it stops. */
let addressWatch = null;

/** `bounds`: where the first window was, so this one takes its place. */
function openSetupWindow(bounds) {
  if (setupWindow) return setupWindow.focus();
  setupWindow = new BrowserWindow({
    ...FLOW_WINDOW,
    ...bounds,
    title: t('setup.title'),
    backgroundColor: '#0c0c0e',
    ...frameless('#0c0c0e'),
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'onboarding-preload.js'), contextIsolation: true, sandbox: true },
  });
  setupWindow.loadFile(path.join(__dirname, 'ui-dist', 'onboarding.html'), { query: { lang: i18n.getLang() } });
  setupWindow.on('closed', () => {
    setupWindow = null;
    addressWatch = null;
    serverSetup.cancelMail();
    serverSetup.close();
  });
}

// "Your own server" on the first start: the setup window takes the place of the small one.
ipcMain.handle('address:setup', (event) => {
  if (!fromPage(event, 'start.html')) return;
  openSetupWindow(addressWindow?.getBounds());
  addressWindow?.close();
});

// What the app keeps for each server it set up: its SSH key (so it can update the server later) and the deSEC
// account behind a free name. Encrypted with the system's keychain; where it can't be (no keychain, or access to it
// refused), a secret isn't kept at all rather than kept readable: undefined, which JSON leaves out. Files from before
// may still hold `plain` ones, which are read.
const SERVERS_FILE = path.join(app.getPath('userData'), 'servers.json');
const seal = (text) => (safeStorage.isEncryptionAvailable() ? { sealed: safeStorage.encryptString(text).toString('base64') } : undefined);
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

/** The setup window's calls; nothing else may make them, not even a frame inside that window. */
const fromSetup = (event) =>
  setupWindow && event.sender === setupWindow.webContents && event.senderFrame === setupWindow.webContents.mainFrame && fromPage(event, 'onboarding.html');
const setupCall = (name, fn) =>
  ipcMain.handle(`setup:${name}`, (event, ...args) => (fromSetup(event) ? fn(...args) : { error: t('setup.denied') }));

let freeAccount = null;
setupCall('open-external', (url) => {
  if (/^https:\/\/[^/]+/.test(url)) shell.openExternal(url);
});
setupCall('connect', (login) => serverSetup.connect(login));
setupCall('app-key', () => serverSetup.newAppKey());
// Back from "Your own server"'s first step: on the first start, to the first window's choice, in its place; opened from
// the tray, the setup just closes.
setupCall('leave', () => {
  if (!setupWindow) return;
  if (win && !win.isDestroyed()) {
    setupWindow.close();
    showWindow();
    return;
  }
  openAddressWindow({ firstRun: !APP_URL, bounds: setupWindow.getBounds(), step: 'choose' });
  setupWindow.destroy();
});
setupCall('language', (choice) => {
  if (choice === 'ru' || choice === 'en') setLanguage(choice, { fromPage: false });
});
setupCall('connect-key', (host, expect) => serverSetup.connectByKey(String(host), Array.isArray(expect) ? expect.map(String).slice(0, 8) : []));
setupCall('forget-host', (host) => serverSetup.forgetHost(String(host)));
// A local page may not write the clipboard itself (only the server's origin is granted it): the main process does.
setupCall('copy', (text) => {
  clipboard.writeText(String(text).slice(0, 2000));
  return true;
});
// "No server?": the setup page drives HostVDS's API (@atrium/setup, rentServer) through here, since a page can't
// reach it (CORS). Only that API, only these methods; the answer goes back as { status, token, json }.
setupCall('hostvds', async ({ method, url, body, token }) => {
  if (!['GET', 'POST', 'DELETE'].includes(method) || !String(url).startsWith('https://os-api.hostvds.com/')) return { status: 400, json: null };
  try {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { 'X-Auth-Token': String(token) } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(60000),
    });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = text;
    }
    return { status: res.status, token: res.headers.get('X-Subject-Token') ?? undefined, json };
  } catch (error) {
    return { status: 599, json: { error: { message: String(error?.message ?? error) } } };
  }
});
setupCall('register', (form) => serverSetup.register(form));
setupCall('wait-mail', async (where) => {
  const answer = await serverSetup.waitMail(where);
  if (answer.ok) {
    freeAccount = { domain: answer.domain, account: answer.account };
    callBack(t('note.mailTitle'), t('note.mailBody'));
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

/** The deSEC account an earlier server of this computer left, unsealed; the newest one, or null. */
function savedDesec() {
  let all;
  try {
    all = JSON.parse(fs.readFileSync(SERVERS_FILE, 'utf8'));
  } catch {
    return null;
  }
  const newest = Object.entries(all)
    .filter(([domain, server]) => server.desec && domain.endsWith('.dedyn.io'))
    .sort((a, b) => String(b[1].at).localeCompare(String(a[1].at)))[0];
  if (!newest) return null;
  try {
    const { sealed, plain } = newest[1].desec;
    const account = JSON.parse(sealed ? safeStorage.decryptString(Buffer.from(sealed, 'base64')) : plain);
    return { domain: newest[0], account };
  } catch {
    return null;
  }
}
// Only the name goes to the window; the password stays here.
setupCall('saved-address', () => ({ domain: savedDesec()?.domain ?? null }));
setupCall('use-saved', async ({ ip }) => {
  const saved = savedDesec();
  if (!saved) return { error: t('setup.noSaved') };
  const answer = await serverSetup.reuse({ ...saved.account, name: saved.domain.replace(/\.dedyn\.io$/, ''), ip });
  if (answer.ok) freeAccount = { domain: answer.domain, account: answer.account };
  return answer.ok ? { ok: true, domain: answer.domain } : answer;
});
setupCall('check-domain', (domain) => serverSetup.checkDomain(domain));

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
      callBack(t('note.readyTitle'), t('note.readyBody'));
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
}

setupCall('install', ({ domain, turn }) =>
  serverSetup.install(
    { domain, turn, installer: devEnv('ATRIUM_INSTALLER') },
    (data) => {
      setupWindow?.webContents.send('setup:event', data);
      if (data.state === 'ready') watchAddress(data.url);
      if (data.state === 'fail' && !data.step) callBack(t('note.stoppedTitle'), data.why ?? '');
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
    return { error: t('setup.noAddress') };
  }
  if (url.protocol !== 'https:') return { error: t('setup.noAddress') };
  const rest = url.pathname + url.search;
  keepSetupLink(url);
  useServer(url.origin, rest === '/' ? null : rest, setupWindow);
});

/**
 * The app's server from now on: remembered, and opened in the main window right where `from` (the first window or
 * "Your own server") stands, which goes once the main window shows. `open` (a path with its query) is where it opens
 * this time: an invite, sign-in, the server's first-run wizard.
 */
function useServer(origin, open, from) {
  writeConfig({ url: origin });
  APP_URL = origin;
  ORIGIN = origin;
  START_URL = open ? origin + open : origin;
  // Set up again from the tray while the main window is there: it just goes to the new server.
  if (win && !win.isDestroyed()) {
    reachable.open(win, START_URL);
    showWindow();
    if (from && !from.isDestroyed()) from.destroy();
    return;
  }
  const bounds = from && !from.isDestroyed() ? from.getBounds() : null;
  startMain(bounds);
  win.once('ready-to-show', () => {
    if (from && !from.isDestroyed()) from.destroy();
  });
}

// The link with the setup code (https://app.DOMAIN/?setup=CODE) is kept with the server's other secrets until the
// server's first-run wizard is done: the address opened without it (or the wizard left half-way) would ask for a code.
function keepSetupLink(url) {
  if (!url.searchParams.has('setup')) return;
  remember(url.hostname.replace(/^app\./, ''), { setup: seal(url.href) });
}

/** Sealed servers.json entries that hold a setup link: [[domain, link]]. */
function setupLinks() {
  try {
    const all = JSON.parse(fs.readFileSync(SERVERS_FILE, 'utf8'));
    return Object.entries(all).flatMap(([domain, one]) => {
      if (!one.setup) return [];
      const link = one.setup.sealed ? safeStorage.decryptString(Buffer.from(one.setup.sealed, 'base64')) : one.setup.plain;
      return [[domain, link]];
    });
  } catch {
    return [];
  }
}

/**
 * On start: while the server still needs its setup, the main window opens on the setup link instead of the bare
 * address; once it doesn't, the stored link goes. Asked with the network stack the window loads with (net.fetch).
 */
async function setupLinkStart(window) {
  const found = setupLinks().find(([, link]) => ORIGIN && new URL(link).origin === ORIGIN);
  if (!found) return;
  const [domain, link] = found;
  try {
    const response = await net.fetch(`${ORIGIN}/api/setup`, { cache: 'no-store', signal: AbortSignal.timeout(8000) });
    const { needed } = await response.json();
    if (needed === false) return remember(domain, { setup: undefined });
    if (needed !== true) return;
  } catch {
    return; // Not reachable now: the bare address is what reachable.js is already retrying.
  }
  if (!window.isDestroyed() && !window.webContents.getURL().includes('setup=')) window.loadURL(link);
}

/** IPC from the page; only the Atrium page itself may send these. */
function listenToPage() {
  const trusted = (event) => fromAtrium(event.senderFrame?.url ?? '');

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

  // The language choice, shared with the web app's own setting: 'ru', 'en' or null (follow the system).
  ipcMain.handle('language:get', (event) => (trusted(event) ? (readConfig().language ?? null) : null));
  ipcMain.handle('language:set', (event, choice) => {
    if (trusted(event) && (choice === 'ru' || choice === 'en' || choice === null)) setLanguage(choice, { fromPage: true });
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

/** The installed app's menu: on a Mac the app, Edit (copy and paste) and Window menus; elsewhere none at all. */
function setMenu() {
  if (!app.isPackaged) return;
  Menu.setApplicationMenu(isMac ? Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }]) : null);
}

app.whenReady().then(async () => {
  // The system's language (a developer can force one with ATRIUM_LANG=ru|en); the windows below open in it.
  i18n.setLang(devEnv('ATRIUM_LANG') ?? readConfig().language ?? i18n.pick(app.getLocale()));
  app.setAppUserModelId('club.atriumchat.desktop'); // Windows notifications need it
  // Names are asked over HTTPS from Cloudflare or Google first, the system's DNS only when they can't be reached. A
  // router or provider that asked for a new server's name before it existed keeps "no such name" for up to an hour
  // (dedyn.io's negative TTL); asked directly, the name answers the moment it's there.
  app.configureHostResolver({
    secureDnsMode: 'automatic',
    secureDnsServers: ['https://cloudflare-dns.com/dns-query', 'https://dns.google/dns-query'],
  });
  setUpPermissions();
  setMenu();
  serverSetup.init({ dataDir: app.getPath('userData') });
  listenToPage();
  if (!APP_URL) {
    // The very first start: the splash, then the welcome window, made hidden meanwhile so it's there at once.
    openAddressWindow({ firstRun: true, show: false });
    showSplash(addressWindow);
    return;
  }
  // Saved as a server's root domain (before appOrigin): its app is used from now on.
  const fixed = await appOrigin(APP_URL).catch(() => APP_URL);
  if (fixed !== APP_URL) {
    writeConfig({ ...readConfig(), url: fixed });
    START_URL = START_URL.replace(ORIGIN, fixed);
    APP_URL = fixed;
    ORIGIN = fixed;
  }
  startMain();
});

/** The main window and what goes with it: updates, the tray, the microphone. Once, at start or once a server is set. */
function startMain(bounds = null) {
  createWindow(bounds);
  updater.init({
    manifestUrl: devEnv('ATRIUM_UPDATE_URL') || UPDATE_MANIFEST,
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
    void systemPreferences.askForMediaAccess('microphone');
  }
}
