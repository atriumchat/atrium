// Whether a server opens from this computer, and what the main window shows while it doesn't. A new address can take
// minutes to reach the provider's DNS, and a certificate not yet issued fails the same way; a window that failed to
// load once stayed black (macOS keeps the failure for a while), so the window says so and tries again by itself.
// Main process only.
const { app, ipcMain, net, session, WebContentsView } = require('electron');
const path = require('node:path');
const i18n = require('./i18n');

const EVERY = 5000;

/**
 * Whether the server at `url` answers from this computer. Chromium's own network stack does the asking (net.fetch),
 * the one the window loads the page with: Node's resolver doesn't work on every machine. A server that's up but not
 * ready (5xx) doesn't count.
 */
async function answers(url) {
  try {
    // An earlier "no such name" would be remembered here for a while.
    await session.defaultSession.clearHostResolverCache();
    const response = await net.fetch(`${new URL(url).origin}/`, { cache: 'no-store', signal: AbortSignal.timeout(8000) });
    return response.status < 500;
  } catch {
    return false;
  }
}

/** The one active navigation and its offline cover. */
let current = null;

/**
 * Opens `url` in `win`. When the load fails (no network, the name not spread yet, no certificate yet) a page over the
 * window says so (unreachable.html) and the server is checked every few seconds; once it answers the window loads it
 * and the page goes away.
 */
function open(win, url) {
  current?.dispose();
  const contents = win.webContents;
  const { origin, host } = new URL(url);
  let target = url;
  let failed = false; // the load in progress failed
  let busy = false;
  let timer = null;
  const navigation = { contents, cover: null, origin, show, retry, dispose };
  const active = () => current === navigation && !win.isDestroyed();
  const load = () => win.loadURL(target).catch(() => undefined); // did-fail-load handles errors

  const fit = () => {
    const { cover } = navigation;
    if (!cover || !active()) return;
    const [width, height] = win.getContentSize();
    cover.setBounds({ x: 0, y: 0, width, height });
  };
  const later = () => {
    clearTimeout(timer);
    timer = setTimeout(retry, EVERY);
  };
  function show(from) {
    if (!active()) return;
    if (from && URL.parse(from)?.origin === origin) target = from;
    if (!navigation.cover) {
      const cover = new WebContentsView({
        webPreferences: { preload: path.join(__dirname, 'unreachable-preload.js'), contextIsolation: true, sandbox: true },
      });
      navigation.cover = cover;
      cover.setBackgroundColor('#0b0b0d');
      win.contentView.addChildView(cover);
      fit();
      cover.webContents
        .loadFile(path.join(__dirname, 'unreachable.html'), { query: { lang: i18n.getLang(), host } })
        .catch(() => undefined);
    }
    later();
  }
  const hide = () => {
    clearTimeout(timer);
    const { cover } = navigation;
    if (!cover) return;
    navigation.cover = null;
    if (!win.isDestroyed()) win.contentView.removeChildView(cover);
    if (!cover.webContents.isDestroyed()) cover.webContents.close();
  };
  async function retry() {
    if (busy || !active()) return;
    clearTimeout(timer);
    busy = true;
    try {
      const up = await answers(target);
      if (!active() || !navigation.cover) return;
      if (up) await load();
      else later();
    } finally {
      busy = false;
    }
  }

  function dispose() {
    current = null;
    hide();
    win.removeListener('resize', fit);
    win.removeListener('closed', dispose);
    contents.removeListener('did-start-loading', onStart);
    contents.removeListener('did-fail-load', onFail);
    contents.removeListener('did-navigate', onNavigate);
    contents.removeListener('did-finish-load', onFinish);
  }
  const onStart = () => (failed = false);
  const onFail = (_event, code, _description, from, isMainFrame) => {
    // -3: a load that another one replaced or the person stopped.
    if (!isMainFrame || code === -3) return;
    failed = true;
    show(from);
  };
  const onNavigate = (_event, url, status) => {
    if (status < 500) return;
    failed = true;
    show(url);
  };
  const onFinish = () => {
    if (!failed) hide();
  };
  current = navigation;
  win.on('resize', fit);
  win.once('closed', dispose);
  contents.on('did-start-loading', onStart);
  contents.on('did-fail-load', onFail);
  contents.on('did-navigate', onNavigate);
  contents.on('did-finish-load', onFinish);
  void load();
}

// A certificate that doesn't check out is refused as it always was; the window just says so.
app.on('certificate-error', (event, contents, url, _error, _certificate, callback) => {
  event.preventDefault();
  callback(false);
  if (current?.contents === contents && URL.parse(url)?.origin === current.origin) current.show();
});

// "Retry" on the page.
ipcMain.handle('unreachable:retry', async (event) => {
  if (current?.cover && event.sender === current.cover.webContents) await current.retry();
});

/** The language changed: the "Server unreachable" page, if it's up, reloads in it. */
function relocalize() {
  const contents = current?.cover?.webContents;
  if (!contents || contents.isDestroyed()) return;
  const url = URL.parse(contents.getURL());
  if (!url) return;
  url.searchParams.set('lang', i18n.getLang());
  contents.loadURL(url.href).catch(() => undefined);
}

module.exports = { answers, open, relocalize };
