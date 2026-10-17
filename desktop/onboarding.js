// "Свой сервер": a fresh VPS becomes a Gomex server from here, without a terminal. The app logs in over SSH with
// the address and password from the hosting company's e-mail, asks for an address and backups, runs the installer
// and then opens the server's own wizard (name, admin, recovery key, invites) in the same window.
//
// window.gomexSetup comes from onboarding-preload.js. Opened as a plain page (a browser, for design work) there is
// none, and a stand-in below plays the whole thing with made-up answers.
const $ = (id) => document.getElementById(id);
const setup = window.gomexSetup ?? fakeSetup();

// The drum's rows, one per installer step (install.sh, "::gomex run|done STEP"), in the order they run:
// [step, the row's words, the installer's own line it leaves in the picture, the installer's steps it covers]
const TASKS = [
  ['check', 'Проверяем сервер', 'Проверка сервера', ['check']],
  ['address', 'Ждём адрес', 'Адрес в DNS', ['address']],
  ['docker', 'Ставим Docker', 'Docker', ['docker']],
  ['firewall', 'Настраиваем файрвол', 'Файрвол', ['firewall']],
  ['ssh', 'Закрываем вход по паролю', 'SSH только по ключу', ['ssh']],
  ['files', 'Скачиваем Gomex', 'Файлы Gomex', ['files']],
  ['config', 'Создаём ключи', 'Настройки и ключи', ['config']],
  ['backups', 'Включаем бэкапы', 'Ночные бэкапы', ['backups']],
  ['pull', 'Скачиваем приложение', 'Образы', ['pull']],
  ['up', 'Запускаем', 'Запуск', ['up']],
  ['https', 'Получаем сертификаты', 'HTTPS-сертификаты', ['https']],
];
const TASK_OF = Object.fromEntries(TASKS.flatMap(([id, , , steps]) => steps.map((step) => [step, id])));

/* ---------- the pictures on the right: whole screens of Gomex at work ---------- */

const LOCK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4.5" y="10.5" width="15" height="10" rx="3"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/></svg>';
const DRIVE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M8.6 3h6.8l6.1 10.5-3.4 6H5.9l-3.4-6z"/><path d="M8.6 3l6.4 10.5H2.5M15.4 3L9 13.5l-3.1 6M21.5 13.5H15l3.1 6"/></svg>';
const IP = '<span data-bind="ip">203.0.113.10</span>';
const HOST = '<span data-bind="host">podval.dedyn.io</span>';

/** Terminal lines, numbered: [html, class] pairs. */
const lines = (rows, from = 1) => rows.map(([html, cls = ''], i) => `<p class="ln ${cls}"><i>${from + i}</i><span>${html}</span></p>`).join('');

// The server: logged in over SSH, the installer checking it (the same lines install.sh prints).
const LOGIN = [
  [`<span class="k">$</span> ssh <span data-bind="user">root</span>@${IP}`],
  ['Welcome to Ubuntu 24.04 LTS (GNU/Linux 6.8.0-45-generic x86_64)', 'dim'],
  [' * Documentation:  https://help.ubuntu.com', 'dim'],
  [' * Management:     https://landscape.canonical.com', 'dim'],
  [' System load:  0.08               Processes:             112', 'dim'],
  [' Usage of /:   6.1% of 24.04GB    Users logged in:       0', 'dim'],
  [` Memory usage: 9%                 IPv4 address for eth0: ${IP}`, 'dim'],
  [' Swap usage:   0%', 'dim'],
  [`<span class="k">root@vps:~#</span> curl -fsSL https://github.com/gomex-inc/gomex/releases/latest/download/install.sh | sh`],
  ['Gomex 0.2.2'],
];
const CHECKS = [
  ['<b class="ok">✓</b> Права root'],
  ['<b class="ok">✓</b> <span data-bind="os">Ubuntu 24.04 LTS · x86_64</span>'],
  ['<b class="ok">✓</b> Порты 80 и 443 свободны'],
  ['<b class="ok">✓</b> Docker: поставим'],
  ['<b class="ok">✓</b> <span data-bind="size">Память 2 ГБ · диск 18 ГБ</span> свободно'],
  ['<b class="ok">✓</b> SSH-ключ есть: вход по паролю выключим'],
  [`<b class="ok">✓</b> IP ${IP}`],
  [`<b class="ok">✓</b> DNS: app.${HOST} → ${IP}`],
];
const STEPS_AHEAD = ['Файрвол', 'SSH только по ключу', 'Файлы Gomex 0.2.2', 'Настройки и ключи', 'Ночные бэкапы', 'Скачиваем образы', 'Запуск', 'HTTPS-сертификаты'];

