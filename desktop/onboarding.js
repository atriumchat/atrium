// "Your own server": a fresh VPS becomes a Gomex server from here, without a terminal. The app logs in over SSH with
// the address and password from the hosting company's e-mail, asks for an address and backups, runs the installer
// and then opens the server's own wizard (name, admin, recovery key, invites) in the same window. The page is in the
// flow look (DESIGN.md, flow.css): one step at a time, the scale as a ruler over the column.
//
// window.gomexSetup comes from onboarding-preload.js. Opened as a plain page (a browser, for design work) there is
// none, and a stand-in below plays the whole thing with made-up answers.
const $ = (id) => document.getElementById(id);
const setup = window.gomexSetup ?? fakeSetup();

// The drum's rows, one per installer step (install.sh, "::gomex run|done STEP"), in the order they run:
// [step, the row's words, the installer's steps it covers]
const TASKS = [
  ['check', t('ob.task.check'), ['check']],
  ['address', t('ob.task.address'), ['address']],
  ['docker', t('ob.task.docker'), ['docker']],
  ['firewall', t('ob.task.firewall'), ['firewall']],
  ['ssh', t('ob.task.ssh'), ['ssh']],
  ['files', t('ob.task.files'), ['files']],
  ['config', t('ob.task.config'), ['config']],
  ['backups', t('ob.task.backups'), ['backups']],
  ['pull', t('ob.task.pull'), ['pull']],
  ['up', t('ob.task.up'), ['up']],
  ['https', t('ob.task.https'), ['https']],
];
const TASK_OF = Object.fromEntries(TASKS.flatMap(([id, , steps]) => steps.map((step) => [step, id])));

/* ---------- the scale: a ruler of ticks over the column (flow.css .flow-ruler) ---------- */

// As the web's TickRuler (web/src/ui/flow/EdgeTicks.tsx): a tick every 9px, every fifth taller, the filled ones white,
// the next one breathing; a new value is swept to a tick at a time.
const GAP = 9;
let rulerOn = 0;
let rulerTarget = 0;
let rulerTimer = 0;
function drawRuler() {
  const box = $('ruler');
  const width = box.clientWidth;
  const count = Math.floor(width / GAP) + 1;
  const ticks = Array.from({ length: count }, (_, i) => {
    const cls = i === rulerOn && rulerOn < count ? 'next' : i < rulerOn ? 'on' : '';
    return `<line x1="${i * GAP + 1}" x2="${i * GAP + 1}" y1="${i % 5 === 0 ? 0 : 4}" y2="12" class="${cls}" />`;
  });
  box.innerHTML = `<svg width="${width}" height="12">${ticks.join('')}</svg>`;
  return count;
}
function ruler(fill) {
  const count = drawRuler();
  rulerTarget = Math.round(Math.max(0, Math.min(1, fill)) * count);
  clearInterval(rulerTimer);
  rulerTimer = setInterval(() => {
    if (rulerOn === rulerTarget) return clearInterval(rulerTimer);
    rulerOn += rulerOn < rulerTarget ? 1 : -1;
    drawRuler();
  }, 8);
}
window.addEventListener('resize', drawRuler);

/** Answers kept for the steps that show them again. */
const bound = {};
function bind(name, value) {
  bound[name] = value;
}

// The relay's neutral subdomain, as install.sh picks it (TURN_NAMES); chosen here so own-domain records can show it.
const TURN_NAMES = ['media', 'cdn', 'static', 'assets', 'files', 'img'];
const state = {
  step: 'server',
  facts: null,
  pick: 'free',
  address: null,
  turn: TURN_NAMES[Math.floor(Math.random() * TURN_NAMES.length)],
  drive: null,
  installing: false,
  done: null,
};

/* ---------- moving between steps ---------- */

// How far each step is along the way, out of five (the free-… steps and 'own' are the two ways on from 'address'; one
// is walked), and the part it's in, for the line over the title.
const PLACE = { server: 0, address: 1, 'free-name': 2, 'free-mail': 2.5, own: 2, backup: 3, install: 4 };
const PARTS = ['server', 'address', 'backup', 'install'];
const PART = { server: 'server', address: 'address', 'free-name': 'address', 'free-mail': 'address', own: 'address', backup: 'backup', install: 'install' };
// One step back along the way actually walked.
const PREVIOUS = {
  address: 'server',
  'free-name': 'address',
  'free-mail': 'free-name',
  own: 'address',
  backup: () => (state.pick === 'free' ? 'free-name' : 'own'),
  install: 'backup',
};

