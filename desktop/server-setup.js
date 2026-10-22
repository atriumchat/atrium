// "Your own server": a fresh VPS becomes an Atrium server from the app (desktop/ui's onboarding page), with no terminal.
//   - SSH in with the address and root password from the hosting company's e-mail; the password is only kept in
//     memory for this window. The installer then switches password login off, and the app keeps its own key.
//   - The address: a free name on deSEC (name.dedyn.io), registered and pointed here through deSEC's API, or the
//     person's own domain, checked at its own name servers.
//   - The installer (install.sh, ATRIUM_PROGRESS=1) with its progress read back line by line.
// Main process only; the window reaches it through onboarding-preload.js and main.js.
const { Client, utils } = require('ssh2');
const crypto = require('node:crypto');
const dns = require('node:dns');
const fs = require('node:fs');
const { t } = require('./i18n');

const DESEC = 'https://desec.io/api/v1';
const INSTALLER_URL = 'https://github.com/atriumchat/atrium/releases/latest/download/install.sh';
const NAME = /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$/;
const DOMAIN = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const TURN = /^[a-z0-9-]{1,20}$/;

// One setup at a time: the open SSH session and the deSEC account being made.
let ssh = null; // { conn, host, ip, user, hostKey, facts }
let desec = null; // { email, password, name }
let mailWait = null; // { stop: boolean }

/** Single quotes for sh, safe for anything. */
const sq = (value) => `'${String(value).replace(/'/g, `'\\''`)}'`;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* ---------- SSH ---------- */

function sshError(error) {
  if (error?.level === 'client-authentication') return { error: t('ssh.badLogin') };
  if (['ENOTFOUND', 'EAI_AGAIN'].includes(error?.code)) return { error: t('ssh.noHost'), field: 'host' };
  if (['ECONNREFUSED', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH'].includes(error?.code) || /timed out/i.test(error?.message ?? '')) {
    return { error: t('ssh.noReply'), field: 'host' };
  }
  return { error: t('ssh.cantConnect', { message: error?.message ?? error }) };
}

/** Runs a command; streams its output lines to `onLine` and resolves with the exit code and the output's tail. */
function exec(conn, command, { onLine, stdin } = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      conn.removeListener('error', lost);
      conn.removeListener('close', closed);
      conn.removeListener('end', closed);
      if (error) reject(error);
      else resolve(result);
    };
    const lost = (error) => finish(error);
    const closed = () => finish(new Error(t('ssh.noReply')));
    conn.on('error', lost);
    conn.on('close', closed);
    conn.on('end', closed);
    conn.exec(command, (error, stream) => {
      if (error) return finish(error);
      if (settled) return stream.close();
      const tail = [];
      let buffer = '';
      const take = (chunk) => {
        buffer += chunk.toString('utf8');
        let at;
        while ((at = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, at).replace(/\r$/, '');
          buffer = buffer.slice(at + 1);
          tail.push(line);
          if (tail.length > 40) tail.shift();
          onLine?.(line);
        }
      };
      stream.on('data', take);
      stream.stderr.on('data', take);
      stream.on('error', lost);
      stream.on('close', (code) => {
        if (buffer) take('\n');
        if (!Number.isInteger(code)) finish(new Error(t('ssh.noReply')));
        else finish(null, { code, tail });
      });
      if (stdin !== undefined) stream.end(stdin);
    });
  });
}

/** Logs in with the password and looks at the server: system, memory, disk, whether it's root. */
async function connect({ host, user, password }) {
  close();
  host = String(host).trim();
  user = String(user || 'root').trim();
  let address;
  try {
    address = (await dns.promises.lookup(host, { family: 4 })).address;
  } catch (error) {
    return sshError(error);
  }
  const conn = new Client();
  let hostKey = null;
  try {
    const ready = await new Promise((resolve) => {
      conn.on('ready', () => resolve(null));
      conn.on('error', (error) => resolve(sshError(error)));
      conn.on('close', () => resolve(sshError(new Error(t('ssh.noReply')))));
      conn.on('end', () => resolve(sshError(new Error(t('ssh.noReply')))));
      conn.on('keyboard-interactive', (_name, _text, _lang, prompts, finish) => finish(prompts.map(() => password)));
      conn.connect({
        host: address,
        port: 22,
        username: user,
        password,
        tryKeyboard: true,
        readyTimeout: 20000,
        keepaliveInterval: 15000,
        hostVerifier: (key) => {
          hostKey = crypto.createHash('sha256').update(key).digest('base64');
          return true;
        },
      });
    });
    if (ready) {
      conn.end();
      return ready;
    }
    const probe = [
      '. /etc/os-release 2>/dev/null; echo "OS=$PRETTY_NAME"',
      'echo "ARCH=$(uname -m)"',
      "echo \"MEM=$(awk '/^MemTotal:/ { print int($2 / 1024) }' /proc/meminfo)\"",
      "echo \"DISK=$(df -Pm / | awk 'NR == 2 { print $4 }')\"",
      'echo "UID=$(id -u)"',
    ].join('; ');
    const { tail } = await exec(conn, probe);
    const facts = Object.fromEntries(tail.map((line) => line.split(/=(.*)/s).slice(0, 2)));
    if (facts.UID !== '0') {
      conn.end();
      return { error: t('ssh.needRoot') };
    }
    const memory = Number(facts.MEM) / 1024;
    const disk = Number(facts.DISK) / 1024;
    ssh = { conn, host, ip: address, user, hostKey };
    return {
      facts: {
        ip: address,
        os: [facts.OS, facts.ARCH].filter(Boolean).join(' · '),
        size: t('ssh.size', { memory: memory.toFixed(memory < 10 ? 1 : 0), disk: Math.round(disk) }),
      },
    };
  } catch (error) {
    conn.end();
    return sshError(error);
  }
}

function close() {
  ssh?.conn.end();
  ssh = null;
}

/* ---------- names ---------- */

// Names are looked up from the server, not from this computer: the server is abroad and its DNS answers, while a
// home connection here may block or slow DNS (Cloudflare's servers, for one).

/** Google's DNS over HTTPS, asked from the server: { Status, Answer } (Status 3 is "no such name"). */
async function lookup(name, type) {
  if (!ssh) throw new Error('no session');
  const url = `https://dns.google/resolve?name=${encodeURIComponent(name)}&type=${type}`;
  const { code, tail } = await exec(ssh.conn, `curl -fsS --max-time 10 ${sq(url)}`);
  if (code !== 0) throw new Error('lookup failed');
  return JSON.parse(tail.join('\n'));
}