const SCREENS = {
  server: () =>
    lines([...LOGIN, ...CHECKS.map(([html], i) => [html, i === 2 ? 'check focus' : 'check']), ...STEPS_AHEAD.map((t) => [`… ${t}`, 'dim'])]),
  // The installer's run: the checks done, then its steps as they finish (logLine adds them).
  install: () =>
    lines([...LOGIN, ...CHECKS.map(([html], i) => [html, i === CHECKS.length - 1 ? 'focus' : ''])]) +
    `<div class="log"></div>` +
    // What's still to come, dim, one line fewer each time a step finishes; then the screen goes on.
    `<div class="ahead">${lines(TASKS.map(([, , text]) => [`… ${text}`, 'dim']), 0).replace(/<i>\d+<\/i>/g, '<i></i>')}</div>` +
    lines([['', ''], ['', ''], ['', ''], ['', ''], ['', ''], ['', '']], 0).replace(/<i>\d+<\/i>/g, '<i></i>'),
  // The browser on the new address: Gomex open in it, a friend just shared the invite link.
  address: () => `
    <div class="tabs"><span class="tab on">Gomex</span><span class="tab">Почта</span><span class="tab">Новая вкладка</span></div>
    <div class="bar"><span class="nav">‹ ›</span><span class="url">${LOCK}app.${HOST}</span><span class="nav">⋯</span></div>
    <div class="app">
      <div class="rail"><i class="on"></i><i></i><i></i><i></i><i></i><i></i></div>
      <div class="list"><p class="on"># общий</p><p># игры</p><p># мемы</p><p># кино</p><p>🔊 Общий</p><p>🔊 Катка</p><p>🔊 Тихая</p></div>
      <div class="chat">
        <div class="msg"><i></i><p><b>Тимур</b><span>ну что, сегодня в 9?</span></p></div>
        <div class="msg"><i></i><p><b>Аня</b><span>я за, только ссылку киньте</span></p></div>
        <div class="msg"><i></i><p><b>Дима</b><span>держи</span></p></div>
        <div class="msg focus hl-pink"><i></i><p><b>Дима</b><span>app.${HOST}/?invite=7f3k9q</span></p></div>
        <div class="msg"><i></i><p><b>Аня</b><span>зашла 🔥</span></p></div>
        <div class="msg"><i></i><p><b>Тимур</b><span>го в Катку</span></p></div>
        <div class="msg"><i></i><p><b>Лёша</b><span>через 5 мин</span></p></div>
      </div>
    </div>`,
  // The person's inbox: deSEC's letter at the top, waiting for its link to be pressed.
  mail: () => `
    <div class="tabs"><span class="tab">Gomex</span><span class="tab on">Почта</span><span class="tab">Новая вкладка</span></div>
    <div class="bar"><span class="nav">‹ ›</span><span class="url">${LOCK}<span data-bind="mailhost">mail.google.com</span></span><span class="nav">⋯</span></div>
    <div class="inbox">
      <div class="folders"><p class="on">Входящие</p><p>Отмеченные</p><p>Отправленные</p><p>Спам</p><p>Корзина</p></div>
      <div class="letters">
        <p class="letter"><b>Тимур</b><span>ссылка на игру, заходи</span><em>22:41</em></p>
        <p class="letter focus hl-pink"><b>deSEC</b><span>Activate your account: <span data-bind="host">podval.dedyn.io</span></span><em>сейчас</em></p>
        <p class="letter"><b>Аня</b><span>фотки с выходных</span><em>21:07</em></p>
        <p class="letter"><b>Рассылка</b><span>новое за неделю</span><em>вчера</em></p>
        <p class="letter"><b>Лёша</b><span>в субботу в 8?</span><em>вчера</em></p>
        <p class="letter"><b>Тимур</b><span>скинь адрес сервера</span><em>16 окт.</em></p>
        <p class="letter"><b>Аня</b><span>спасибо!</span><em>15 окт.</em></p>
      </div>
    </div>`,
  // The backups on the Drive: other folders up top,  // The backups on the Drive: other folders up top, then a nightly file each, the newest highlighted.
  backup: () => {
    const rows = Array.from({ length: 14 }, (_, i) => {
      const size = [12, 12, 11, 11, 10, 10, 9, 9, 8, 8, 7, 7, 6, 6][i];
      return `<p class="row file${i === 2 ? ' focus' : ''}"><span><span data-bind="day${i}">gomex</span>.age</span><em>я</em><em>сегодня, 04:30</em><em>${size} МБ</em></p>`;
    }).join('');
    return `
      <div class="side"><p class="on">Мой диск</p><p>Компьютеры</p><p>Доступные мне</p><p>Недавние</p><p>Помеченные</p><p>Корзина</p><p>Хранилище</p><p>1,2 ГБ из 15 ГБ</p></div>
      <div class="main">
        <p class="path">${DRIVE} Мой диск <span class="dim">/</span> Gomex</p>
        <p class="head"><span>Название</span><span>Владелец</span><span>Изменено</span><span>Размер</span></p>
        <p class="row"><span>Документы</span><em>я</em><em>12 сент.</em><em>—</em></p>
        <p class="row"><span>Фото</span><em>я</em><em>3 окт.</em><em>—</em></p>
        ${rows}
      </div>`;
  },
};

