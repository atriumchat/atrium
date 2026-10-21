import * as SecureStore from 'expo-secure-store';
import { ssh } from '../../modules/gomex-ssh';
import { t } from '../i18n';

/**
 * "Your own server" on the phone, after desktop/server-setup.js: a fresh VPS becomes a Gomex server with no terminal.
 * - SSH in with the address and root password from the hosting company's e-mail; the password stays in memory for
 *   this screen. The installer adds the app's own key and switches password login off.
 * - The address: a free name on deSEC (name.dedyn.io), or the person's own domain, checked from the server.
 * - The installer runs detached on the server, its progress in a log the app reads back. iOS drops the connection
 *   when the app is in the background; the install goes on, and the app picks it up again when it's back.
 */

const DESEC = 'https://desec.io/api/v1';
// A test build can install a pre-release instead (.env.local: EXPO_PUBLIC_INSTALLER_URL=…/download/v0.6.1-rc.2/install.sh).
const INSTALLER_URL = process.env.EXPO_PUBLIC_INSTALLER_URL || 'https://github.com/gomex-inc/gomex/releases/latest/download/install.sh';
const LOG = '/root/gomex-app-install.log';
const SAVED = 'gomex.own';
export const NAME = /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$/;
export const DOMAIN = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const IPV4 = /^(?:\d{1,3}\.){3}\d{1,3}$/;
// The relay's neutral subdomain, as install.sh picks it (TURN_NAMES).
const TURN_NAMES = ['media', 'cdn', 'static', 'assets', 'files', 'img'];
export const pickTurn = () => TURN_NAMES[Math.floor(Math.random() * TURN_NAMES.length)] ?? 'media';

/** What the app keeps for the server being set up (and for one set up before), in the Keychain. */
export type Saved = {
  host: string;
  ip: string;
  user: string;
  turn: string;
  domain?: string;
  privateKey?: string;
  publicKey?: string;
  desec?: { email: string; password: string; name: string };
  /** The install was started at this time; its log on the server says how far it got. */
  started?: number;
  /** The server's cores and memory (GB), for how many people it takes (capacity.ts). */
  cores?: number;
  memory?: number;
  /** The setup link once the install is done (https://app.DOMAIN/?setup=CODE). */
  url?: string;
};

export const loadSaved = async (): Promise<Saved | null> => {
  try {
    const text = await SecureStore.getItemAsync(SAVED);
    return text ? (JSON.parse(text) as Saved) : null;
  } catch {
    return null;
  }
};
export const save = (saved: Saved) => SecureStore.setItemAsync(SAVED, JSON.stringify(saved)).catch(() => undefined);

