// Exercise the native client's wire protocol against an isolated copy of the real backend.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { io } from 'socket.io-client';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const directory = await mkdtemp(resolve(tmpdir(), 'gomex-mobile-contract-'));
const reservation = createServer();
reservation.listen(0, '127.0.0.1');
await once(reservation, 'listening');
const port = reservation.address().port;
await new Promise((done) => reservation.close(done));
const origin = `http://127.0.0.1:${port}`;
const service = spawn(resolve(root, 'server/.venv/bin/python'), ['-m', 'uvicorn', 'app:app', '--host', '127.0.0.1', '--port', String(port)], {
  cwd: resolve(root, 'server'),
  env: { ...process.env, DATA_DIR: directory, WEB_DIST: '', APP_SECRET: 'mobile-contract-test-only-secret', INVITE_CODE: 'mobile-contract-only' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let output = '';
service.stdout.on('data', (chunk) => { output += chunk; });
service.stderr.on('data', (chunk) => { output += chunk; });
let spawnError;
service.on('error', (error) => { spawnError = error; });
const sockets = [];
let mediaCookie;
async function request(path, body, token, method = body ? 'POST' : 'GET') {
  const result = await fetch(origin + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(5000) });
  assert.equal(result.status, 200, `${path}: ${await result.clone().text()}`);
  const cookie = result.headers.get('set-cookie')?.match(/(?:^|,\s*)gx_media=([^;,\s]+)/)?.[1];
  if (cookie) mediaCookie = `gx_media=${cookie}`;
  return result.json();
}
async function connect(token) {
  const socket = io(origin, { transports: ['websocket'], auth: { token }, reconnection: false, timeout: 5000 });
  sockets.push(socket);
  await Promise.race([once(socket, 'connect'), once(socket, 'connect_error').then(([error]) => { throw error; })]);
  return socket;
}
async function ask(socket, event, data) {
  const result = await socket.timeout(5000).emitWithAck(event, data);
  assert.equal(result.ok, true, JSON.stringify(result));
  return result;
}
try {
  let up = false;
  for (let i = 0; i < 80; i++) {
    if (spawnError) throw spawnError;
    try { await request('/api/setup'); up = true; break; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
  assert.ok(up, `Backend did not start: ${output}`);
  const password = 'mobile-contract-password';
  const admin = await request('/api/setup', { code: 'mobile-contract-only', serverName: 'Mobile contract', name: 'MobileAdmin', password });
  const invite = await request('/api/invite', undefined, admin.token);
  const member = await request('/api/register', { invite: invite.code, name: 'MobileAlice', password });
  assert.ok(member.recoveryKey);
  const login = await request('/api/login', { name: 'MobileAlice', password });
  const bootstrap = await request('/api/bootstrap', undefined, login.token);
  assert.equal(bootstrap.me.id, member.user.id);
  const channel = bootstrap.channels.find((c) => c.kind === 'text');
  const voice = bootstrap.channels.find((c) => c.kind === 'voice');
  const alice = await connect(login.token);
  const owner = await connect(admin.token);
  const broadcast = once(owner, 'message:new');
  const sent = await ask(alice, 'message:send', { channelId: channel.id, content: 'Native client message', attachments: [] });
  assert.equal((await broadcast)[0].id, sent.message.id);
  const page = await request(`/api/channels/${channel.id}/messages`, undefined, login.token);
  assert.equal(page.at(-1).id, sent.message.id);
  assert.deepEqual(await request(`/api/channels/${channel.id}/messages?before=${sent.message.createdAt}&beforeId=${sent.message.id}`, undefined, login.token), []);
  await ask(alice, 'reaction:toggle', { messageId: sent.message.id, emoji: '👍' });
  const readState = once(alice, 'read:state');
  await ask(alice, 'read', { conversationId: channel.id, at: sent.message.createdAt });
  assert.equal((await readState)[0].conversationId, channel.id);
  const dm = await request('/api/dms', { userId: admin.user.id }, login.token);
  const privateMessage = await ask(alice, 'dm:send', { dmId: dm.id, content: 'Private message', attachments: [] });
  assert.equal((await request(`/api/dms/${dm.id}/messages`, undefined, login.token))[0].id, privateMessage.message.id);
  const grant = await request('/api/voice-token', { channelId: voice.id }, login.token);
  assert.ok(grant.token && grant.url);
  const payload = Buffer.from(grant.token.split('.')[1], 'base64url').toString();
  assert.equal(JSON.parse(payload).video.room, `voice-${voice.id}`);
  // Forward the separate media cookie, as expo-image and file downloads do.
  const uploaded = await fetch(origin + '/api/uploads?name=mobile.txt', { method: 'POST', headers: { Authorization: `Bearer ${login.token}`, 'Content-Type': 'text/plain' }, body: 'native attachment' });
  assert.equal(uploaded.status, 200, await uploaded.clone().text());
  const upload = await uploaded.json();
  const media = await fetch(origin + upload.url, { headers: { Cookie: mediaCookie } });
  assert.equal(await media.text(), 'native attachment');
  assert.equal((await fetch(origin + upload.url)).status, 401);
  await request('/api/logout-all', {}, login.token);
  assert.equal((await fetch(origin + '/api/bootstrap', { headers: { Authorization: `Bearer ${login.token}` } })).status, 401);
  console.log('PASS: login, bootstrap, native WebSocket, message ACK/broadcast, cursor history, reactions, read marks, DMs, voice-token claims, private media, logout.');
} finally {
  for (const socket of sockets) socket.disconnect();
  if (service.exitCode === null) { service.kill('SIGTERM'); await Promise.race([once(service, 'exit'), new Promise((r) => setTimeout(r, 5000))]); }
  await rm(directory, { recursive: true, force: true });
}
