const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { test } = require('node:test');
const Module = require('node:module');

test('switching offline servers ignores a late retry and preserves the current invitation', async (t) => {
  const requests = [];
  const handlers = new Map();
  const covers = [];
  class Cover {
    constructor() {
      this.webContents = { isDestroyed: () => false, loadFile: () => Promise.resolve(), close: () => { this.closed = true; } };
      covers.push(this);
    }
    setBackgroundColor() {}
    setBounds() {}
  }
  const realLoad = Module._load;
  const loader = t.mock.method(Module, '_load', function (name, ...args) {
    if (name === 'electron') {
      return {
        app: new EventEmitter(),
        ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
        session: { defaultSession: { clearHostResolverCache: async () => {} } },
        net: { fetch: (url) => new Promise((resolve) => requests.push({ url, resolve })) },
        WebContentsView: Cover,
      };
    }
    return realLoad.call(this, name, ...args);
  });
  const reachable = require('../reachable');
  loader.mock.restore();
  t.mock.timers.enable({ apis: ['setTimeout'] });

  const win = new EventEmitter();
  win.webContents = new EventEmitter();
  const views = new Set();
  const urls = [];
  Object.assign(win, {
    isDestroyed: () => false,
    getContentSize: () => [600, 400],
    contentView: { addChildView: (view) => views.add(view), removeChildView: (view) => views.delete(view) },
    loadURL(url) {
      urls.push(url);
      this.webContents.emit('did-start-loading');
      return Promise.resolve();
    },
  });
  const fail = (url) => win.webContents.emit('did-fail-load', {}, -105, 'ERR_NAME_NOT_RESOLVED', url, true);
  const tick = () => new Promise((resolve) => setImmediate(resolve));

  const old = 'http://127.0.0.1:4351/?invite=old';
  const next = 'http://127.0.0.1:4352/?invite=new';
  reachable.open(win, old);
  fail(old);
  assert.equal(views.size, 1);
  const retryOld = handlers.get('unreachable:retry')({ sender: covers[0].webContents });
  await tick();
  assert.equal(requests.length, 1);

  reachable.open(win, next);
  fail(next);
  assert.equal(views.size, 1, 'only the current server has an offline cover');
  assert.equal(win.webContents.listenerCount('did-fail-load'), 1);
  assert.equal(covers[0].closed, true);
  requests[0].resolve({ status: 200 });
  await retryOld;
  assert.deepEqual(urls, [old, next], 'a late retry cannot send the window back to the old server');

  const retry = handlers.get('unreachable:retry')({ sender: covers.at(-1).webContents });
  await tick();
  assert.equal(requests[1].url, 'http://127.0.0.1:4352/');
  requests[1].resolve({ status: 200 });
  await retry;
  win.webContents.emit('did-finish-load');
  assert.deepEqual(urls, [old, next, next], 'the current retry keeps the invite link');
  assert.equal(views.size, 0);
  win.webContents.emit('did-start-loading');
  win.webContents.emit('did-navigate', {}, next, 503);
  win.webContents.emit('did-finish-load');
  assert.equal(views.size, 1, 'a load committed with 503 still needs a cover');
  win.emit('closed');
  assert.equal(win.webContents.listenerCount('did-fail-load'), 0);
});