async function api(path, { method = 'GET', body, token } = {}) {
  const response = await fetch(`${DESEC}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Token ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // Not JSON: left as text.
  }
  return { status: response.status, json, text };
}

/**
 * Makes the deSEC account with the name in it. The password is the app's own; deSEC mails the link. No captcha
 * here: for a name under dedyn.io deSEC refuses one at sign-up and asks for it on the page the link opens.
 * Whether the name is free is deSEC's answer to this very request: asking the DNS beforehand made Google remember
 * "no such name" and the installer's own lookups then waited it out.
 */
async function register({ name, email }) {
  name = String(name).toLowerCase();
  if (!NAME.test(name)) return { error: t('desec.nameRule') };
  const password = crypto.randomBytes(24).toString('base64url');
  let answer;
  try {
    answer = await api('/auth/', {
      method: 'POST',
      body: {
        email: String(email).trim(),
        password,
        domain: `${name}.dedyn.io`,
        outreach_preference: false,
      },
    });
  } catch {
    return { error: t('desec.down') };
  }
  if (answer.status === 202) {
    desec = { email: String(email).trim(), password, name };
    return { ok: true };
  }
  const json = answer.json ?? {};
  // deSEC's own words for the field it refused ({"domain": ["…"]}), so the person sees the real reason.
  const said = (field) => [json[field]].flat(2).filter((x) => typeof x === 'string').join(' ');
  console.log('deSEC sign-up refused:', answer.status, answer.text.slice(0, 400));
  if (answer.status === 429) return { error: t('desec.tooOften') };
  if (json.email) return { error: t('desec.badEmail', { said: said('email') }) };
  // 400 {"domain": ["This domain name conflicts with an existing domain, or is disallowed by policy."]}
  if (json.domain && /conflicts with an existing domain|disallowed by policy/i.test(said('domain'))) {
    return { error: t('desec.nameTaken') };
  }
  if (json.domain) return { error: t('desec.badName', { said: said('domain') }) };
  if (json.code === 'registration_denied') return { error: t('desec.denied') };
  return { error: t('desec.other', { said: JSON.stringify(json).slice(0, 160) }) };
}

/**
 * Waits for the link in deSEC's letter to be pressed (logging in only works after it), then points the name and
 * everything under it (app., the relay) at the server.
 */
async function waitMail({ ip }) {
  if (!desec) return { error: t('desec.startOver') };
  mailWait = { stop: false };
  const me = mailWait;
  const deadline = Date.now() + 12 * 60 * 60 * 1000;
  let token = null;
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
  if (!token) return { error: me.stop ? t('desec.cancelled') : t('desec.linkExpired') };
  const domain = `${desec.name}.dedyn.io`;
  // The domain appears with the activation; give it a moment if the login was quicker.
  for (let i = 0; i < 12; i++) {
    if ((await api(`/domains/${domain}/`, { token })).status === 200) break;
    await wait(2500);
  }
  const failed = await pointAt({ domain, token, ip });
  if (failed) return failed;
  return { ok: true, domain, account: { email: desec.email, password: desec.password } };
}

/** The name and everything under it (app., the relay) to the server; null when deSEC took it, else { error }. */
async function pointAt({ domain, token, ip }) {
  const records = [
    { subname: '', type: 'A', ttl: 3600, records: [ip] },
    { subname: '*', type: 'A', ttl: 3600, records: [ip] },
  ];
  let set;
  try {
    set = await api(`/domains/${domain}/rrsets/`, { method: 'PUT', body: records, token });
  } catch {
    return { error: t('desec.down') };
  }
  if (set.status === 200) return null;
  console.log('deSEC rrsets refused:', set.status, set.text.slice(0, 400));
  if (set.status === 404) return { error: t('desec.gone') };
  if (set.status === 401 || set.status === 403) return { error: t('desec.noAccess') };
  if (set.status === 429) return { error: t('desec.tooOften') };
  return { error: t('desec.notAccepted', { status: set.status }) };
}

/**
 * An account this computer already made for an earlier server (deSEC gives one name per account, so a second
 * sign-up with the same e-mail creates nothing): signs in with it and points its name at this server.
 */
async function reuse({ email, password, name, ip }) {
  let login;
  try {
    login = await api('/auth/login/', { method: 'POST', body: { email, password } });
  } catch {
    return { error: t('desec.down') };
  }
  if (login.status !== 200) {
    console.log('deSEC login refused:', login.status, login.text.slice(0, 400));
    if (login.status === 429) return { error: t('desec.tooOften') };
    if (login.status === 400 || login.status === 401) return { error: t('desec.savedRejected') };
    if (login.status === 403) return { error: t('desec.accountDenied') };
    return { error: t('desec.other', { said: login.status }) };
  }
  const domain = `${name}.dedyn.io`;
  const failed = await pointAt({ domain, token: login.json.token, ip });
  if (failed) return failed;
  return { ok: true, domain, account: { email, password } };
}

function cancelMail() {
  if (mailWait) mailWait.stop = true;
}

/** A domain of one's own: its three names must already point at the server. */
async function checkDomain({ domain, turn, ip }) {
  domain = String(domain).toLowerCase();
  if (!DOMAIN.test(domain) || !TURN.test(turn)) return { error: t('dns.notDomain') };
  const missing = [];
  for (const name of [domain, `app.${domain}`, `${turn}.${domain}`]) {
    try {
      const answer = await lookup(name, 'A');
      if (!(answer.Answer ?? []).some((record) => record.type === 1 && record.data === ip)) missing.push(name);
    } catch {
      missing.push(name);
    }
  }
  return missing.length ? { error: t('dns.missing', { names: missing.join(', ') }) } : { ok: true };
}

/* ---------- the install ---------- */

/**
 * Runs the installer over SSH and reports its steps: { step, state: run|done|fail, took?, why? }, then
 * { state: 'ready', url } or { state: 'fail', why, tail }. `save` gets what the app keeps for this server
 * (its key, the deSEC account) before anything changes on it.
 */
async function installSteps({ domain, turn, installer }, report, save) {
  if (!ssh) return report({ state: 'fail', why: t('install.noSession') });
  domain = String(domain).toLowerCase();
  if (!DOMAIN.test(domain) || !TURN.test(turn)) return report({ state: 'fail', why: t('install.badAddress') });
  const { conn } = ssh;
  // The app's own key: the installer adds it for root and switches password login off.
  const key = utils.generateKeyPairSync('ed25519', { comment: 'atrium-app' });
  save({ host: ssh.host, ip: ssh.ip, user: ssh.user, hostKey: ssh.hostKey, domain, privateKey: key.private });

  const fetchInstaller = installer
    ? exec(conn, 'cat > /root/atrium-install.sh', { stdin: fs.readFileSync(installer) })
    : exec(conn, `curl -fsSL --retry 3 ${sq(INSTALLER_URL)} -o /root/atrium-install.sh`);
  const fetched = await fetchInstaller;
  if (fetched.code !== 0) return report({ state: 'fail', why: t('install.noInstaller'), tail: fetched.tail });

  const env = [
    'ATRIUM_YES=1',
    'ATRIUM_PROGRESS=1',
    'NO_COLOR=1',
    `DOMAIN=${sq(domain)}`,
    `TURN_HOST=${sq(turn)}`,
    `ATRIUM_AUTHORIZED_KEY=${sq(key.public.trim())}`,
  ].join(' ');
  let ready = null;
  let why = null;
  let current = null; // the installer's step that is running
  // The installer's own output (not its "::atrium" lines): the last line of it, for a step that takes long. Sent
  // once a second at most; a line of an earlier step is not this step's.
  let last = '';
  let sent = '';
  const ticker = setInterval(() => {
    if (last && last !== sent) report({ state: 'out', text: (sent = last) });
  }, 1000);
  const plain = (text) => {
    // Progress bars redraw their line with \r, and colours are noise here.
    const clean = text.split('\r').pop().replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '').trim();
    // The installer's own status lines ("… Docker", "✓ Docker 12 с") say what the list already does.
    if (clean && !/^[…✓✗!•]/.test(clean)) last = clean.slice(0, 160);
  };
  const { code, tail } = await exec(conn, `${env} sh /root/atrium-install.sh`, {
    onLine: (line) => {
      const sub = line.match(/^::atrium sub (.+)$/);
      if (sub) return report({ step: current, state: 'sub', text: sub[1].slice(0, 120) });
      const m = line.match(/^::atrium (run|done|fail|ready) ?(\S*) ?(.*)$/);
      if (!m) return plain(line);
      const [, state, step, rest] = m;
      if (state === 'ready') {
        ready = step;
        return;
      }
      if (state === 'run') {
        current = step;
        last = sent = '';
      }
      if (state === 'fail') why = rest || step;
      report({ step, state, ...(state === 'done' && rest ? { took: Number(rest) } : {}), ...(state === 'fail' ? { why: rest } : {}) });
    },
  }).finally(() => clearInterval(ticker));
  if (ready) return report({ state: 'ready', url: ready });
  report({ state: 'fail', why: why || t('install.stopped', { code }), tail });
}

async function install(options, report, save) {
  try {
    await installSteps(options, report, save);
  } catch (error) {
    close();
    report({ state: 'fail', why: sshError(error).error });
  }
}

module.exports = { connect, close, register, reuse, waitMail, cancelMail, checkDomain, install };
