import * as SecureStore from 'expo-secure-store';
import { ssh } from '../../modules/gomex-ssh';
import {
  DESEC,
  DOMAIN,
  INSTALLER_URL,
  NAME,
  fetchCommand,
  loginError,
  parseProbe,
  parseProgress,
  pointError,
  pointRecords,
  probeCommand,
  progressCommand,
  registerBody,
  registerError,
  sq,
  startCommand,
  type DesecError,
  type Facts,
  type Progress,
} from '@gomex/setup';
import { t, type Key } from '../i18n';

/**
 * "Your own server" on the phone, after desktop/server-setup.js: a fresh VPS becomes a Gomex server with no terminal.
 * - SSH in with the address and root password from the hosting company's e-mail; the password stays in memory for
 *   this screen. The installer adds the app's own key and switches password login off.
 * - The address: a free name on deSEC (name.dedyn.io), or the person's own domain, checked from the server.
 * - The installer runs detached on the server, its progress in a log the app reads back. iOS drops the connection
 *   when the app is in the background; the install goes on, and the app picks it up again when it's back.
 */

// A test build can install a pre-release instead (.env.local: EXPO_PUBLIC_INSTALLER_URL=…/download/v0.6.1-rc.2/install.sh).
const INSTALLER = process.env.EXPO_PUBLIC_INSTALLER_URL || INSTALLER_URL;
const SAVED = 'gomex.own';

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

export type { Facts };

/** Logs in with the password and looks at the server (probeCommand): it has to be root. */
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
  try {
    const facts = parseProbe((await exec(probeCommand(host))).output);
    if (!facts.root) {
      close();
      return { error: t('own.ssh.needRoot') };
    }
    return { facts };
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

/** A deSEC answer in the app's words. */
const said = (error: DesecError) => ({ error: t(`own.desec.${error.code}` as Key, error as Record<string, string | number>) });

let desec: { email: string; password: string; name: string } | null = null;
let mailWait: { stop: boolean } | null = null;

/**
 * Makes the deSEC account with the name in it; deSEC mails the link. No captcha here: for a name under dedyn.io deSEC
 * refuses one at sign-up and asks for it on the page the link opens. Whether the name is free is deSEC's answer.
 */
export async function register({ name, email }: { name: string; email: string }): Promise<{ ok: true } | { error: string }> {
  name = name.trim().toLowerCase();
  if (!NAME.test(name)) return said({ code: 'nameRule' });
  const password = ssh.randomToken(24);
  let answer;
  try {
    answer = await api('/auth/', { method: 'POST', body: registerBody({ name, email, password }) });
  } catch {
    return said({ code: 'down' });
  }
  if (answer.status !== 202) return said(registerError(answer));
  desec = { email: email.trim(), password, name };
  return { ok: true };
}

/** The name and everything under it (app., the relay) to the server; null when deSEC took it. */
async function pointAt(domain: string, token: string, ip: string): Promise<{ error: string } | null> {
  try {
    const failed = pointError(await api(`/domains/${domain}/rrsets/`, { method: 'PUT', body: pointRecords(ip), token }));
    return failed && said(failed);
  } catch {
    return said({ code: 'down' });
  }
}

/** Waits for the link in deSEC's letter to be pressed (logging in only works after it), then points the name here. */
export async function waitMail(ip: string): Promise<{ ok: true; domain: string; account: { email: string; password: string; name: string } } | { error: string }> {
  if (!desec) return said({ code: 'startOver' });
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
  if (!token) return said({ code: me.stop ? 'cancelled' : 'linkExpired' });
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
    return said({ code: 'down' });
  }
  if (login.status !== 200) return said(loginError(login));
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
    const fetched = await exec(fetchCommand(INSTALLER));
    if (fetched.code !== 0) return { error: t('own.install.noInstaller') };
    const started = await exec(startCommand({ domain: saved.domain, turn: saved.turn, publicKey }));
    if (started.code !== 0) return { error: t('own.install.noInstaller') };
    return { ok: true };
  } catch (error) {
    return sshError(error);
  }
}

export type { Progress };

/** Reads the install's log on the server (its "::gomex" lines). */
export async function readProgress(): Promise<Progress> {
  return parseProgress((await exec(progressCommand())).output);
}