// Each screen is filmed from two angles (onboarding.css, shot-a and shot-b). A camera holds two copies of it: a soft
// one underneath and a sharp one around the highlighted spot, for depth of field.
for (const scene of document.querySelectorAll('.scene')) {
  const template = scene.querySelector(':scope > .ui');
  template.innerHTML = SCREENS[template.dataset.screen]();
  for (const angle of ['a', 'b']) {
    const shot = Object.assign(document.createElement('div'), { className: `shot ${angle}` });
    for (const look of ['soft', 'sharp']) {
      const copy = template.cloneNode(true);
      copy.classList.add(look);
      shot.append(copy);
    }
    scene.append(shot);
  }
}

// The screens are alive, like the code in Linear's: a highlight walks down the installer's checks and the Drive's
// files (what's below it still dim, not reached yet), and the chat's messages arrive one by one. Every copy of a
// screen takes the same step at once, so the cameras agree.
// items: what takes turns; lit: the highlight that walks over them; walk: how many it visits (all by default);
// wait: what isn't reached yet waits dim (or, for messages, hasn't arrived); from: how many are there from the start.
const LIVE = {
  server: { items: '.check', lit: 'hl-green', every: 1300, wait: true },
  address: { items: '.msg', every: 1400, wait: true, from: 4 },
  backup: { items: '.file', lit: 'hl-green', every: 1200, walk: 6 },
};
for (const [name, live] of Object.entries(LIVE)) {
  const scene = document.querySelector(`.scene[data-scene="${name}"]`);
  const walk = live.walk ?? scene.querySelector('.ui').querySelectorAll(live.items).length;
  let at = (live.from ?? 1) - 1;
  setInterval(() => {
    // Past the last one, everything stays as it is for two beats before it starts over.
    at = at + 1 >= walk + 2 ? (live.from ?? 1) - 1 : at + 1;
    for (const ui of scene.querySelectorAll('.ui')) {
      ui.querySelectorAll(live.items).forEach((item, k) => {
        if (live.lit) item.classList.toggle(live.lit, k === at);
        if (live.wait) item.classList.toggle('later', k > at);
      });
    }
  }, live.every);
}

/** Where `el` sits inside `root`, in its untransformed layout. */
function offsetIn(el, root) {
  let x = 0;
  let y = 0;
  for (let node = el; node && node !== root; node = node.offsetParent) {
    x += node.offsetLeft;
    y += node.offsetTop;
  }
  return { x, y };
}

