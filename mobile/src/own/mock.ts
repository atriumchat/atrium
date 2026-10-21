import { t } from '../i18n';
import type { MyInvite, Session } from '../protocol';
import type { Backend } from './backend';
import { TASKS } from './Drum';
import type { Progress, StepState } from './setup';

/**
 * "Your own server" with nothing real behind it, for design work in development: /own?mock=1 walks the whole way with
 * made-up answers at believable speeds, /own?mock=1&step=install (or any step) opens there, &fast=1 hurries the install. No SSH, no deSEC, no
 * server; nothing is kept. The password "wrong" fails to connect, the name "taken" is taken.
 */

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const fail = (error: string) => ({ error });

// How long each installer step takes here, in seconds: the address waits longest, as it does for real.
const TOOK: Record<string, number> = { check: 2, address: 7, docker: 4, firewall: 1.5, ssh: 1, files: 1, config: 1, backups: 1.5, pull: 5, up: 3, https: 3 };

let name = 'podval';
let domain = 'podval.dedyn.io';
let started = 0;
let readyAt = 0;
let mail: { stop: boolean } | null = null;
let pace = 1; // &fast=1 runs the install twice as quick, to see the end of it during a run of the game

export function mockPace(times: number) {
  pace = times;
}

export const MOCK_KEY = 'K7QM-2XPA-9DHR-T4WC-8NBE-3VLY';

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
    return { facts: { ip: host.trim() || '203.0.113.10', os: 'Ubuntu 24.04 LTS · x86_64', size: t('own.ssh.size', { memory: '1.9', disk: 17 }), cores: 1, memory: 1.9 } };
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
    let left = ((Date.now() - started) / 1000) * pace;
    const steps: Record<string, StepState> = {};
    let current: string | null = null;
    for (const id of TASKS) {
      const took = TOOK[id] ?? 2;
      if (left >= took) {
        steps[id] = { state: 'done', took };
        left -= took;
      } else {
        steps[id] = { state: 'run' };
        current = id;
        break;
      }
    }
    const ready = current ? null : `https://app.${domain}/?setup=MOCKCODE01`;
    if (ready && !readyAt) readyAt = Date.now();
    return { steps, current, doing: '', ready, exit: ready ? 0 : null, failed: null };
  },
  // The address spreads for a few seconds after the install.
  reachable: async () => !!readyAt && Date.now() - readyAt > 5000,
  setupStatus: async () => ({ needed: true, serverName: 'Gomex' }),
  setup: async (_server, _code, _serverName, nick) => {
    await wait(1100);
    return { token: 'mock', user: { id: 'mock', name: nick, color: '#5865f2' } } as unknown as Session;
  },
  renameServer: async () => wait(300),
  uploadServerIcon: async () => wait(600),
  makeRecoveryKey: async () => ({ key: MOCK_KEY }),
  invite: async () => ({ code: '7F3K9QAB' }) as MyInvite,
  enter: async () => undefined,
};