function show(name, { back = false } = {}) {
  const from = document.querySelector('.step:not([hidden])');
  const to = document.querySelector(`.step[data-step="${name}"]`);
  state.step = name;
  if (from && from !== to) {
    from.classList.add('leaving');
    setTimeout(() => {
      from.hidden = true;
      from.classList.remove('leaving');
    }, 160);
  }
  to.classList.toggle('back-in', back);
  to.hidden = false;
  to.style.animation = 'none';
  void to.offsetWidth;
  to.style.animation = '';
  const part = PART[name];
  $('stage').textContent = t('ob.stageOf', { stage: t(`ob.stage.${part}`), n: PARTS.indexOf(part) + 1, total: PARTS.length });
  progress(PLACE[name] / 5);
  if (name === 'free-name') offerSaved();
  // Focus once the step has settled, and without scrolling: a field focused mid-animation drags the step to it.
  setTimeout(() => to.querySelector('.input:not([disabled])')?.focus({ preventScroll: true }), 560);
}

/** The ruler, filled to `part` (0..1) of the way here; the server's own wizard has its own after it. */
function progress(part) {
  ruler(Math.min(1, part));
}

document.querySelectorAll('.back').forEach((button) =>
  button.addEventListener('click', () => {
    if (state.installing) return;
    const to = PREVIOUS[state.step];
    if (to) show(typeof to === 'function' ? to() : to, { back: true });
  }),
);

function busy(button, on) {
  button.classList.toggle('busy', on);
  button.disabled = on;
}

/* ---------- 1. server ---------- */

const hostOk = (v) => /^(\d{1,3}\.){3}\d{1,3}$/.test(v) || /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(v) || /^[0-9a-f:]+:[0-9a-f:]+$/i.test(v);

function checkServerForm() {
  $('go-server').disabled = !hostOk($('ip').value.trim()) || !$('user').value.trim() || !$('pass').value;
}
['ip', 'pass', 'user'].forEach((id) =>
  $(id).addEventListener('input', () => {
    $('e-server').textContent = '';
    $('ip').classList.remove('bad');
    checkServerForm();
    bind('ip', $('ip').value.trim() || '203.0.113.10');
    bind('user', $('user').value.trim() || 'root');
  }),
);

$('eye').addEventListener('click', () => {
  const pass = $('pass');
  pass.type = pass.type === 'password' ? 'text' : 'password';
  pass.focus();
});

$('f-server').addEventListener('submit', async (event) => {
  event.preventDefault();
  if ($('go-server').disabled) return;
  busy($('go-server'), true);
  let answer;
  try {
    answer = await setup.connect({ host: $('ip').value.trim(), user: $('user').value.trim() || 'root', password: $('pass').value });
  } catch {
    answer = { error: t('ssh.noReply') };
  } finally {
    busy($('go-server'), false);
    checkServerForm();
  }
  if (answer.error) {
    $('e-server').textContent = answer.error;
    if (answer.field === 'host') $('ip').classList.add('bad');
    return;
  }
  state.facts = answer.facts;
  bind('os', answer.facts.os);
  bind('size', answer.facts.size);
  show('address');
});

/* ---------- 2. address ---------- */

document.querySelectorAll('.choice').forEach((choice) => {
  choice.addEventListener('click', () => {
    state.pick = choice.dataset.pick;
    document.querySelectorAll('.choice').forEach((c) => c.setAttribute('aria-checked', String(c === choice)));
  });
  choice.addEventListener('dblclick', () => show(state.pick === 'free' ? 'free-name' : 'own'));
});
$('go-address').addEventListener('click', () => show(state.pick === 'free' ? 'free-name' : 'own'));
bind('turn', state.turn);

