// The desktop app updating itself. (The chat is the server's site and changes with every deploy; this is for the
// shell around it.) The project's GitHub Releases list the current build in update.json (release "desktop"):
//   { "signed": "{\"version\":\"1.4.0\",\"files\":{\"darwin-arm64\":{\"url\":\"https://github.com/…/releases/download/
//                desktop-v1.4.0/Atrium-1.4.0-mac-apple-silicon.dmg\",\"sha256\":\"…\",\"size\":126545854},\"win32-x64\":{…}}}",
//     "signature": "<base64 Ed25519 signature over the UTF-8 bytes of `signed`>" }
// `signed` is the manifest as a string, so the signature covers exact bytes and nothing depends on how JSON
// gets re-serialised. We trust only that string, and only once it verifies against update-key.pem shipped
// inside the app: neither the server, a "new server address" nor whoever serves update.json can make us run
// anything the release key didn't sign.
// deploy/release-desktop.sh builds, signs and publishes it. We check at start and every few hours, download this
// platform's file in the background and check its SHA-256, then install on "Restart" or when the app quits:
// - macOS: the new Atrium.app is copied out of the DMG next to the running one, and a small script swaps the two
//   once we've exited. (Electron's built-in updater, Squirrel, only accepts a paid Developer ID signature.)
// - Windows: the installer runs silently and starts the new version.
const { app, net, shell } = require('electron');
const { createHash, createPublicKey, verify } = require('node:crypto');
const { execFile, execFileSync, spawn } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const { promisify } = require('node:util');
const { t } = require('./i18n');

const run = promisify(execFile);
const CHECK_EVERY = 4 * 60 * 60 * 1000;
const PLATFORM = `${process.platform}-${process.arch}`;
const DIR = path.join(app.getPath('temp'), 'atrium-update');
const KEY_FILE = path.join(__dirname, 'update-key.pem');
// The only installer type each platform can run; anything else in a manifest is refused.
const EXTENSIONS = { darwin: '.dmg', win32: '.exe' };
const MAX_SIZE = 1024 * 1024 * 1024;
// A download that stalls this long, or takes longer than the cap overall, is dropped and retried next check.
const IDLE_TIMEOUT = 60 * 1000;
const DOWNLOAD_CAP = 60 * 60 * 1000;
const MANIFEST_TIMEOUT = 30 * 1000;

/**
 * status: idle | checking | downloading (progress 0..1) | ready (version) | latest | manual (version: can't
 * install by itself, e.g. not run from Applications — offer the download) | error (error; code 'no-key' when
 * this build has no update-key.pem and so can never update, which the page shows for good, not just on a check)
 */
let state = { status: 'idle', current: app.getVersion() };
const noKey = () => ({ status: 'error', code: 'no-key', error: t('update.noKey') });
let manifestUrl = '';
let onChange = () => {};
/**
 * The verified update, waiting to be installed: { version, file, bundle?, staged?, downloadUrl, manual? }.
 * This, not the status string, is what install decides on: a later check may show 'checking' or fail,
 * and the update that's already staged must still go in.
 */
let ready = null;
let running = null;
let installing = false;

function set(next) {
  state = { current: app.getVersion(), ...next };
  onChange(state);
}

/** "1.10.0" > "1.9.3" */
function isNewer(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  }
  return false;
}

let publicKey;
/** The release key bundled with the app, or null if it's missing (then nothing gets installed). */
function releaseKey() {
  if (publicKey === undefined) {
    try {
      publicKey = createPublicKey(fs.readFileSync(KEY_FILE, 'utf8'));
    } catch {
      publicKey = null;
    }
  }
  return publicKey;
}

/** update.json → the manifest it carries, if its signature checks out with `key`; throws otherwise. */
function verifyManifest(body, key) {
  if (!key) throw new Error(t('update.noKey'));
  if (typeof body?.signed !== 'string' || typeof body?.signature !== 'string') throw new Error(t('update.unsigned'));
  let ok = false;
  try {
    ok = verify(null, Buffer.from(body.signed, 'utf8'), key, Buffer.from(body.signature, 'base64'));
  } catch {
    ok = false;
  }
  if (!ok) throw new Error(t('update.badSignature'));
  return JSON.parse(body.signed);
}

