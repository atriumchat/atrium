const {test} = require('node:test');
const assert = require('node:assert/strict');
const {EventEmitter} = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function fixture({beforeReady, probe, installFailure} = {}) {
  let connection;
  class Client extends EventEmitter {
    constructor() { super(); connection = this; this.ended = false; this.commands = 0; }
    connect() { queueMicrotask(() => this.emit(beforeReady || 'ready')); }
    end() { this.ended = true; }
    exec(command, callback) {
      this.commands++;
      if (this.commands === 1 && probe) return probe(this, callback);
      if (this.commands > 1 && installFailure) return queueMicrotask(() => this.emit('close'));
      const stream = new EventEmitter();
      stream.stderr = new EventEmitter();
      stream.end = () => {};
      stream.close = () => {};
      callback(null, stream);
      queueMicrotask(() => {
        stream.emit('data', Buffer.from('OS=Debian\nARCH=x86_64\nMEM=2048\nDISK=8192\nUID=0\n'));
        stream.emit('close', 0);
      });
    }
  }
  const module = {exports:{}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../server-setup.js'),'utf8'), {
    module, Buffer, setTimeout, clearTimeout, setInterval, clearInterval,
    require(name) {
      if (name === 'ssh2') return {Client,utils:{generateKeyPairSync:()=>({private:'private fixture',public:'public fixture'})}};
      if (name === 'node:dns') return {promises:{lookup:async()=>({address:'192.0.2.1'})}};
      if (name === './i18n') return {t:key=>key};
      return require(name);
    }
  });
  return {api:module.exports, get conn() { return connection; }};
}
const login = {host:'fixture.invalid', user:'root', password:'fixture-only'};

test('probe callback failure returns an error and closes the transport', async () => {
  const f = fixture({probe:(_,cb)=>cb(new Error('lost after authentication'))});
  assert.equal(typeof (await f.api.connect(login)).error, 'string');
  assert.equal(f.conn.ended, true);
});
for (const event of ['close','end','error']) {
  test(`transport ${event} during probe settles instead of hanging`, {timeout:1000}, async () => {
    const f = fixture({probe:conn=>queueMicrotask(()=>conn.emit(event,new Error('transport failed')))});
    assert.equal(typeof (await f.api.connect(login)).error, 'string');
    assert.equal(f.conn.ended, true);
  });
}
for (const event of ['close','end']) {
  test(`transport ${event} before authentication settles`, {timeout:1000}, async () => {
    const f = fixture({beforeReady:event});
    assert.equal(typeof (await f.api.connect(login)).error, 'string');
    assert.equal(f.conn.ended, true);
  });
}
test('successful probe returns facts; installation transport failure reports fail', {timeout:1000}, async () => {
  const f = fixture({installFailure:true});
  const answer = await f.api.connect(login);
  assert.equal(answer.facts.ip,'192.0.2.1');
  const reports = [];
  await f.api.install({domain:'fixture.example',turn:'turn'}, item=>reports.push(item), ()=>{});
  assert.equal(reports.at(-1).state,'fail');
  assert.equal(f.conn.ended,true);
});