// 2a. A free name on deSEC. First the name (checked free at once) and the e-mail; the account is made right then.
const freeName = () => $('free-name').value.trim().toLowerCase().replace(/\.dedyn\.io$/, '');
const freeEmail = () => $('free-email').value.trim();
// dedyn.io takes letters, digits and inner dashes, and not too short a name.
const freeNameOk = () => /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$/.test(freeName());
const emailOk = () => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(freeEmail());
['free-name', 'free-email'].forEach((id) =>
  $(id).addEventListener('input', () => {
    $('e-free-name').textContent = '';
    $('go-free-name').disabled = !freeNameOk() || !emailOk();
    if (id === 'free-name') bind('host', `${freeName() || 'podval'}.dedyn.io`);
  }),
);
// Whether the name is free is deSEC's answer to the sign-up itself.
$('go-free-name').addEventListener('click', async () => {
  busy($('go-free-name'), true);
  const answer = await setup.register({ name: freeName(), email: freeEmail() });
  busy($('go-free-name'), false);
  if (answer.error) {
    $('e-free-name').textContent = answer.error;
    return;
  }
  waitForMail();
});

// An address this computer already has from an earlier server: deSEC allows one name per e-mail, so it is offered
// first and pointed at this server.
async function offerSaved() {
  $('e-saved').textContent = '';
  const { domain } = await setup.savedAddress();
  $('saved').hidden = !domain;
  if (domain) $('saved-name').textContent = t('ob.savedName', { domain });
}
$('use-saved').addEventListener('click', async () => {
  busy($('use-saved'), true);
  const answer = await setup.useSaved({ ip: state.facts.ip });
  busy($('use-saved'), false);
  if (answer.error) {
    $('e-saved').textContent = answer.error;
    return;
  }
  state.address = { domain: answer.domain };
  show('backup');
});

// Then the letter: a button straight into the person's mailbox, and the app waiting for the link to be pressed and
// deSEC's captcha on its page solved. Once it is, the app signs in to deSEC and points the name at the server itself.
const MAILBOXES = [
  [/^(gmail|googlemail)\.com$/, t('ob.mail.gmail'), 'https://mail.google.com/'],
  [/^(yandex\.(ru|com|by|kz)|ya\.ru)$/, t('ob.mail.yandex'), 'https://mail.yandex.ru/'],
  [/^(mail|bk|list|inbox|internet)\.ru$/, t('ob.mail.mailru'), 'https://e.mail.ru/'],
  [/^(outlook|hotmail|live)\.com$/, t('ob.mail.outlook'), 'https://outlook.live.com/mail/'],
  [/^(icloud|me|mac)\.com$/, t('ob.mail.icloud'), 'https://www.icloud.com/mail'],
  [/^(proton\.me|protonmail\.com)$/, t('ob.mail.proton'), 'https://mail.proton.me/'],
];
let lateTimer = null;
function waitForMail() {
  const email = freeEmail();
  const box = MAILBOXES.find(([domain]) => domain.test(email.split('@')[1]?.toLowerCase() ?? ''));
  $('mail-to').textContent = email;
  $('open-mail').hidden = !box;
  if (box) {
    $('open-mail-label').textContent = box[1];
    $('open-mail').dataset.url = box[2];
    bind('mailhost', new URL(box[2]).host);
  }
  $('mail-wait').hidden = false;
  $('mail-wait').classList.remove('done');
  $('mail-state').textContent = t('ob.mail.waiting');
  $('e-mail').textContent = '';
  $('mail-late').hidden = true;
  $('own-instead').hidden = true;
  show('free-mail');
  // A sign-up for an e-mail that already has an account sends no letter at all; after this long the person gets
  // the ways on. The wait itself goes on, so a late confirmation still works.
  clearTimeout(lateTimer);
  lateTimer = setTimeout(() => {
    if (state.step !== 'free-mail') return;
    $('mail-late').hidden = false;
    $('own-instead').hidden = false;
  }, location.hash.includes('slowmail') ? 5000 : 15 * 60 * 1000);
  setup.waitMail({ ip: state.facts.ip }).then((answer) => {
    if (state.step !== 'free-mail') return;
    if (answer.error) {
      $('mail-wait').hidden = true;
      $('e-mail').textContent = answer.error;
      return;
    }
    clearTimeout(lateTimer);
    $('mail-late').hidden = true;
    $('own-instead').hidden = true;
    $('mail-state').textContent = t('ob.mail.confirmed');
    $('mail-wait').classList.add('done');
    state.address = { domain: `${freeName()}.dedyn.io` };
    setTimeout(() => show('backup'), 900);
  });
}
$('open-mail').addEventListener('click', () => setup.openExternal($('open-mail').dataset.url));
$('own-instead').addEventListener('click', () => {
  setup.cancelMail();
  show('own');
});
$('other-mail').addEventListener('click', () => {
  setup.cancelMail();
  show('free-name', { back: true });
  $('free-email').focus({ preventScroll: true });
  $('free-email').select();
});

