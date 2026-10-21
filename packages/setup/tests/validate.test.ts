import assert from 'node:assert/strict';
import { test } from 'node:test';
import { adminForm, codeFrom, domainOk, emailOk, freeName, hostOk, nameOk } from '../src/index';

test('free names', () => {
  assert.equal(freeName(' Podval.dedyn.io '), 'podval');
  assert.ok(nameOk('podval'));
  assert.ok(!nameOk('ab'));
  assert.ok(!nameOk('-bad'));
  assert.ok(!nameOk('ok_no'));
});

test('e-mail catches slips, not every oddity', () => {
  for (const ok of ['me@gmail.com', 'a.b+c@mail.co.uk', 'x@ya.ru']) assert.ok(emailOk(ok), ok);
  for (const bad of ['me@gmail', 'me@.com', 'me gmail.com', 'me@gmail.c', '@gmail.com']) assert.ok(!emailOk(bad), bad);
});

test('hosts and domains', () => {
  for (const ok of ['203.0.113.10', 'vps.example.com', '2001:db8::1']) assert.ok(hostOk(ok), ok);
  assert.ok(!hostOk('not a host'));
  assert.ok(domainOk('Chat.Example.com'));
  assert.ok(!domainOk('localhost'));
});

test('the setup code from a link or by itself', () => {
  assert.equal(codeFrom('https://app.podval.dedyn.io/?setup=AbC123xyz9'), 'AbC123xyz9');
  assert.equal(codeFrom(' abc-123 xyz 9999 '), 'abc123xyz9');
});

test('the admin form', () => {
  assert.deepEqual(adminForm('max', 'longpass', 'longpass'), { ready: true, mismatch: false });
  assert.deepEqual(adminForm('max', 'short', 'short'), { ready: false, mismatch: false });
  assert.deepEqual(adminForm('max', 'longpass', 'longpas'), { ready: false, mismatch: false });
  assert.deepEqual(adminForm('max', 'longpass', 'longpasX'), { ready: false, mismatch: true });
  assert.equal(adminForm('  ', 'longpass', 'longpass').ready, false);
});