/** Single quotes for sh, safe for anything. */
const sq = (value: string) => `'${String(value).replace(/'/g, `'\\''`)}'`;
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/* ---------- SSH ---------- */

let session: { id: string; host: string; user: string; password: string | null } | null = null;

function sshError(error: unknown): { error: string; field?: 'host' } {
  const code = error instanceof Error ? error.message : String(error);
  if (code.includes('auth')) return { error: t('own.ssh.badLogin') };
  if (code.includes('noHost')) return { error: t('own.ssh.noHost'), field: 'host' };
  if (code.includes('noReply')) return { error: t('own.ssh.noReply'), field: 'host' };
  return { error: t('own.ssh.cantConnect', { message: code.replace(/^other: /, '').slice(0, 120) }) };
}

/** Runs a command on the open session; one reconnect (key first, then the password) if the connection dropped. */
async function exec(command: string) {
  if (!session) throw new Error('noReply');
  try {
    return await ssh.exec(session.id, command);
  } catch {
    await reconnect();
    return ssh.exec(session!.id, command);
  }
}

async function reconnect() {
  if (!session) throw new Error('noReply');
  const { host, user, password } = session;
  const saved = await loadSaved();
  const key = saved?.host === host ? saved.privateKey : undefined;
  void ssh.close(session.id);
  let id: string | null = null;
  if (key) id = await ssh.connect(host, 22, user, null, key).catch(() => null);
  if (!id && password) id = await ssh.connect(host, 22, user, password, null);
  if (!id) throw new Error('auth');
  session = { id, host, user, password };
}

/** Back to a server whose install was started earlier (the app was closed): its key, or the password if asked again. */
export async function resume(saved: Saved, password: string | null = null) {
  close();
  let id: string | null = null;
  if (saved.privateKey) id = await ssh.connect(saved.host, 22, saved.user, null, saved.privateKey).catch(() => null);
  if (!id && password) {
    try {
      id = await ssh.connect(saved.host, 22, saved.user, password, null);
    } catch (error) {
      return sshError(error);
    }
  }
  if (!id) return { error: t('own.ssh.needPassword') };
  session = { id, host: saved.host, user: saved.user, password };
  return { ok: true as const };
}

export type Facts = { ip: string; os: string; size: string; cores: number; memory: number };

/** Logs in with the password and looks at the server: system, memory, disk, whether it's root, its public IP. */
export async function connect({ host, user, password }: { host: string; user: string; password: string }): Promise<{ facts: Facts } | { error: string; field?: 'host' }> {
  close();
  host = host.trim();
  user = user.trim() || 'root';
  let id: string;
  try {
    id = await ssh.connect(host, 22, user, password, null);
  } catch (error) {
    return sshError(error);
  }
  session = { id, host, user, password };
  const probe = [
    '. /etc/os-release 2>/dev/null; echo "OS=$PRETTY_NAME"',
    'echo "ARCH=$(uname -m)"',
    'echo "CPU=$(nproc)"',
    "echo \"MEM=$(awk '/^MemTotal:/ { print int($2 / 1024) }' /proc/meminfo)\"",
    "echo \"DISK=$(df -Pm / | awk 'NR == 2 { print $4 }')\"",
    'echo "UID=$(id -u)"',
    // The address friends will reach: the one typed if it's an IP, else the server's own view of it.
    IPV4.test(host) ? `echo IP=${host}` : 'echo "IP=$(curl -4fsS --max-time 8 https://api.ipify.org || hostname -I | cut -d" " -f1)"',
  ].join('; ');
  try {
    const { output } = await exec(probe);
    const facts = Object.fromEntries(output.split('\n').map((line) => line.split(/=(.*)/s).slice(0, 2)));
    if (facts.UID !== '0') {
      close();
      return { error: t('own.ssh.needRoot') };
    }
    const memory = Number(facts.MEM) / 1024;
    const disk = Number(facts.DISK) / 1024;
    return {
      facts: {
        ip: (facts.IP ?? '').trim(),
        os: [facts.OS, facts.ARCH].filter(Boolean).join(' · '),
        size: t('own.ssh.size', { memory: memory.toFixed(memory < 10 ? 1 : 0), disk: Math.round(disk) }),
        cores: Number(facts.CPU) || 1,
        memory,
      },
    };
  } catch (error) {
    close();
    return sshError(error);
  }
}

export function close() {
  if (session) void ssh.close(session.id);
  session = null;
}

/* ---------- names ---------- */

/** Google's DNS over HTTPS, asked from the server: its DNS answers, a phone's network may not. */
async function lookup(name: string, type: string) {
  const url = `https://dns.google/resolve?name=${encodeURIComponent(name)}&type=${type}`;
  const { code, output } = await exec(`curl -fsS --max-time 10 ${sq(url)}`);
  if (code !== 0) throw new Error('lookup failed');
  return JSON.parse(output) as { Status: number; Answer?: { type: number; data: string }[] };
}

