import { t } from '../i18n';
import { color } from '../theme';
import type { MyInvite, Session } from '../protocol';
import type { Backend } from './backend';
import { MOCK_DOMAIN, MOCK_INVITE, MOCK_KEY, mockProgress, type Progress } from '@gomex/setup';

/**
 * "Your own server" with nothing real behind it, for design work in development: /own?mock=1 walks the whole way with
 * made-up answers at believable speeds, /own?mock=1&step=install (or any step) opens there, &fast=1 hurries the install. No SSH, no deSEC, no
 * server; nothing is kept. The password "wrong" fails to connect, the name "taken" is taken.
 */

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const fail = (error: string) => ({ error });

let name = 'podval';
let domain = MOCK_DOMAIN;
let started = 0;
let readyAt = 0;
let mail: { stop: boolean } | null = null;
let pace = 1; // &fast=1 runs the install twice as quick, to see the end of it during a run of the game

export function mockPace(times: number) {
  pace = times;
}

/** Puts the made-up install where a step opened directly needs it: just started, or done a while ago. */
export function mockInstall(at: 'start' | 'done', name = domain) {
  domain = name;
  started = at === 'start' ? Date.now() : Date.now() - 60_000;
  readyAt = at === 'done' ? Date.now() : 0; // just done: the address takes a few more seconds
}

export const mock: Backend = {
  loadSaved: async () => null,
  save: async () => undefined,
  connect: async ({ host, password }) => {
    await wait(1400);
    if (password === 'wrong') return fail(t('own.ssh.badLogin'));
    return { facts: { ip: host.trim() || '203.0.113.10', os: 'Ubuntu 24.04 LTS · x86_64', root: true, cores: 1, memory: 1.9, disk: 17 }, hostKey: 'ssh-ed25519 MOCK' };
  },
  resume: async () => {
    await wait(800);
    return { ok: true as const };
  },
  close: () => undefined,
  register: async (input) => {
    await wait(900);
    if (input.name === 'taken') return fail(t('own.desec.nameTaken'));
    name = input.name.trim().toLowerCase();
    return { ok: true as const };
  },
  waitMail: async () => {
    mail = { stop: false };
    const me = mail;
    await wait(6000);
    if (me.stop) return fail(t('own.desec.cancelled'));
    domain = `${name}.dedyn.io`;
    return { ok: true as const, domain, account: { email: 'me@example.com', password: 'mock', name } };
  },
  cancelMail: () => {
    if (mail) mail.stop = true;
  },
  reuse: async (account) => {
    await wait(800);
    domain = `${account.name}.dedyn.io`;
    return { ok: true as const, domain };
  },
  checkDomain: async (input) => {
    await wait(1200);
    domain = input.trim().toLowerCase();
    return { ok: true as const };
  },
  startInstall: async (saved) => {
    await wait(700);
    mockInstall('start', saved.domain ?? domain);
    return { ok: true as const };
  },
  readProgress: async (): Promise<Progress> => {
    const progress = mockProgress(((Date.now() - started) / 1000) * pace, domain);
    if (progress.ready && !readyAt) readyAt = Date.now();
    return progress;
  },
  // The address spreads for a few seconds after the install.
  reachable: async () => !!readyAt && Date.now() - readyAt > 5000,
  setupStatus: async () => ({ needed: true, serverName: 'Gomex' }),
  setup: async (_server, _code, _serverName, nick) => {
    await wait(1100);
    return { token: 'mock', user: { id: 'mock', name: nick, color: color.here } } as unknown as Session;
  },
  renameServer: async () => wait(300),
  uploadServerIcon: async () => wait(600),
  makeRecoveryKey: async () => ({ key: MOCK_KEY }),
  invite: async () => ({ code: MOCK_INVITE }) as MyInvite,
  enter: async () => undefined,
};