// 2b. A domain of one's own: the three records it needs, each with its copy button, then a check.
const domainOk = (v) => /^([a-z0-9-]+\.)+[a-z]{2,}$/i.test(v);
const domain = () => $('domain').value.trim().toLowerCase();
$('domain').addEventListener('input', () => {
  $('e-own').textContent = '';
  $('go-own').disabled = !domainOk(domain());
  bind('host', domain() || 'chat.example.com');
  renderRecords();
});

const ICON = (paths) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
const COPY_ICON = ICON(
  '<rect x="8.5" y="8.5" width="12" height="12" rx="3" /><path d="M15.5 8.5V6a2.5 2.5 0 0 0-2.5-2.5H6A2.5 2.5 0 0 0 3.5 6v7A2.5 2.5 0 0 0 6 15.5h2.5" />',
);
const DONE_ICON = ICON('<path d="M5 12.5l4.5 4.5L19 7.5" />');

function renderRecords() {
  const box = $('records');
  box.hidden = !domainOk(domain());
  if (box.hidden) return;
  const ip = state.facts?.ip ?? '';
  box.replaceChildren(
    ...[domain(), `app.${domain()}`, `${state.turn}.${domain()}`].map((name) => {
      const row = Object.assign(document.createElement('div'), { className: 'row' });
      const type = Object.assign(document.createElement('span'), { className: 'type', textContent: 'A' });
      const code = Object.assign(document.createElement('code'), { textContent: name, title: name, className: 'grow' });
      const to = Object.assign(document.createElement('span'), { className: 'to', textContent: ip });
      // A round icon, not a word: a long name needs the row's width.
      const copy = Object.assign(document.createElement('button'), { className: 'secondary icon', type: 'button', title: t('ob.copy') });
      copy.setAttribute('aria-label', t('ob.copy'));
      copy.innerHTML = COPY_ICON;
      copy.addEventListener('click', async () => {
        await navigator.clipboard.writeText(name).catch(() => undefined);
        copy.innerHTML = DONE_ICON;
        setTimeout(() => (copy.innerHTML = COPY_ICON), 1200);
      });
      row.append(type, code, to, copy);
      return row;
    }),
  );
}

$('go-own').addEventListener('click', async () => {
  busy($('go-own'), true);
  const answer = await setup.checkDomain({ domain: domain(), turn: state.turn, ip: state.facts.ip });
  busy($('go-own'), false);
  if (answer.error) {
    $('e-own').textContent = answer.error;
    return;
  }
  state.address = { domain: domain() };
  show('backup');
});

/* ---------- 3. backups ---------- */

$('drive-connect').addEventListener('click', async () => {
  busy($('drive-connect'), true);
  const answer = await setup.connectDrive();
  busy($('drive-connect'), false);
  if (answer.error) {
    $('e-backup').textContent = answer.error;
    return;
  }
  state.drive = answer;
  $('drive-sub').textContent = answer.email;
  $('drive-connect').hidden = true;
  $('drive-on').hidden = false;
  $('go-backup').disabled = false;
  $('go-backup').focus();
});
$('go-backup').addEventListener('click', () => startInstall());
$('skip-backup').addEventListener('click', () => {
  state.drive = null;
  startInstall();
});

/* ---------- 4. install ---------- */

const CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

function renderTasks() {
  $('tasks').innerHTML = TASKS.map(
    ([id, label]) =>
      `<li class="task" data-task="${id}" data-state="wait"><span class="state">${CHECK}</span><span class="label">${label}</span></li>`,
  ).join('');
  current(TASKS[0][0]);
}

/** Rolls the drum to the step that is on (or failed): every row learns how far it is from the middle. */
function current(id) {
  const at = TASKS.findIndex(([task]) => task === id);
  const row = document.querySelector(`.task[data-task="${id}"]`);
  if (!row || row.classList.contains('current')) return;
  document.querySelectorAll('.task.current').forEach((el) => el.classList.remove('current'));
  row.classList.add('current');
  $('tasks').style.setProperty('--at', String(at));
  document.querySelectorAll('.task').forEach((el, i) => el.style.setProperty('--d', String(i - at)));
}