/**
 * This platform's file from a verified manifest: { version, downloadUrl, sha256, size }, or null when there's
 * nothing newer for us. Throws on anything malformed — the version ends up in a file name, the URL is fetched.
 */
function pickUpdate(manifest, manifestUrl, platform, current) {
  const version = manifest?.version;
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version)) throw new Error(t('update.badVersion'));
  const file = manifest.files?.[platform];
  if (!isNewer(version, current) || !file) return null;
  const url = new URL(String(file.url), manifestUrl);
  // Only next to the manifest: …/releases/download/desktop/update.json lists files under …/releases/download/.
  const base = new URL('..', manifestUrl);
  if (url.protocol !== 'https:' || url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) {
    throw new Error(t('update.foreignUrl'));
  }
  const ext = path.extname(url.pathname).toLowerCase();
  if (!ext || ext !== EXTENSIONS[platform.split('-')[0]]) throw new Error(t('update.badType'));
  const sha256 = String(file.sha256).toLowerCase();
  const size = Number(file.size);
  if (!/^[0-9a-f]{64}$/.test(sha256) || !Number.isSafeInteger(size) || size <= 0 || size > MAX_SIZE) {
    throw new Error(t('update.badFile'));
  }
  return { version, downloadUrl: url.href, ext, sha256, size };
}

/** An AbortController that fires `ms` after start, or after `ms` without touch() when `idle` is set. */
function deadline(ms, message, idle = false) {
  const controller = new AbortController();
  let timer;
  const touch = () => {
    clearTimeout(timer);
    timer = setTimeout(() => controller.abort(new Error(message)), ms);
  };
  touch();
  return { signal: controller.signal, touch: idle ? touch : () => {}, clear: () => clearTimeout(timer) };
}