/** Puts the scene's highlighted spot in the middle of the frame and the cameras' focus on it. Needs layout. */
function frame(scene) {
  const ui = scene?.querySelector('.shot .sharp');
  if (!ui?.offsetHeight) return;
  const focus = [...ui.querySelectorAll('.focus')].pop();
  if (!focus) return;
  const at = offsetIn(focus, ui);
  // A little right of the spot's start, so the screen's left edge stays out of the frame.
  scene.style.setProperty('--fx', `${Math.round(at.x + Math.min(focus.offsetWidth * 0.5, 320))}px`);
  scene.style.setProperty('--fy', `${Math.round(at.y + focus.offsetHeight / 2)}px`);
}
window.addEventListener('resize', () => document.querySelectorAll('.scene.on').forEach(frame));

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

// How far each step is into the "Сервер" part, out of five (the free-… steps and 'own' are the two ways on from 'address';
// one is walked), and the picture it shows on the right.
const PLACE = { server: 0, address: 1, 'free-name': 2, 'free-mail': 2.5, own: 2, backup: 3, install: 4 };
const SCENE = {
  server: 'server',
  address: 'address',
  'free-name': 'address',
  'free-mail': 'mail',
  own: 'address',
  backup: 'backup',
  install: 'install',
};
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
  for (const scene of document.querySelectorAll('.scene')) {
    scene.classList.toggle('on', scene.dataset.scene === SCENE[name]);
    if (scene.classList.contains('on')) frame(scene);
  }
  progress(PLACE[name] / 5);
  // Focus once the step has settled, and without scrolling: a field focused mid-animation drags the step to it.
  setTimeout(() => to.querySelector('.input:not([disabled])')?.focus({ preventScroll: true }), 560);
}

/** The "Сервер" bar, filled to `part` (0..1). The other two fill on the server's own wizard. */
function progress(part) {
  document.querySelector('.part[data-part="server"] .track i').style.setProperty('--fill', String(Math.min(1, part)));
  document.querySelectorAll('.part').forEach((p) => p.classList.toggle('now', p.dataset.part === 'server'));
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

/** Writes an answer into the picture on the right wherever it's named, and remembers it for screens drawn again. */
const bound = {};
function bind(name, value) {
  bound[name] = value;
  document.querySelectorAll(`[data-bind="${name}"]`).forEach((el) => (el.textContent = value));
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
  const answer = await setup.connect({ host: $('ip').value.trim(), user: $('user').value.trim() || 'root', password: $('pass').value });
  busy($('go-server'), false);
  checkServerForm();
  if (answer.error) {
    $('e-server').textContent = answer.error;
    if (answer.field === 'host') $('ip').classList.add('bad');
    return;
  }
  state.facts = answer.facts;
  bind('os', answer.facts.os);
  bind('size', answer.facts.size);
  frame(document.querySelector('.scene[data-scene="server"]'));
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

// Then the letter: a button straight into the person's mailbox, and the app waiting for the link to be pressed and
// deSEC's captcha on its page solved. Once it is, the app signs in to deSEC and points the name at the server itself.
const MAILBOXES = [
  [/^(gmail|googlemail)\.com$/, 'Открыть Gmail', 'https://mail.google.com/'],
  [/^(yandex\.(ru|com|by|kz)|ya\.ru)$/, 'Открыть Яндекс Почту', 'https://mail.yandex.ru/'],
  [/^(mail|bk|list|inbox|internet)\.ru$/, 'Открыть Почту Mail.ru', 'https://e.mail.ru/'],
  [/^(outlook|hotmail|live)\.com$/, 'Открыть Outlook', 'https://outlook.live.com/mail/'],
  [/^(icloud|me|mac)\.com$/, 'Открыть iCloud Почту', 'https://www.icloud.com/mail'],
  [/^(proton\.me|protonmail\.com)$/, 'Открыть Proton Mail', 'https://mail.proton.me/'],
];
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
  $('mail-state').textContent = 'Ждём подтверждение';
  $('e-mail').textContent = '';
  show('free-mail');
  setup.waitMail({ ip: state.facts.ip }).then((answer) => {
    if (state.step !== 'free-mail') return;
    if (answer.error) {
      $('mail-wait').hidden = true;
      $('e-mail').textContent = answer.error;
      return;
    }
    $('mail-state').textContent = 'Подтверждено';
    $('mail-wait').classList.add('done');
    state.address = { domain: `${freeName()}.dedyn.io` };
    setTimeout(() => show('backup'), 900);
  });
}
$('open-mail').addEventListener('click', () => setup.openExternal($('open-mail').dataset.url));
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
      const copy = Object.assign(document.createElement('button'), { className: 'secondary icon', type: 'button', title: 'Копировать' });
      copy.setAttribute('aria-label', 'Копировать');
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

// The backups' file names in the picture: the last five nights.
for (let i = 0; i < 5; i++) {
  const day = new Date(Date.now() - i * 86400000);
  bind(`day${i}`, `gomex-${String(day.getDate()).padStart(2, '0')}.${String(day.getMonth() + 1).padStart(2, '0')}`);
}

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
  // A fresh run: the install screen as it was before any line came in.
  document.querySelectorAll('[data-screen="install"]').forEach((ui) => (ui.innerHTML = SCREENS.install()));
  Object.entries(bound).forEach(([name, value]) => bind(name, value));
}

