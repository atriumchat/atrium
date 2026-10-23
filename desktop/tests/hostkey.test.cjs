// SSH host keys: pinned at the first connection, refused when they change, known in advance for a rented server.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

/** server-setup.js against a made-up server whose host key is `keys.current` at the moment of connecting. */
function fixture() {
  const keys = { current: Buffer.from('host key one') };
  class Client extends EventEmitter {
    connect(options) {
      queueMicrotask(() => {
        if (!options.hostVerifier(keys.current)) return this.emit('error', new Error('Host denied (verification failed)'));
        this.emit('ready');
      });
    }
    end() {}
    exec(_command, callback) {
      const stream = new EventEmitter();
      stream.stderr = new EventEmitter();
      callback(null, stream);
      queueMicrotask(() => {
        stream.emit('data', Buffer.from('OS=Ubuntu\nARCH=x86_64\nMEM=2048\nDISK=8192\nUID=0\n'));
        stream.emit('close', 0);
      });
    }
  }
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../server-setup.js'), 'utf8'), {
    module,
    Buffer,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    require(name) {
      if (name === 'ssh2') return { Client, utils: { generateKeyPairSync: () => ({ private: 'private', public: 'public' }) } };
      if (name === 'node:dns') return { promises: { lookup: async () => ({ address: '192.0.2.1' }) } };
      if (name === './i18n') return { t: (key) => key };
      return require(name);
    },
  });
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'atrium-pins-'));
  module.exports.init({ dataDir });
  return { api: module.exports, keys };
}

const fingerprint = (key) => `SHA256:${crypto.createHash('sha256').update(key).digest('base64').replace(/=+$/, '')}`;
const login = { host: 'vps.example', user: 'root', password: 'pw' };

test('the first key is pinned; the same key again gets in', async () => {
  const { api, keys } = fixture();
  const first = await api.connect(login);
  assert.equal(first.facts.key, fingerprint(keys.current));
  assert.ok((await api.connect(login)).facts);
});

test('another key at the same address is refused, until "it is a new server"', async () => {
  const { api, keys } = fixture();
  await api.connect(login);
  keys.current = Buffer.from('someone else in between');
  const refused = await api.connect(login);
  assert.equal(refused.hostChanged, true);
  assert.equal(refused.error, 'ssh.hostChanged');
  api.forgetHost(login.host);
  assert.ok((await api.connect(login)).facts);
});

test("a rented server: only the key from its boot log", async () => {
  const { api, keys } = fixture();
  api.newAppKey();
  const wrong = await api.connectByKey('192.0.2.1', ['SHA256:' + 'A'.repeat(43)]);
  assert.equal(wrong.hostChanged, true);
  assert.ok((await api.connectByKey('192.0.2.1', [fingerprint(keys.current)])).facts);
});
