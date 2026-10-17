// "Свой сервер": a fresh VPS becomes a Gomex server from the app (onboarding.html), with no terminal.
//   - SSH in with the address and root password from the hosting company's e-mail; the password is only kept in
//     memory for this window. The installer then switches password login off, and the app keeps its own key.
//   - The address: a free name on deSEC (name.dedyn.io), registered and pointed here through deSEC's API, or the
//     person's own domain, checked at its own name servers.
//   - The installer (install.sh, GOMEX_PROGRESS=1) with its progress read back line by line.
// Main process only; the window reaches it through onboarding-preload.js and main.js.
const { Client, utils } = require('ssh2');
const crypto = require('node:crypto');
const dns = require('node:dns');
const fs = require('node:fs');

const DESEC = 'https://desec.io/api/v1';
const INSTALLER_URL = 'https://github.com/gomex-inc/gomex/releases/latest/download/install.sh';
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
  if (error?.level === 'client-authentication') return { error: 'Неверный логин или пароль' };
  if (['ENOTFOUND', 'EAI_AGAIN'].includes(error?.code)) return { error: 'Такого адреса нет', field: 'host' };
  if (['ECONNREFUSED', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH'].includes(error?.code) || /timed out/i.test(error?.message ?? '')) {
    return { error: 'Сервер не отвечает', field: 'host' };
  }
  return { error: `Не подключиться: ${error?.message ?? error}` };
}

