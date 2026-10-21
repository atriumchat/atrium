import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import { capacity, doneCount, loginError, mailboxOf, mockProgress, parseProbe, parseProgress, pickTurn, pointError, probeCommand, registerError, sq, startCommand, TASKS, TURN_NAMES } from '../src/index';

test('the install log reads as progress', () => {
  const log = ['::gomex run check', '::gomex done check 2', '::gomex run docker', '::gomex sub pulling layers', '::tail', 'some line', '\u001b[32m✓ ok\u001b[0m', ''].join('\n');
  const p = parseProgress(log);
  assert.deepEqual(p.steps.check, { state: 'done', took: 2 });
  assert.equal(p.current, 'docker');
  assert.equal(p.doing, 'pulling layers');
  assert.equal(doneCount(p), 1);
});

test('a failed, a finished and a quiet install', () => {
  const failed = parseProgress('::gomex run pull\n::gomex fail pull no space left\n::exit 1\n::tail\n');
  assert.equal(failed.failed, 'no space left');
  assert.equal(failed.exit, 1);
  const ready = parseProgress('::gomex ready https://app.x.dedyn.io/?setup=A\n::exit 0\n::tail\n');
  assert.equal(ready.ready, 'https://app.x.dedyn.io/?setup=A');
  assert.equal(parseProgress('::tail\nDownloading…\nStill here\n').doing, 'Still here');
});

test('the probe: the typed IP, root, sizes in GB', () => {
  assert.match(probeCommand(' 203.0.113.10 '), /echo IP=203\.0\.113\.10/);
  assert.match(probeCommand('vps.example.com'), /api\.ipify\.org/);
  const facts = parseProbe('OS=Ubuntu 24.04 LTS\nARCH=x86_64\nCPU=2\nMEM=1946\nDISK=17408\nUID=0\nIP=203.0.113.10');
  assert.deepEqual(facts, { ip: '203.0.113.10', os: 'Ubuntu 24.04 LTS · x86_64', root: true, cores: 2, memory: 1946 / 1024, disk: 17 });
  assert.equal(parseProbe('UID=1000').root, false);
});

test('quoting survives sh, whatever was typed', () => {
  for (const value of ["it's", "x'; rm -rf / #", '$(id) `id` "q"', 'plain']) {
    assert.equal(execFileSync('sh', ['-c', `printf %s ${sq(value)}`], { encoding: 'utf8' }), value);
  }
  const job = execFileSync('sh', ['-c', `printf %s ${startCommand({ domain: "x'y", turn: 'media', publicKey: 'ssh-ed25519 AAA' }).replace(/^rm -f \S+; nohup setsid sh -c /, '').replace(/ > \/dev\/null.*$/, '')}`], { encoding: 'utf8' });
  assert.match(job, /DOMAIN='x'\\''y' TURN_HOST='media'/);
  assert.ok(TURN_NAMES.includes(pickTurn(() => 0.99) as never));
});

test("deSEC's answers as error codes", () => {
  assert.deepEqual(registerError({ status: 400, json: { domain: ['This domain name conflicts with an existing domain.'] } }), { code: 'nameTaken' });
  assert.deepEqual(registerError({ status: 400, json: { email: ['Enter a valid email address.'] } }), { code: 'badEmail', said: 'Enter a valid email address.' });
  assert.deepEqual(registerError({ status: 429, json: null }), { code: 'tooOften' });
  assert.deepEqual(loginError({ status: 403, json: { detail: 'Invalid username/password.' } }), { code: 'savedRejected' });
  assert.deepEqual(loginError({ status: 403, json: { detail: 'Account locked.' } }), { code: 'accountDenied', said: 'Account locked.' });
  assert.equal(pointError({ status: 200 }), null);
  assert.deepEqual(pointError({ status: 500 }), { code: 'notAccepted', status: 500 });
});

test('mailboxes, capacity, the made-up install', () => {
  assert.deepEqual(mailboxOf('Me@GMail.com'), { id: 'gmail', url: 'https://mail.google.com/' });
  assert.equal(mailboxOf('me@example.org'), null);
  assert.deepEqual(capacity({ cores: 1, memory: 1 }), { call: 12, screen: 6 });
  assert.deepEqual(capacity({ cores: 4, memory: 8 }), { call: 60, screen: 30 });
  assert.equal(mockProgress(0).current, 'check');
  assert.equal(mockProgress(2.5).current, 'address');
  const done = mockProgress(1000);
  assert.equal(done.current, null);
  assert.equal(doneCount(done), TASKS.length);
  assert.match(done.ready ?? '', /\?setup=/);
});