let opening = null; // the wait for the new address, as long as the button is held back

function startInstall() {
  state.installing = true;
  clearTimeout(opening);
  renderTasks();
  $('e-install').textContent = '';
  $('retry').hidden = true;
  $('go-install').hidden = false;
  $('go-install').disabled = true;
  $('install-title').textContent = t('ob.install.title');
  $('install-sub').textContent = t('ob.install.sub');
  show('install');
  const finish = (id) => {
    const row = document.querySelector(`.task[data-task="${id}"]`);
    if (!row || row.dataset.state === 'done') return;
    row.dataset.state = 'done';
    progress((PLACE.install + document.querySelectorAll('.task[data-state="done"]').length / TASKS.length) / 5);
  };
  // The installer reports its own steps; a row is done once a later one starts (a step the server didn't need is
  // simply passed by).
  setup.install({ domain: state.address.domain, turn: state.turn }, (event) => {
    if (event.step) {
      const id = TASK_OF[event.step];
      const at = TASKS.findIndex(([task]) => task === id);
      if (at < 0) return;
      if (event.state === 'run') {
        TASKS.slice(0, at).forEach(([task]) => finish(task));
        const row = document.querySelector(`.task[data-task="${id}"]`);
        if (row.dataset.state === 'wait') row.dataset.state = 'run';
        current(id);
      } else if (event.state === 'fail') {
        document.querySelector(`.task[data-task="${id}"]`).dataset.state = 'fail';
        current(id);
      }
      return;
    }
    if (event.state === 'fail') {
      state.installing = false;
      $('e-install').textContent = event.why ?? t('ob.install.failed');
      // A failed install has one way on, again: the server's button only gets in its way.
      $('go-install').hidden = true;
      $('retry').hidden = false;
    }
    if (event.state === 'ready') {
      TASKS.forEach(([task]) => finish(task));
      // The last line becomes the end of it all.
      const last = document.querySelector(`.task[data-task="${TASKS.at(-1)[0]}"]`);
      last.querySelector('.label').textContent = t('ob.install.all');
      current(last.dataset.task);
      state.installing = false;
      state.done = event;
      const shown = event.url.replace(/^https:\/\//, '').replace(/\/\?.*$/, '');
      state.done.shown = shown;
      $('install-title').textContent = t('ob.install.ready');
      // A name made minutes ago may not have reached this computer's DNS yet; the app checks it and says when it does
      // ({ state: 'open' }). The main window shows its own page if it's opened too early, so a name that stays away
      // doesn't lock the button for good.
      $('install-sub').textContent = t('ob.install.spreading');
      clearTimeout(opening);
      opening = setTimeout(() => {
        $('install-sub').textContent = t('ob.install.notOpening', { shown });
        $('go-install').disabled = false;
      }, 4 * 60 * 1000);
    }
    if (event.state === 'open') {
      clearTimeout(opening);
      $('install-sub').textContent = state.done?.shown ?? '';
      $('go-install').disabled = false;
      $('go-install').focus({ preventScroll: true });
    }
  }).catch(() => {
    state.installing = false;
    $('e-install').textContent = t('ob.install.failed');
    $('go-install').hidden = true;
    $('retry').hidden = false;
  });
}

$('retry').addEventListener('click', () => startInstall());
$('go-install').addEventListener('click', () => setup.openServer(state.done.url));

/* ---------- the stand-in, for working on the design in a browser ---------- */

function fakeSetup() {
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  return {
    openExternal: (url) => window.open(url, '_blank'),
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
    // #slowmail: the letter never comes (a late confirmation arrives after a minute).
    waitMail: () => wait(location.hash.includes('slowmail') ? 60000 : 6000).then(() => ({ ok: true })),
    cancelMail() {},
    // A made-up saved account; #nosaved has none, #deaddesec has one deSEC refuses.
    async savedAddress() {
      return { domain: location.hash.includes('nosaved') ? null : 'podval.dedyn.io' };
    },
    async useSaved() {
      await wait(900);
      return location.hash.includes('deaddesec') ? { error: t('desec.savedRejected') } : { ok: true, domain: 'podval.dedyn.io' };
    },
    async checkDomain() {
      await wait(800);
      return { ok: true };
    },
    async connectDrive() {
      await wait(1400);
      return { email: 'admin@gmail.com' };
    },
    // The installer's own steps, as install.sh reports them, at a quicker pace: [step, how long it takes, what it says
    // on the way ("::gomex sub")]. The image download is long enough to show the installer's last output line too.
    async install(_options, onEvent) {
      const steps = [
        ['check', 2400, ['Root access', 'Ubuntu 24.04 · x86_64', 'Ports 80 and 443 free', 'Docker: will install', 'Memory 2.0 GB · disk 18 GB free', 'IP 2.27.52.78']],
        ['address', 7000, ['Records in place: 0 of 3', 'Records in place: 1 of 3', 'Records in place: 3 of 3']],
        ['docker', 4000, ['Downloading the Docker installer', 'Installing Docker packages', 'Starting Docker']],
        ['firewall', 1200, ['Opening ports 80, 443 and the call ports', 'Enabling the firewall']],
        ['ssh', 900, ['Disabling password login', 'Checking sshd settings']],
        ['files', 1800, ['Downloading Gomex 0.2.2', 'Unpacking files']],
        ['config', 900, ['Secrets and settings', 'Call settings']],
        ['pull', 26000, ['Images for the app, calls and web server']],
        ['up', 3000, ['Starting containers', 'Waiting for the app to answer', 'Writing the site cover']],
        ['https', 2400, ['Waiting for the Let\'s Encrypt certificate']],
      ];
      const layers = ['a3f8c1e2b9d4', '5be01d7f6a21', '9c4e7a30d1f8', '21d6b8f4e0a7', 'f07a3c95b2e1', '6d1e48a9c3b0'];
      for (const [step, ms, says] of steps) {
        onEvent({ step, state: 'run' });
        const at = Date.now();
        for (let i = 0; Date.now() - at < ms; i++) {
          if (says[i]) onEvent({ step, state: 'sub', text: says[i] });
          if (step === 'pull' && i > 0) onEvent({ state: 'out', text: `${layers[i % layers.length]} ${i % 3 ? 'Downloading' : 'Pull complete'}` });
          await wait(step === 'pull' ? 1200 : ms / (says.length + 1));
        }
        onEvent({ step, state: 'done' });
      }
      onEvent({ state: 'ready', url: 'https://app.podval.dedyn.io/?setup=demo' });
      // The new name reaches this computer a little later.
      await wait(5000);
      onEvent({ state: 'open' });
    },
    openServer: (url) => alert(`Next: ${url}, server wizard`),
  };
}

show('server');
checkServerForm();

// Design work in a browser: #lang=en (or ru) picks the language; #step=address (or free-name, free-mail, own, backup, install, done) opens that step with made-up answers.
const jump = !window.gomexSetup && location.hash.match(/step=([\w-]+)/)?.[1];
if (jump) {
  const fill = (id, value) => {
    $(id).value = value;
    $(id).dispatchEvent(new Event('input'));
  };
  state.facts = { ip: '2.27.52.78', os: 'Ubuntu 24.04 LTS · x86_64', size: t('ssh.size', { memory: 2, disk: 18 }) };
  fill('ip', state.facts.ip);
  fill('pass', 'secret');
  fill('free-name', 'podval');
  fill('free-email', 'you@gmail.com');
  if (jump === 'own') fill('domain', 'chat.podval.ru');
  state.address = { domain: 'podval.dedyn.io' };
  if (jump === 'free-mail') waitForMail();
  if (jump === 'install' || jump === 'done') {
    startInstall();
  } else if (jump !== 'server') {
    show(jump);
  }
}

/* Enter presses the step's main button, unless the focus is somewhere that has its own use for the key: a button
   presses itself, a form (the first step) submits itself. */
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || e.defaultPrevented || e.isComposing || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.target.closest('button, a, textarea, select, form')) return;
  const main = document.querySelector('.step:not([hidden]):not(.leaving) .primary');
  if (!main || main.disabled || main.hidden || main.type === 'submit' || !main.offsetParent) return;
  e.preventDefault();
  main.click();
});