/** Rejects with the abort reason once `signal` fires (raced against fetches that might not honour it). */
function whenAborted(signal) {
  const promise = new Promise((_, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
  promise.catch(() => {}); // only ever awaited through Promise.race
  return promise;
}

async function sha256(file) {
  const hash = createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

async function download(url, dest, expected) {
  if (fs.existsSync(dest) && (await sha256(dest)) === expected.sha256) return; // fetched on an earlier run
  const idle = deadline(IDLE_TIMEOUT, t('update.stalled'), true);
  const overall = deadline(DOWNLOAD_CAP, t('update.tooLong'));
  const signal = AbortSignal.any([idle.signal, overall.signal]);
  const part = `${dest}.part`;
  let reader = null;
  // A stalled read only wakes up when the stream is cancelled.
  signal.addEventListener('abort', () => reader?.cancel(signal.reason).catch(() => {}), { once: true });
  const aborted = whenAborted(signal);
  try {
    const response = await Promise.race([net.fetch(url, { cache: 'no-store', signal }), aborted]);
    if (!response.ok || !response.body) throw new Error(t('update.status', { status: response.status }));
    reader = response.body.getReader();
    const out = fs.createWriteStream(part);
    let writeError = null;
    out.on('error', (e) => {
      writeError = e; // e.g. a full disk; an unhandled stream error would take the whole app down
    });
    const hash = createHash('sha256');
    let got = 0;
    let reported = 0;
    try {
      for (;;) {
        const { done, value } = await Promise.race([reader.read(), aborted]);
        if (done) break;
        idle.touch();
        got += value.length;
        if (got > expected.size) throw new Error(t('update.tooBig'));
        hash.update(value);
        if (writeError) throw writeError;
        if (!out.write(value)) await once(out, 'drain');
        if (Date.now() - reported > 500) {
          reported = Date.now();
          set({ status: 'downloading', version: state.version, progress: Math.min(got / expected.size, 1) });
        }
      }
    } finally {
      reader.cancel().catch(() => {});
      out.end();
      if (!out.closed) await once(out, 'close');
    }
    if (signal.aborted) throw signal.reason;
    if (writeError) throw writeError;
    if (got !== expected.size || hash.digest('hex') !== expected.sha256) throw new Error(t('update.corrupt'));
    fs.renameSync(part, dest);
  } catch (e) {
    fs.rmSync(part, { force: true });
    throw e;
  } finally {
    idle.clear();
    overall.clear();
  }
}

/** The running Atrium.app, if this copy can replace itself; otherwise null (and the user gets the download). */
function ownBundle() {
  const bundle = path.resolve(process.execPath, '..', '..', '..');
  // Started from the DMG, or from Downloads under macOS's "App Translocation": there's nothing to replace.
  if (!bundle.endsWith('.app') || bundle.startsWith('/Volumes/') || bundle.includes('/AppTranslocation/')) return null;
  try {
    fs.accessSync(path.dirname(bundle), fs.constants.W_OK);
    fs.accessSync(bundle, fs.constants.W_OK);
    return bundle;
  } catch {
    return null;
  }
}

// hdiutil mounts disk images on every macOS we support; the newest mark it deprecated in favour of
// `diskutil image`, which older ones don't have. So: hdiutil first, diskutil if it's gone.
async function attach(dmg, mount) {
  try {
    await run('hdiutil', ['attach', dmg, '-nobrowse', '-noautoopen', '-readonly', '-mountpoint', mount]);
  } catch {
    await run('diskutil', ['image', 'attach', '--mountOptions', 'nobrowse', '--readOnly', '--mountPoint', mount, dmg]);
  }
}

async function detach(mount) {
  await run('hdiutil', ['detach', mount, '-force']).catch(() => run('diskutil', ['eject', mount])).catch(() => {});
}

/** Copies the new Atrium.app out of the DMG to a hidden folder next to the running one, ready to swap in. */
async function stageMac(dmg, version, bundle) {
  const staged = path.join(path.dirname(bundle), '.Atrium-update.app');
  const mount = fs.mkdtempSync(path.join(DIR, 'mnt-'));
  await attach(dmg, mount);
  try {
    const inner = fs.readdirSync(mount).find((name) => name.endsWith('.app'));
    if (!inner) throw new Error(t('update.noApp'));
    fs.rmSync(staged, { recursive: true, force: true });
    await run('ditto', [path.join(mount, inner), staged]);
  } finally {
    await detach(mount);
    fs.rmSync(mount, { recursive: true, force: true });
  }
  const plist = path.join(staged, 'Contents', 'Info.plist');
  const { stdout } = await run('plutil', ['-extract', 'CFBundleShortVersionString', 'raw', '-o', '-', plist]);
  try {
    if (stdout.trim() !== version) throw new Error(t('update.wrongVersion', { found: stdout.trim(), expected: version }));
    await run('codesign', ['--verify', '--deep', staged]); // a damaged copy fails here
  } catch (e) {
    fs.rmSync(staged, { recursive: true, force: true });
    throw e;
  }
  return staged;
}

/** What the UI shows for the update that's waiting. */
function readyState() {
  return { status: ready.manual ? 'manual' : 'ready', version: ready.version };
}

async function fetchManifest() {
  const timeout = deadline(MANIFEST_TIMEOUT, t('update.manifestSilent'));
  const aborted = whenAborted(timeout.signal);
  try {
    const response = await Promise.race([net.fetch(manifestUrl, { cache: 'no-store', signal: timeout.signal }), aborted]);
    if (!response.ok) throw new Error(t('update.status', { status: response.status }));
    return await Promise.race([response.json(), aborted]);
  } finally {
    timeout.clear();
  }
}

async function checkNow() {
  // Built without the release key (electron-builder run by hand, not release-desktop.sh): nothing could ever
  // verify, so don't fetch at all and keep saying why.
  if (!releaseKey()) return set(noKey());
  // An update that's already waiting stays on screen while we look for a newer one.
  if (!ready) set({ status: 'checking' });
  const manifest = verifyManifest(await fetchManifest(), releaseKey());
  const update = pickUpdate(manifest, manifestUrl, PLATFORM, app.getVersion());
  if (!update) return set(ready ? readyState() : { status: 'latest' });
  const { version, downloadUrl } = update;
  if (ready?.version === version) return set(readyState());

  const bundle = process.platform === 'darwin' ? ownBundle() : null;
  if (process.platform === 'darwin' && !bundle) {
    ready = { version, downloadUrl, manual: true };
    return set(readyState());
  }
  set({ status: 'downloading', version, progress: 0 });
  fs.mkdirSync(DIR, { recursive: true });
  const dest = path.join(DIR, `Atrium-${version}${update.ext}`);
  await download(downloadUrl, dest, { sha256: update.sha256, size: update.size });
  if (bundle) {
    // Staging reuses the one hidden folder, so the older staged update is gone from here on.
    ready = null;
    const staged = await stageMac(dest, version, bundle);
    ready = { version, file: dest, downloadUrl, bundle, staged };
  } else {
    ready = { version, file: dest, downloadUrl, sha256: update.sha256 };
  }
  // Older downloads are no use any more.
  for (const name of fs.readdirSync(DIR)) {
    if (name.startsWith('Atrium-') && path.join(DIR, name) !== dest) fs.rmSync(path.join(DIR, name), { force: true });
  }
  set(readyState());
}

/** Looks for an update now (no-op while one is already being looked for or downloaded). */
function check() {
  if (!app.isPackaged || installing || !manifestUrl) return Promise.resolve(state);
  running ??= checkNow()
    // A failed check doesn't hide an update that's already waiting.
    .catch((e) => set(ready ? readyState() : { status: 'error', error: e instanceof Error ? e.message : String(e) }))
    .finally(() => {
      running = null;
    });
  return running.then(() => state);
}

/** The file's SHA-256 right now, read in one go (at install time, when nothing else is running). */
function sha256Now(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

/**
 * Starts the swap / installer; with `relaunch`, the new version opens when it's done. What runs is checked once more
 * right before (hours may have passed since the download): the installer's SHA-256, the staged app's signature.
 */
function startInstall(relaunch) {
  if (!ready || ready.manual || installing) return false;
  if (process.platform === 'darwin') {
    if (!ready.staged || !fs.existsSync(ready.staged)) return false;
    try {
      execFileSync('codesign', ['--verify', '--deep', ready.staged], { stdio: 'ignore' });
    } catch {
      fs.rmSync(ready.staged, { recursive: true, force: true });
      ready = null;
      return false;
    }
    // Waits for this process to exit, swaps the bundles (putting the old one back if the second move fails).
    const script = [
      'while kill -0 "$1" 2>/dev/null; do sleep 0.2; done',
      'old="$2.previous"',
      'rm -rf "$old"',
      'if mv "$2" "$old"; then',
      '  if mv "$3" "$2"; then rm -rf "$old"; else mv "$old" "$2"; fi',
      'fi',
      '[ "$4" = 1 ] && open "$2"',
    ].join('\n');
    const args = ['-c', script, 'atrium-update', String(process.pid), ready.bundle, ready.staged, relaunch ? '1' : '0'];
    spawn('/bin/sh', args, { detached: true, stdio: 'ignore' }).unref();
  } else if (process.platform === 'win32') {
    if (!ready.file || !fs.existsSync(ready.file)) return false;
    if (sha256Now(ready.file) !== ready.sha256) {
      fs.rmSync(ready.file, { force: true });
      ready = null;
      return false;
    }
    // The NSIS installer: --updated marks it as an update, /S keeps it silent, --force-run starts Atrium after.
    const args = relaunch ? ['--updated', '/S', '--force-run'] : ['--updated', '/S'];
    spawn(ready.file, args, { detached: true, stdio: 'ignore' }).unref();
  } else {
    return false;
  }
  installing = true;
  return true;
}

/** "Restart": install and reopen, or open the download when this copy can't update itself. */
function install() {
  if (ready?.manual) {
    if (ready.downloadUrl.startsWith('https://')) shell.openExternal(ready.downloadUrl);
    return;
  }
  if (startInstall(true)) app.quit();
}

/** Called as the app quits: an update that's ready goes in quietly, without reopening. */
function installOnQuit() {
  if (ready) startInstall(false);
}

function init(options) {
  manifestUrl = options.manifestUrl;
  onChange = options.onChange;
  if (!app.isPackaged) return;
  // Known at once, no need to wait for the first check: the page shows it from the start.
  if (!releaseKey()) set(noKey());
  setTimeout(check, 15_000);
  setInterval(check, CHECK_EVERY);
}

module.exports = { init, check, install, installOnQuit, getState: () => state, verifyManifest, pickUpdate };
