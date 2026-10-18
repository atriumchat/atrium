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

/** The window being kept open: { contents, cover, origin, show, retry }. */
let current = null;

/**
 * Opens `url` in `win`. When the load fails (no network, the name not spread yet, no certificate yet) a page over the
 * window says so (unreachable.html) and the server is checked every few seconds; once it answers the window loads it
 * and the page goes away.
 */
function open(win, url) {
  const origin = new URL(url).origin;
  let target = url;
  let cover = null; // the page, a view of its own so it has its own bridge
  let failed = false; // the load in progress failed
  let busy = false;
  let timer = null;

  const fit = () => {
    if (!cover || win.isDestroyed()) return;
    const [width, height] = win.getContentSize();
    cover.setBounds({ x: 0, y: 0, width, height });
  };
  const later = () => {
    clearTimeout(timer);
    timer = setTimeout(retry, EVERY);
  };
  const show = (from) => {
    if (win.isDestroyed()) return;
    if (from?.startsWith(origin)) target = from;
    if (!cover) {
      cover = new WebContentsView({
        webPreferences: { preload: path.join(__dirname, 'unreachable-preload.js'), contextIsolation: true, sandbox: true },
      });
      cover.setBackgroundColor('#0b0b0d');
      win.contentView.addChildView(cover);
      fit();
      cover.webContents.loadFile(path.join(__dirname, 'unreachable.html'), { query: { lang: i18n.getLang(), host: new URL(url).host } });
      current.cover = cover;
    }
    later();
  };
  const hide = () => {
    clearTimeout(timer);
    if (!cover) return;
    if (!win.isDestroyed()) win.contentView.removeChildView(cover);
    cover.webContents.close();
    cover = current.cover = null;
  };
  async function retry() {
    clearTimeout(timer);
    if (busy || win.isDestroyed()) return;
    busy = true;
    const up = await answers(target);
    busy = false;
    if (win.isDestroyed()) return;
    if (up) win.loadURL(target);
    else later();
  }

  current = { contents: win.webContents, cover, origin, show, retry };
  win.on('resize', fit);
  win.on('closed', () => {
    clearTimeout(timer);
    current = null;
  });
  win.webContents.on('did-start-loading', () => (failed = false));
  win.webContents.on('did-fail-load', (_event, code, _description, from, isMainFrame) => {
    // -3: a load that another one replaced or the person stopped.
    if (!isMainFrame || code === -3) return;
    failed = true;
    show(from);
  });
  win.webContents.on('did-finish-load', () => {
    if (!failed) hide();
  });
  win.loadURL(url);
}

// A certificate that doesn't check out is refused as it always was; the window just says so.
app.on('certificate-error', (event, contents, url, _error, _certificate, callback) => {
  event.preventDefault();
  callback(false);
  if (current?.contents === contents && url.startsWith(current.origin)) current.show(url);
});

// "Retry" on the page.
ipcMain.handle('unreachable:retry', async (event) => {
  if (current?.cover && event.sender === current.cover.webContents) await current.retry();
});

/** The language changed: the "Server unreachable" page, if it's up, reloads in it. */
function relocalize() {
  const contents = current?.cover?.webContents;
  if (!contents || contents.isDestroyed()) return;
  const url = new URL(contents.getURL());
  url.searchParams.set('lang', i18n.getLang());
  contents.loadURL(url.href);
}

module.exports = { answers, open, relocalize };