/** Runs a command; streams its output lines to `onLine` and resolves with the exit code and the output's tail. */
function exec(conn, command, { onLine, stdin } = {}) {
  return new Promise((resolve, reject) => {
    conn.exec(command, (error, stream) => {
      if (error) return reject(error);
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
      stream.on('close', (code) => {
        if (buffer) take('\n');
        resolve({ code, tail });
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
  const ready = await new Promise((resolve) => {
    conn.on('ready', () => resolve(null));
    conn.on('error', (error) => resolve(sshError(error)));
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
  if (ready) return ready;
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
    return { error: 'Нужен вход под root' };
  }
  const memory = Number(facts.MEM) / 1024;
  const disk = Number(facts.DISK) / 1024;
  ssh = { conn, host, ip: address, user, hostKey };
  return {
    facts: {
      ip: address,
      os: [facts.OS, facts.ARCH].filter(Boolean).join(' · '),
      size: `Память ${memory.toFixed(memory < 10 ? 1 : 0)} ГБ · диск ${Math.round(disk)} ГБ`,
    },
  };
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
  if (!NAME.test(name)) return { error: 'Латиница, цифры и дефис, от 3 символов' };
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
    return { error: 'deSEC не отвечает, попробуйте ещё раз' };
  }
  if (answer.status === 202) {
    desec = { email: String(email).trim(), password, name };
    return { ok: true };
  }
  const json = answer.json ?? {};
  // deSEC's own words for the field it refused ({"domain": ["…"]}), so the person sees the real reason.
  const said = (field) => [json[field]].flat(2).filter((x) => typeof x === 'string').join(' ');
  console.log('deSEC sign-up refused:', answer.status, answer.text.slice(0, 400));
  if (answer.status === 429) return { error: 'Слишком часто, подождите минуту' };
  if (json.email) return { error: `Почта не подходит. deSEC: ${said('email')}` };
  // 400 {"domain": ["This domain name conflicts with an existing domain, or is disallowed by policy."]}
  if (json.domain && /conflicts with an existing domain|disallowed by policy/i.test(said('domain'))) {
    return { error: 'Имя занято, нужно другое' };
  }
  if (json.domain) return { error: `Имя не подходит. deSEC: ${said('domain')}` };
  if (json.code === 'registration_denied') return { error: 'deSEC отказал в регистрации' };
  return { error: `deSEC: ${JSON.stringify(json).slice(0, 160)}` };
}

/**
 * Waits for the link in deSEC's letter to be pressed (logging in only works after it), then points the name and
 * everything under it (app., the relay) at the server.
 */
async function waitMail({ ip }) {
  if (!desec) return { error: 'Начните заново: имя и почта' };
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
  if (!token) return { error: me.stop ? 'Отменено' : 'Ссылка из письма устарела, начните заново' };
  const domain = `${desec.name}.dedyn.io`;
  // The domain appears with the activation; give it a moment if the login was quicker.
  for (let i = 0; i < 12; i++) {
    if ((await api(`/domains/${domain}/`, { token })).status === 200) break;
    await wait(2500);
  }
  const records = [
    { subname: '', type: 'A', ttl: 3600, records: [ip] },
    { subname: '*', type: 'A', ttl: 3600, records: [ip] },
  ];
  const set = await api(`/domains/${domain}/rrsets/`, { method: 'PUT', body: records, token });
  if (set.status !== 200) return { error: `deSEC не принял адрес сервера (${set.status})` };
  return { ok: true, domain, account: { email: desec.email, password: desec.password } };
}

function cancelMail() {
  if (mailWait) mailWait.stop = true;
}

/** A domain of one's own: its three names must already point at the server. */
async function checkDomain({ domain, turn, ip }) {
  domain = String(domain).toLowerCase();
  if (!DOMAIN.test(domain) || !TURN.test(turn)) return { error: 'Не похоже на домен' };
  const missing = [];
  for (const name of [domain, `app.${domain}`, `${turn}.${domain}`]) {
    try {
      const answer = await lookup(name, 'A');
      if (!(answer.Answer ?? []).some((record) => record.type === 1 && record.data === ip)) missing.push(name);
    } catch {
      missing.push(name);
    }
  }
  return missing.length ? { error: `Ещё нет записей: ${missing.join(', ')}` } : { ok: true };
}

/* ---------- the install ---------- */

/**
 * Runs the installer over SSH and reports its steps: { step, state: run|done|fail, took?, why? }, then
 * { state: 'ready', url } or { state: 'fail', why, tail }. `save` gets what the app keeps for this server
 * (its key, the deSEC account) before anything changes on it.
 */
async function install({ domain, turn, installer }, report, save) {
  if (!ssh) return report({ state: 'fail', why: 'Нет связи с сервером, подключитесь снова' });
  domain = String(domain).toLowerCase();
  if (!DOMAIN.test(domain) || !TURN.test(turn)) return report({ state: 'fail', why: 'Адрес не подходит' });
  const { conn } = ssh;
  // The app's own key: the installer adds it for root and switches password login off.
  const key = utils.generateKeyPairSync('ed25519', { comment: 'gomex-app' });
  save({ host: ssh.host, ip: ssh.ip, user: ssh.user, hostKey: ssh.hostKey, domain, privateKey: key.private });

  const fetchInstaller = installer
    ? exec(conn, 'cat > /root/gomex-install.sh', { stdin: fs.readFileSync(installer) })
    : exec(conn, `curl -fsSL --retry 3 ${sq(INSTALLER_URL)} -o /root/gomex-install.sh`);
  const fetched = await fetchInstaller;
  if (fetched.code !== 0) return report({ state: 'fail', why: 'Не скачать установщик', tail: fetched.tail });

  const env = [
    'GOMEX_YES=1',
    'GOMEX_PROGRESS=1',
    'NO_COLOR=1',
    `DOMAIN=${sq(domain)}`,
    `TURN_HOST=${sq(turn)}`,
    `GOMEX_AUTHORIZED_KEY=${sq(key.public.trim())}`,
  ].join(' ');
  let ready = null;
  let why = null;
  let current = null; // the installer's step that is running
  // The installer's own output (not its "::gomex" lines): the last line of it, for a step that takes long. Sent
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
  const { code, tail } = await exec(conn, `${env} sh /root/gomex-install.sh`, {
    onLine: (line) => {
      const sub = line.match(/^::gomex sub (.+)$/);
      if (sub) return report({ step: current, state: 'sub', text: sub[1].slice(0, 120) });
      const m = line.match(/^::gomex (run|done|fail|ready) ?(\S*) ?(.*)$/);
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
  report({ state: 'fail', why: why || `Установщик остановился (код ${code})`, tail });
}

module.exports = { connect, close, register, waitMail, cancelMail, checkDomain, install };
