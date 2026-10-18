// The screen-share picker (picker.html), for where the system has no picker of its own: live thumbnails of the
// windows and screens, one to be chosen. choose() answers with the pick, or null when the person cancelled.
const { BrowserWindow, desktopCapturer, ipcMain, screen } = require('electron');
const path = require('node:path');
const i18n = require('./i18n');

// Twice the size a card shows, so the thumbnails stay sharp on a dense screen.
const THUMBNAIL = { width: 480, height: 300 };

/** @type {BrowserWindow | null} */
let picker = null;
/** Ends the open picker: resolves choose() and closes the window. Null when none is open. */
let settle = null;
// What the last listings offered. Only these can be chosen, whatever the page sends.
const offered = new Map();

const fromPicker = (event) => picker !== null && event.sender === picker.webContents;

/** "Screen 1" is the main display, the rest follow left to right; the only one is "Entire screen". */
function nameScreens(sources) {
  const primary = screen.getPrimaryDisplay().id;
  const rank = new Map(
    screen
      .getAllDisplays()
      .sort((a, b) => (b.id === primary) - (a.id === primary) || a.bounds.x - b.bounds.x || a.bounds.y - b.bounds.y)
      .map((display, index) => [String(display.id), index]),
  );
  // Where the system doesn't say which display a source is, they keep the order they came in (the sort is stable).
  const ordered = [...sources].sort((a, b) => (rank.get(a.display_id) ?? Infinity) - (rank.get(b.display_id) ?? Infinity));
  return ordered.map((source, index) => ({ source, name: ordered.length === 1 ? i18n.t('picker.wholeScreen') : i18n.t('picker.screenN', { n: index + 1 }) }));
}

async function list(kind) {
  const found = await desktopCapturer.getSources({
    types: [kind],
    thumbnailSize: THUMBNAIL,
    // Only Windows hands out the icons; elsewhere the cards go without.
    fetchWindowIcons: kind === 'window',
  });
  const own = picker?.getMediaSourceId();
  const named =
    kind === 'screen'
      ? nameScreens(found)
      : // A window that can't be drawn (minimized, or the system won't say) is no use to pick, and neither is one without a title.
        found.filter((source) => source.id !== own && source.name && !source.thumbnail.isEmpty()).map((source) => ({ source, name: source.name }));
  for (const [id, entry] of offered) if (entry.kind === kind) offered.delete(id);
  return named.map(({ source, name }) => {
    offered.set(source.id, { kind, source });
    return {
      id: source.id,
      name,
      thumb: source.thumbnail.isEmpty() ? null : `data:image/jpeg;base64,${source.thumbnail.toJPEG(80).toString('base64')}`,
      icon: source.appIcon && !source.appIcon.isEmpty() ? source.appIcon.resize({ width: 32, height: 32 }).toDataURL() : null,
    };
  });
}

ipcMain.handle('picker:list', async (event, kind) => {
  if (!fromPicker(event) || (kind !== 'window' && kind !== 'screen')) return { error: true };
  try {
    return { sources: await list(kind) };
  } catch {
    return { error: true };
  }
});

ipcMain.on('picker:choose', (event, id, sound) => {
  if (!fromPicker(event)) return;
  const entry = offered.get(id);
  if (entry) settle?.({ source: entry.source, sound: sound === true });
});

ipcMain.on('picker:cancel', (event) => {
  if (fromPicker(event)) settle?.(null);
});

/** sound: whether the picker offers the "Sound" switch. A second request while one is open is cancelled at once. */
function choose(parent, { sound }) {
  if (picker) return Promise.resolve(null);
  return new Promise((resolve) => {
    // A sheet on the Gomex window; with no window to hold it (hidden to the tray), a window of its own.
    const modal = Boolean(parent) && !parent.isDestroyed() && parent.isVisible() && !parent.isMinimized();
    picker = new BrowserWindow({
      ...(modal ? { parent, modal: true } : {}),
      width: 720,
      height: 560,
      minWidth: 480,
      minHeight: 400,
      title: i18n.t('picker.title'),
      backgroundColor: '#0c0c0e',
      show: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      autoHideMenuBar: true,
      webPreferences: { preload: path.join(__dirname, 'picker-preload.js'), contextIsolation: true, sandbox: true },
    });
    picker.removeMenu();
    picker.loadFile(path.join(__dirname, 'picker.html'), { query: { lang: i18n.getLang(), sound: sound ? '1' : '' } });
    picker.once('ready-to-show', () => picker?.show());
    settle = (answer) => {
      settle = null;
      resolve(answer);
      picker?.close();
    };
    // Closed some other way (the window's own close button, the main window going away): a cancel.
    picker.on('closed', () => {
      picker = null;
      offered.clear();
      settle?.(null);
    });
  });
}

/** The language changed: the open picker (if any) reloads in it, with its window title. */
function relocalize() {
  if (!picker) return;
  picker.setTitle(i18n.t('picker.title'));
  const url = new URL(picker.webContents.getURL());
  url.searchParams.set('lang', i18n.getLang());
  picker.webContents.loadURL(url.href);
}

module.exports = { choose, relocalize };