/** The picture's terminal: the installer's lines as they come, numbered, the newest one highlighted. */
function logLine(text, took) {
  for (const log of document.querySelectorAll('.log')) {
    log.parentElement.querySelectorAll('.focus').forEach((el) => el.classList.remove('hl-green', 'focus'));
    const line = Object.assign(document.createElement('p'), { className: 'ln hl-green focus' });
    const n = Object.assign(document.createElement('i'), { textContent: String(LOGIN.length + CHECKS.length + log.children.length + 1) });
    const body = document.createElement('span');
    body.append(Object.assign(document.createElement('b'), { className: 'ok', textContent: '✓ ' }), text);
    if (took) body.append(Object.assign(document.createElement('span'), { className: 'dim', textContent: `  ${took}` }));
    line.append(n, body);
    log.append(line);
    log.parentElement.querySelector('.ahead')?.firstElementChild?.remove();
  }
  frame(document.querySelector('.scene[data-scene="install"]'));
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
let clock = null;
function startClock() {
  const started = Date.now();
  clearInterval(clock);
  $('elapsed').textContent = '0:00';
  clock = setInterval(() => {
    const s = Math.floor((Date.now() - started) / 1000);
    $('elapsed').textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }, 250);
}

function startInstall() {
  state.installing = true;
  clearTimeout(opening);
  renderTasks();
  $('e-install').textContent = '';
  $('retry').hidden = true;
  $('go-install').hidden = false;
  $('go-install').disabled = true;
  $('install-title').textContent = 'Ставим Gomex';
  $('install-sub').textContent = 'Пара минут, окно можно свернуть';
  show('install');
  startClock();
  const started = {};
  const finish = (id) => {
    const row = document.querySelector(`.task[data-task="${id}"]`);
    if (!row || row.dataset.state === 'done') return;
    row.dataset.state = 'done';
    const s = Math.max(1, Math.round((Date.now() - (started[id] ?? Date.now())) / 1000));
    const took = s < 60 ? `${s} с` : `${Math.floor(s / 60)} мин`;
    logLine(TASKS.find(([task]) => task === id)?.[2] ?? '', took);
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
        if (row.dataset.state === 'wait') {
          started[id] = Date.now();
          row.dataset.state = 'run';
        }
        current(id);
      } else if (event.state === 'fail') {
        document.querySelector(`.task[data-task="${id}"]`).dataset.state = 'fail';
        current(id);
      }
      return;
    }
    if (event.state === 'fail') {
      clearInterval(clock);
      state.installing = false;
      $('e-install').textContent = event.why ?? 'Не получилось';
      // A failed install has one way on, again: the server's button only gets in its way.
      $('go-install').hidden = true;
      $('retry').hidden = false;
    }
    if (event.state === 'ready') {
      TASKS.forEach(([task]) => finish(task));
      // The last line becomes the end of it all.
      const last = document.querySelector(`.task[data-task="${TASKS.at(-1)[0]}"]`);
      last.querySelector('.label').textContent = 'Всё установлено';
      current(last.dataset.task);
      clearInterval(clock);
      state.installing = false;
      state.done = event;
      const shown = event.url.replace(/^https:\/\//, '').replace(/\/\?.*$/, '');
      for (const log of document.querySelectorAll('.log')) {
        log.parentElement.querySelectorAll('.focus').forEach((el) => el.classList.remove('hl-green', 'focus'));
        const line = Object.assign(document.createElement('p'), { className: 'ln focus' });
        const box = Object.assign(document.createElement('span'), { className: 'box', textContent: `https://${shown}` });
        line.append(document.createElement('i'), box);
        log.append(line);
      }
      frame(document.querySelector('.scene[data-scene="install"]'));
      state.done.shown = shown;
      $('install-title').textContent = 'Сервер готов';
      // A name made minutes ago may not have reached this computer's DNS yet; the app checks it and says when it does
      // ({ state: 'open' }). The main window shows its own page if it's opened too early, so a name that stays away
      // doesn't lock the button for good.
      $('install-sub').textContent = 'Адрес ещё расходится, минута-две';
      clearTimeout(opening);
      opening = setTimeout(() => {
        $('install-sub').textContent = `${shown}: пока не открывается`;
        $('go-install').disabled = false;
      }, 4 * 60 * 1000);
    }
    if (event.state === 'open') {
      clearTimeout(opening);
      $('install-sub').textContent = state.done?.shown ?? '';
      $('go-install').disabled = false;
      $('go-install').focus({ preventScroll: true });
    }
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
      if (password === 'wrong') return { error: 'Неверный пароль' };
      if (host.startsWith('10.')) return { error: 'Сервер не отвечает', field: 'host' };
      return { facts: { ip: host, os: 'Ubuntu 24.04 LTS · x86_64', size: 'Память 2 ГБ · диск 18 ГБ' } };
    },
    async register({ name }) {
      await wait(900);
      return name === 'taken' ? { error: 'Имя занято, нужно другое' } : { ok: true };
    },
    waitMail: () => wait(6000).then(() => ({ ok: true })),
    cancelMail() {},
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
        ['check', 2400, ['Права root', 'Ubuntu 24.04 · x86_64', 'Порты 80 и 443 свободны', 'Docker: поставим', 'Память 2.0 ГБ · диск 18 ГБ свободно', 'IP 2.27.52.78']],
        ['address', 7000, ['Записей на месте: 0 из 3', 'Записей на месте: 1 из 3', 'Записей на месте: 3 из 3']],
        ['docker', 4000, ['Скачиваем установщик Docker', 'Ставим пакеты Docker', 'Запускаем Docker']],
        ['firewall', 1200, ['Открываем порты 80, 443 и для звонков', 'Включаем файрвол']],
        ['ssh', 900, ['Выключаем вход по паролю', 'Проверяем настройки sshd']],
        ['files', 1800, ['Скачиваем Gomex 0.2.2', 'Раскладываем файлы']],
        ['config', 900, ['Секреты и настройки', 'Настройки звонков']],
        ['pull', 26000, ['Образы приложения, звонков и веб-сервера']],
        ['up', 3000, ['Запускаем контейнеры', 'Ждём ответ приложения', 'Пишем обложку сайта']],
        ['https', 2400, ['Ждём сертификат от Let\'s Encrypt']],
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
    openServer: (url) => alert(`Дальше: ${url}, мастер сервера`),
  };
}

show('server');
checkServerForm();

// Design work in a browser: #step=address (or free-name, free-mail, own, backup, install, done) opens that step with made-up answers.
const jump = !window.gomexSetup && location.hash.match(/step=([\w-]+)/)?.[1];
if (jump) {
  const fill = (id, value) => {
    $(id).value = value;
    $(id).dispatchEvent(new Event('input'));
  };
  state.facts = { ip: '2.27.52.78', os: 'Ubuntu 24.04 LTS · x86_64', size: 'Память 2 ГБ · диск 18 ГБ' };
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
  // #t=9000 stops the pictures' cameras at that moment of their 20 s loop, to look at one frame.
  const at = Number(location.hash.match(/t=(\d+)/)?.[1]);
  if (at) {
    setTimeout(() => {
      for (const a of document.getAnimations()) {
        if (a.animationName?.startsWith('shot-')) {
          a.pause();
          a.currentTime = at;
        }
      }
    }, 600);
  }
}