async function api(path: string, { method = 'GET', body, token }: { method?: string; body?: unknown; token?: string } = {}) {
  const response = await fetch(`${DESEC}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Token ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // Not JSON: left as text.
  }
  return { status: response.status, json, text };
}

let desec: { email: string; password: string; name: string } | null = null;
let mailWait: { stop: boolean } | null = null;

/**
 * Makes the deSEC account with the name in it; deSEC mails the link. No captcha here: for a name under dedyn.io deSEC
 * refuses one at sign-up and asks for it on the page the link opens. Whether the name is free is deSEC's answer.
 */
export async function register({ name, email }: { name: string; email: string }): Promise<{ ok: true } | { error: string }> {
  name = name.trim().toLowerCase();
  if (!NAME.test(name)) return { error: t('own.desec.nameRule') };
  const password = ssh.randomToken(24);
  let answer;
  try {
    answer = await api('/auth/', { method: 'POST', body: { email: email.trim(), password, domain: `${name}.dedyn.io`, outreach_preference: false } });
  } catch {
    return { error: t('own.desec.down') };
  }
  if (answer.status === 202) {
    desec = { email: email.trim(), password, name };
    return { ok: true };
  }
  const json = answer.json ?? {};
  const said = (field: string) => [json[field]].flat(2).filter((x: unknown) => typeof x === 'string').join(' ');
  if (answer.status === 429) return { error: t('own.desec.tooOften') };
  if (json.email) return { error: t('own.desec.badEmail', { said: said('email') }) };
  if (json.domain && /conflicts with an existing domain|disallowed by policy/i.test(said('domain'))) return { error: t('own.desec.nameTaken') };
  if (json.domain) return { error: t('own.desec.badName', { said: said('domain') }) };
  if (json.code === 'registration_denied') return { error: t('own.desec.denied') };
  return { error: t('own.desec.other', { said: JSON.stringify(json).slice(0, 160) }) };
}

/** The name and everything under it (app., the relay) to the server; null when deSEC took it. */
async function pointAt(domain: string, token: string, ip: string): Promise<{ error: string } | null> {
  const records = [
    { subname: '', type: 'A', ttl: 3600, records: [ip] },
    { subname: '*', type: 'A', ttl: 3600, records: [ip] },
  ];
  let set;
  try {
    set = await api(`/domains/${domain}/rrsets/`, { method: 'PUT', body: records, token });
  } catch {
    return { error: t('own.desec.down') };
  }
  if (set.status === 200) return null;
  if (set.status === 404) return { error: t('own.desec.gone') };
  if (set.status === 401 || set.status === 403) return { error: t('own.desec.noAccess') };
  if (set.status === 429) return { error: t('own.desec.tooOften') };
  return { error: t('own.desec.notAccepted', { status: set.status }) };
}

/** Waits for the link in deSEC's letter to be pressed (logging in only works after it), then points the name here. */
export async function waitMail(ip: string): Promise<{ ok: true; domain: string; account: { email: string; password: string; name: string } } | { error: string }> {
  if (!desec) return { error: t('own.desec.startOver') };
  mailWait = { stop: false };
  const me = mailWait;
  const deadline = Date.now() + 12 * 60 * 60 * 1000;
  let token: string | null = null;
  while (!me.stop && Date.now() < deadline) {
    try {
      const login = await api('/auth/login/', { method: 'POST', body: { email: desec.email, password: desec.password } });
      if (login.status === 200) {
        token = login.json.token;
        break;
      }
    } catch {
      // Offline for a moment: try again.
    }
    await wait(5000);
  }
  if (!token) return { error: me.stop ? t('own.desec.cancelled') : t('own.desec.linkExpired') };
  const domain = `${desec.name}.dedyn.io`;
  for (let i = 0; i < 12; i++) {
    if ((await api(`/domains/${domain}/`, { token })).status === 200) break;
    await wait(2500);
  }
  const failed = await pointAt(domain, token, ip);
  if (failed) return failed;
  return { ok: true, domain, account: desec };
}

export function cancelMail() {
  if (mailWait) mailWait.stop = true;
}

/** An account this phone made for an earlier server (deSEC gives one name per account): its name, pointed here. */
export async function reuse(account: { email: string; password: string; name: string }, ip: string): Promise<{ ok: true; domain: string } | { error: string }> {
  let login;
  try {
    login = await api('/auth/login/', { method: 'POST', body: { email: account.email, password: account.password } });
  } catch {
    return { error: t('own.desec.down') };
  }
  if (login.status !== 200) {
    if (login.status === 429) return { error: t('own.desec.tooOften') };
    const said = typeof login.json?.detail === 'string' ? login.json.detail : login.text.slice(0, 160);
    // deSEC answers a wrong password with 403 "Invalid username/password".
    if (login.status === 400 || login.status === 401 || /invalid username\/password/i.test(said)) return { error: t('own.desec.savedRejected') };
    // Any other refusal in deSEC's own words (a locked account): the person can act on it.
    if (login.status === 403) return { error: t('own.desec.accountDenied', { said }) };
    return { error: t('own.desec.other', { said: `${login.status} ${said}` }) };
  }
  const domain = `${account.name}.dedyn.io`;
  const failed = await pointAt(domain, login.json.token, ip);
  return failed ?? { ok: true, domain };
}

/** A domain of one's own: its three names must already point at the server. */
export async function checkDomain(domain: string, turn: string, ip: string): Promise<{ ok: true } | { error: string }> {
  domain = domain.trim().toLowerCase();
  if (!DOMAIN.test(domain)) return { error: t('own.dns.notDomain') };
  const missing: string[] = [];
  for (const name of [domain, `app.${domain}`, `${turn}.${domain}`]) {
    try {
      const answer = await lookup(name, 'A');
      if (!(answer.Answer ?? []).some((record) => record.type === 1 && record.data === ip)) missing.push(name);
    } catch {
      missing.push(name);
    }
  }
  return missing.length ? { error: t('own.dns.missing', { names: missing.join(', ') }) } : { ok: true };
}

/* ---------- the install ---------- */

/**
 * Fetches the installer and starts it detached (setsid, its output into LOG), so it runs on when the phone sleeps.
 * The app's key goes in first: the installer adds it for root and switches password login off.
 */
export async function startInstall(saved: Saved): Promise<{ ok: true } | { error: string }> {
  if (!session || !saved.domain) return { error: t('own.install.noSession') };
  let { privateKey, publicKey } = saved;
  if (!privateKey || !publicKey) ({ privateKey, publicKey } = ssh.generateKey());
  const next: Saved = { ...saved, privateKey, publicKey, started: Date.now(), url: undefined };
  await save(next);
  try {
    const fetched = await exec(`curl -fsSL --retry 3 ${sq(INSTALLER_URL)} -o /root/gomex-install.sh`);
    if (fetched.code !== 0) return { error: t('own.install.noInstaller') };
    const env = ['GOMEX_YES=1', 'GOMEX_PROGRESS=1', 'NO_COLOR=1', `DOMAIN=${sq(saved.domain)}`, `TURN_HOST=${sq(saved.turn)}`, `GOMEX_AUTHORIZED_KEY=${sq(publicKey)}`].join(' ');
    const job = `${env} sh /root/gomex-install.sh > ${LOG} 2>&1; echo "::exit $?" >> ${LOG}`;
    const started = await exec(`rm -f ${LOG}; nohup setsid sh -c ${sq(job)} > /dev/null 2>&1 < /dev/null & echo started`);
    if (started.code !== 0) return { error: t('own.install.noInstaller') };
    return { ok: true };
  } catch (error) {
    return sshError(error);
  }
}

export type StepState = { state: 'run' | 'done' | 'fail'; took?: number; why?: string };
export type Progress = {
  steps: Record<string, StepState>;
  /** The step running now, and what it's doing (::gomex sub), or the installer's last plain line. */
  current: string | null;
  doing: string;
  ready: string | null;
  /** The installer's exit code once it has ended. */
  exit: number | null;
  failed: string | null;
};

/** Reads the install's log on the server and makes the progress out of its "::gomex" lines. */
export async function readProgress(): Promise<Progress> {
  const { output } = await exec(`grep -a -E '^::(gomex|exit) ' ${LOG} 2>/dev/null; echo '::tail'; tail -c 800 ${LOG} 2>/dev/null | tr '\\r' '\\n' | grep -v '^::' | tail -n 4`);
  const [marks = '', tail = ''] = output.split('::tail\n');
  const progress: Progress = { steps: {}, current: null, doing: '', ready: null, exit: null, failed: null };
  for (const line of marks.split('\n')) {
    const exit = line.match(/^::exit (\d+)/);
    if (exit) {
      progress.exit = Number(exit[1]);
      continue;
    }
    const sub = line.match(/^::gomex sub (.+)$/);
    if (sub) {
      progress.doing = (sub[1] ?? '').slice(0, 120);
      continue;
    }
    const m = line.match(/^::gomex (run|done|fail|ready) ?(\S*) ?(.*)$/);
    if (!m) continue;
    const [, state = '', step = '', rest = ''] = m;
    if (state === 'ready') {
      progress.ready = step;
      continue;
    }
    if (state === 'run') {
      progress.current = step;
      progress.doing = '';
    }
    if (state === 'fail') progress.failed = rest || step;
    progress.steps[step] = { state: state as StepState['state'], ...(state === 'done' && rest ? { took: Number(rest) } : {}), ...(state === 'fail' ? { why: rest } : {}) };
  }
  if (!progress.doing) {
    const last = tail
      .split('\n')
      .map((line) => line.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '').trim())
      .filter((line) => line && !/^[…✓✗!•]/.test(line))
      .pop();
    progress.doing = last?.slice(0, 120) ?? '';
  }
  return progress;
}
