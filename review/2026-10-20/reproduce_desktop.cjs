// No SSH connection or installation is performed: the transport fails just after authentication.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {EventEmitter} = require('node:events');
const assert = require('node:assert/strict');
class Client extends EventEmitter {
  connect() { queueMicrotask(() => this.emit('ready')); }
  exec(command, callback) { callback(new Error('SSH transport lost after authentication')); }
  end() {}
}
const moduleState = {exports:{}};
const context = {
 module:moduleState, console, Buffer, setTimeout, clearTimeout, setInterval, clearInterval,
 require(name) {
  if (name === 'ssh2') return {Client,utils:{}};
  if (name === 'node:dns') return {promises:{lookup:async()=>({address:'192.0.2.1'})}};
  if (name === './i18n') return {t:key=>key};
  return require(name);
 }
};
vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../../desktop/server-setup.js'),'utf8'),context);
(async()=> {
 let answer;
 try { answer = await moduleState.exports.connect({host:'review.invalid',user:'root',password:'disposable-test-value'}); }
 catch(error) { answer = {uncaughtRejection:error.message}; }
 assert.ok(answer.uncaughtRejection);
 console.log('SSH_PROBE_FAILURE:',JSON.stringify(answer));
 console.log('The onboarding submit handler awaits this call without catch/finally; busy(false) is skipped.');
})().catch(error=>{console.error(error);process.exitCode=1;});
