import { MOCK_DOMAIN, MOCK_SETUP_CODE, MOCK_TOOK, RENT, TASKS, type Http } from '@atrium/setup';
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
  /** "No server?": the app's new key (an OpenSSH public line), then into the rented server with it. */
  appKey(): Promise<string>;
  connectKey(host: string): Promise<{ facts: { ip: string; os: string; size: string } } | Failure>;
  /** HostVDS's API, through the main process (rentServer drives it). */
  hostvds: Http;
  /** The globe: the app's language (as the tray's menu does); `onLanguage` hears it, from here or the tray. */
  language(choice: 'ru' | 'en'): Promise<void>;
  onLanguage(callback: (lang: 'ru' | 'en') => void): void;
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
const languageListeners: ((lang: 'ru' | 'en') => void)[] = [];
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
  appKey: async () => 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIStandIn atrium-app',
  language: async (choice) => {
    for (const listen of languageListeners) listen(choice);
  },
  onLanguage: (callback) => void languageListeners.push(callback),
  async connectKey(host) {
    await wait(1500);
    return { facts: { ip: host, os: 'Ubuntu 24.04 LTS · x86_64', size: t('ssh.size', { memory: 2, disk: 20 }) } };
  },
  // A made-up HostVDS: the API password "wrong" is refused, anything else gets a server that's up on the second look.
  hostvds: (() => {
    let looks = 0;
    const base = `${RENT.api}/${RENT.region}`;
    return async ({ method, url, body }) => {
      await wait(400);
      if (url.endsWith('/auth/tokens')) {
        const password = (body as { auth: { identity: { password: { user: { password: string } } } } }).auth.identity.password.user.password;
        if (password === 'wrong') return { status: 401, json: {} };
        const catalog = ['compute', 'image', 'network'].map((type) => ({ type, endpoints: [{ interface: 'public', region_id: RENT.region, url: `${base}/${type}` }] }));
        return { status: 201, token: 'T', json: { token: { catalog } } };
      }
      if (url.endsWith('/flavors/detail')) return { status: 200, json: { flavors: [{ name: RENT.flavor, id: 'f' }] } };
      if (url.includes('/v2/images')) return { status: 200, json: { images: [{ id: 'i' }] } };
      if (url.includes('/v2.0/networks')) return { status: 200, json: { networks: [{ name: 'Internet-01', id: 'n' }] } };
      if (url.endsWith('/servers') && method === 'POST') return { status: 202, json: { server: { id: 's' } } };
      if (url.endsWith('/servers/s') && method === 'GET') {
        const up = ++looks > 1;
        return { status: 200, json: { server: { status: up ? 'ACTIVE' : 'BUILD', addresses: up ? { 'Internet-01': [{ addr: '203.0.113.24' }] } : {} } } };
      }
      return { status: 202, json: {} };
    };
  })(),
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
