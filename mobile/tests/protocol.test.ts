import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { historyPath, mergeMessages, normalizeServer, parseMediaCookie, type Message } from '../src/protocol';

const message = (id: string, at: number, content = id): Message => ({ id, createdAt: at, channelId: 'room', userId: 'user', content, attachments: [] });

test('server normalization requires a secure origin and rejects embedded credentials and paths', () => {
  assert.equal(normalizeServer('app.example.com'), 'https://app.example.com');
  assert.equal(normalizeServer(' https://APP.example.com/ '), 'https://app.example.com');
  assert.equal(normalizeServer('http://localhost:8010'), 'http://localhost:8010');
  for (const value of ['http://example.com', 'ftp://example.com', 'https://u:password@example.com', 'https://example.com/api', 'https://example.com?token=secret', 'https://example.com#fragment']) assert.throws(() => normalizeServer(value), value);
});

test('native media forwards only the scoped media cookie, excluding cookie attributes and other cookies', () => {
  assert.equal(parseMediaCookie('gx_media=abc.def-ghi; HttpOnly; Path=/api/; Secure; SameSite=strict'), 'gx_media=abc.def-ghi');
  assert.equal(parseMediaCookie('other=secret; Path=/, gx_media=abc.def; HttpOnly'), 'gx_media=abc.def');
  assert.equal(parseMediaCookie('not_gx_media=bad; Path=/'), null);
  assert.equal(parseMediaCookie(null), null);
});

test('history uses both timestamp and id so simultaneous messages are not skipped', () => {
  assert.equal(historyPath('room', false, message('b', 100)), '/api/channels/room/messages?before=100&beforeId=b');
  assert.equal(historyPath('private', true), '/api/dms/private/messages');
  assert.equal(historyPath('a/b', true), '/api/dms/a%2Fb/messages');
});

test('socket echo and acknowledgement produce one message, keeping the latest edit', () => {
  const output = mergeMessages([message('a', 1), message('b', 2)], [message('b', 2, 'edited'), message('c', 2)]);
  assert.deepEqual(output.map((m) => m.id), ['c', 'b', 'a']);
  assert.equal(output[1]?.content, 'edited');
});

test('repeated pages and reconnect overlap retain ordering and enforce the memory budget', () => {
  const current = Array.from({ length: 500 }, (_, n) => message(String(n), n));
  const output = mergeMessages(current, [message('new', 501), ...current.slice(450)]);
  assert.equal(output.length, 500);
  assert.equal(output[0]?.id, 'new');
  assert.equal(new Set(output.map((m) => m.id)).size, 500);
  assert.equal(output.at(-1)?.createdAt, 1);
});
