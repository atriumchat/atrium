// The updater's checks on what it's offered: the signature over the manifest, then the file it picks out of it.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function load() {
  const module = { exports: {} };
  const electron = {
    app: { getPath: () => '/tmp', getVersion: () => '1.8.0', isPackaged: false },
    net: {},
    shell: {},
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../updater.js'), 'utf8'), {
    module,
    Buffer,
    URL,
    AbortController,
    AbortSignal,
    setTimeout,
    clearTimeout,
    setInterval,
    __dirname: path.join(__dirname, '..'),
    process: { platform: 'darwin', arch: 'arm64', execPath: '/Applications/Atrium.app/Contents/MacOS/Atrium', pid: 1 },
    require(name) {
      if (name === 'electron') return electron;
      if (name === './i18n') return { t: (key) => key };
      return require(name);
    },
  });
  return module.exports;
}

const { verifyManifest, pickUpdate } = load();
const keys = crypto.generateKeyPairSync('ed25519');
const MANIFEST_URL = 'https://github.com/atriumchat/atrium/releases/download/desktop/update.json';
const FILE = {
  url: 'https://github.com/atriumchat/atrium/releases/download/desktop-v1.9.0/Atrium-1.9.0-mac.dmg',
  sha256: 'a'.repeat(64),
  size: 100_000_000,
};
const manifest = (fields = {}) => ({ version: '1.9.0', files: { 'darwin-arm64': FILE }, ...fields });
const signed = (body, key = keys.privateKey) => {
  const text = JSON.stringify(body);
  return { signed: text, signature: crypto.sign(null, Buffer.from(text, 'utf8'), key).toString('base64') };
};

test('a manifest signed with the release key is taken as it is', () => {
  // Made in the updater's own context: compared as JSON.
  assert.equal(JSON.stringify(verifyManifest(signed(manifest()), keys.publicKey)), JSON.stringify(manifest()));
});

test('no key, no signature, a changed manifest or another key: refused', () => {
  assert.throws(() => verifyManifest(signed(manifest()), null), /update.noKey/);
  assert.throws(() => verifyManifest({ signed: JSON.stringify(manifest()) }, keys.publicKey), /update.unsigned/);
  const body = signed(manifest());
  assert.throws(() => verifyManifest({ ...body, signed: body.signed.replace('1.9.0', '9.9.9') }, keys.publicKey), /update.badSignature/);
  const other = crypto.generateKeyPairSync('ed25519');
  assert.throws(() => verifyManifest(signed(manifest(), other.privateKey), keys.publicKey), /update.badSignature/);
});

test("this platform's newer file is picked, with its hash and size", () => {
  const picked = pickUpdate(manifest(), MANIFEST_URL, 'darwin-arm64', '1.8.0');
  assert.equal(picked.version, '1.9.0');
  assert.equal(picked.downloadUrl, FILE.url);
  assert.equal(picked.ext, '.dmg');
  assert.equal(picked.sha256, FILE.sha256);
  assert.equal(picked.size, FILE.size);
});

test('nothing newer, or nothing for this platform: no update', () => {
  assert.equal(pickUpdate(manifest({ version: '1.8.0' }), MANIFEST_URL, 'darwin-arm64', '1.8.0'), null);
  assert.equal(pickUpdate(manifest({ version: '1.7.9' }), MANIFEST_URL, 'darwin-arm64', '1.8.0'), null);
  assert.equal(pickUpdate(manifest(), MANIFEST_URL, 'win32-x64', '1.8.0'), null);
});

test('a file from anywhere but next to the manifest is refused', () => {
  for (const url of [
    'https://evil.example/Atrium-1.9.0-mac.dmg',
    'https://github.com/someone/else/releases/download/x/Atrium.dmg',
    'http://github.com/atriumchat/atrium/releases/download/desktop-v1.9.0/Atrium.dmg',
  ]) {
    assert.throws(() => pickUpdate(manifest({ files: { 'darwin-arm64': { ...FILE, url } } }), MANIFEST_URL, 'darwin-arm64', '1.8.0'), /update.foreignUrl/);
  }
});

test('a wrong type, a bad hash or size, an odd version: refused', () => {
  const file = (fields) => manifest({ files: { 'darwin-arm64': { ...FILE, ...fields } } });
  assert.throws(() => pickUpdate(file({ url: FILE.url.replace('.dmg', '.pkg') }), MANIFEST_URL, 'darwin-arm64', '1.8.0'), /update.badType/);
  assert.throws(() => pickUpdate(file({ sha256: 'xyz' }), MANIFEST_URL, 'darwin-arm64', '1.8.0'), /update.badFile/);
  assert.throws(() => pickUpdate(file({ size: 2 * 1024 ** 3 }), MANIFEST_URL, 'darwin-arm64', '1.8.0'), /update.badFile/);
  assert.throws(() => pickUpdate(file({ size: 0 }), MANIFEST_URL, 'darwin-arm64', '1.8.0'), /update.badFile/);
  assert.throws(() => pickUpdate(manifest({ version: '1.9.0; rm -rf /' }), MANIFEST_URL, 'darwin-arm64', '1.8.0'), /update.badVersion/);
});
