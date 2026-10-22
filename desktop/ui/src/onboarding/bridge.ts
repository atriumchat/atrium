import { MOCK_DOMAIN, MOCK_SETUP_CODE, MOCK_TOOK, TASKS } from '@atrium/setup';
import { t } from '../i18n';

/**
 * What the "Your own server" window asks of the main process (onboarding-preload.js → server-setup.js). Errors arrive
 * already in the app's words. Opened in a browser there's no bridge: `stand-in` answers with made-up ones.
 */

type Failure = { error: string; field?: 'host' };
export type InstallEvent =
  | { step: string; state: 'run' | 'done' | 'fail' | 'sub'; text?: string }
  | { state: 'out'; text: string; step?: undefined }
  | { state: 'fail'; why?: string; step?: undefined }
  | { state: 'ready'; url: string; step?: undefined }
  | { state: 'open'; step?: undefined };

export type Setup = {
  openExternal(url: string): void;
  connect(login: { host: string; user: string; password: string }): Promise<{ facts: { ip: string; os: string; size: string } } | Failure>;
  register(form: { name: string; email: string }): Promise<{ ok: true } | Failure>;
  waitMail(where: { ip: string }): Promise<{ ok: true } | Failure>;
  cancelMail(): void;
  savedAddress(): Promise<{ domain: string | null }>;
  useSaved(where: { ip: string }): Promise<{ ok: true; domain: string } | Failure>;
  checkDomain(input: { domain: string; turn: string; ip: string }): Promise<{ ok: true } | Failure>;
  install(options: { domain: string; turn: string }, onEvent: (event: InstallEvent) => void): Promise<unknown>;
  openServer(url: string): void;
};

const bridge = (window as unknown as { atriumSetup?: Setup }).atriumSetup;
/** Design work in a browser: the made-up answers, and #step=… opening a step (Onboarding). */
export const standIn = !bridge;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const hash = (word: string) => location.hash.includes(word);

// A browser has no bridge: answers at believable speeds. The password "wrong" fails, the name "taken" is taken, an
// address starting 10. doesn't answer; #slowmail (the letter never comes), #nosaved, #deaddesec.
const fake: Setup = {
  openExternal: (url) => void window.open(url, '_blank'),
  async connect({ host, password }) {
    await wait(1100);
    if (password === 'wrong') return { error: t('ssh.badLogin') };
    if (host.startsWith('10.')) return { error: t('ssh.noReply'), field: 'host' };
    return { facts: { ip: host, os: 'Ubuntu 24.04 LTS · x86_64', size: t('ssh.size', { memory: 2, disk: 18 }) } };
  },
  async register({ name }) {
    await wait(900);
    return name === 'taken' ? { error: t('desec.nameTaken') } : { ok: true };
  },
  waitMail: () => wait(hash('slowmail') ? 60000 : 6000).then(() => ({ ok: true as const })),
  cancelMail: () => undefined,
  savedAddress: async () => ({ domain: hash('nosaved') ? null : MOCK_DOMAIN }),
  async useSaved() {
    await wait(900);
    return hash('deaddesec') ? { error: t('desec.savedRejected') } : { ok: true, domain: MOCK_DOMAIN };
  },
  async checkDomain() {
    await wait(800);
    return { ok: true };
  },
  async install(_options, onEvent) {
    for (const step of TASKS) {
      onEvent({ step, state: 'run' });
      await wait(MOCK_TOOK[step] * 500);
      onEvent({ step, state: 'done' });
    }
    onEvent({ state: 'ready', url: `https://app.${MOCK_DOMAIN}/?setup=${MOCK_SETUP_CODE}` });
    // The new name reaches this computer a little later.
    await wait(5000);
    onEvent({ state: 'open' });
  },
  openServer: (url) => window.alert(`Next: ${url}, the server's wizard`),
};

export const setup: Setup = bridge ?? fake;
