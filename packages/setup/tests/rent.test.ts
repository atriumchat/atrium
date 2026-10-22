import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rentServer, rootKeyUserData, type Http, type HttpRequest } from '../src/index';

const KEY = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIJ0 atrium-app';
const base = 'https://os-api.hostvds.com/eu-north3';
const catalog = ['compute', 'image', 'network'].map((type) => ({ type, endpoints: [{ interface: 'public', region_id: 'eu-north3', url: `${base}/${type}` }] }));

/** A made-up HostVDS: `states` is what each new server goes through (one list per server made). */
function host(states: string[][], { login = true } = {}) {
  const calls: HttpRequest[] = [];
  let made = 0;
  const left: Record<string, string[]> = {};
  const http: Http = async (req) => {
    calls.push(req);
    const { method, url } = req;
    if (url.endsWith('/auth/tokens')) return login ? { status: 201, token: 'T', json: { token: { catalog } } } : { status: 401, json: { error: { message: 'bad' } } };
    if (url.endsWith('/flavors/detail')) return { status: 200, json: { flavors: [{ name: 'hostvds-1', id: 'f1' }, { name: 'hostvds-2', id: 'f2' }] } };
    if (url.includes('/v2/images')) return { status: 200, json: { images: [{ id: 'img' }] } };
    if (url.includes('/v2.0/networks')) return { status: 200, json: { networks: [{ name: 'Internet-02', id: 'n2' }, { name: 'Internet-01', id: 'n1' }, { name: 'Internet-IPv6-only', id: 'v6' }] } };
    if (url.endsWith('/os-keypairs') || url.includes('/os-keypairs/')) return { status: method === 'POST' ? 200 : 202, json: {} };
    if (url.endsWith('/servers') && method === 'POST') {
      const id = `s${made}`;
      left[id] = [...(states[made++] ?? ['ERROR'])];
      return { status: 202, json: { server: { id } } };
    }
    const id = url.split('/').pop()!;
    if (method === 'DELETE') return { status: 204, json: null };
    const status = left[id]!.length > 1 ? left[id]!.shift()! : left[id]![0]!;
    return { status: 200, json: { server: { status, addresses: status === 'ACTIVE' ? { 'Internet-01': [{ addr: '13.140.80.233', version: 4 }] } : {} } } };
  };
  return { http, calls };
}

test('the server comes up: its IP, plan 2, the key in, the key pair gone after', { timeout: 30000 }, async () => {
  const { http, calls } = host([['BUILD', 'ACTIVE']]);
  const stages: string[] = [];
  const got = await rentServer(http, { login: 'L', password: 'P', publicKey: KEY, onStage: (s) => stages.push(s) });
  assert.deepEqual(got, { ip: '13.140.80.233', id: 's0' });
  assert.deepEqual(stages, ['login', 'create', 'boot']);
  const create = calls.find((c) => c.url.endsWith('/servers') && c.method === 'POST')!.body as { server: Record<string, unknown> };
  assert.equal(create.server.flavorRef, 'f2');
  assert.deepEqual(create.server.networks, [{ uuid: 'n1' }]);
  assert.deepEqual(create.server.security_groups, [{ name: 'allow_all' }]);
  assert.ok(calls.at(-1)!.method === 'DELETE' && calls.at(-1)!.url.includes('/os-keypairs/'));
});

test('a network that fails the server: deleted, the next one tried', { timeout: 30000 }, async () => {
  const { http, calls } = host([['ERROR'], ['ACTIVE']]);
  const got = await rentServer(http, { login: 'L', password: 'P', publicKey: KEY });
  assert.equal('ip' in got && got.ip, '13.140.80.233');
  assert.ok(calls.some((c) => c.method === 'DELETE' && c.url.endsWith('/servers/s0')));
});

test('a wrong API login says so', async () => {
  const { http } = host([], { login: false });
  assert.deepEqual(await rentServer(http, { login: 'L', password: 'bad', publicKey: KEY }), { error: 'login' });
});

test("root's key goes in on first boot", () => {
  const data = rootKeyUserData(KEY);
  assert.match(data, /^#cloud-config/);
  assert.ok(data.includes(`echo '${KEY}' >> /root/.ssh/authorized_keys`));
});
