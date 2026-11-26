// The screen-share picker window: live thumbnails of the windows and the screens. A choice goes to the main
// process, which hands it to getDisplayMedia; closing without one is a cancel.
const REFRESH = 2000;
const $ = (id) => document.getElementById(id);
const picker = window.atriumPicker;

const NOTES = { window: t('picker.noWindows'), screen: t('picker.noScreens'), error: t('picker.failed') };

// One list per tab. A card is made once and then only updated, so a refresh never moves what the pointer is on.
const views = {
  window: { grid: $('window'), tab: $('tab-window'), cards: new Map(), loaded: false, failed: false, permission: false, pending: null },
  screen: { grid: $('screen'), tab: $('tab-screen'), cards: new Map(), loaded: false, failed: false, permission: false, pending: null },
};
let kind = 'window';
let selected = null; // the id of the chosen card, in the tab on view
let sound = true;

function paint() {
  const view = views[kind];
  for (const [name, other] of Object.entries(views)) {
    other.grid.hidden = name !== kind;
    other.tab.setAttribute('aria-selected', String(name === kind));
    other.tab.tabIndex = name === kind ? 0 : -1;
  }
  $('wait').hidden = view.loaded;
  $('note').hidden = !view.loaded || view.cards.size > 0 || view.permission;
  $('permission').hidden = !view.permission;
  $('note').textContent = view.failed ? NOTES.error : NOTES[kind];
  $('show').disabled = selected === null;
}

function select(id) {
  selected = id;
  for (const [cardId, card] of views[kind].cards) card.el.setAttribute('aria-selected', String(cardId === id));
  $('show').disabled = id === null;
}

function confirm(id = selected) {
  if (id !== null && views[kind].cards.get(id)?.el.getAttribute('aria-disabled') === 'false') picker.choose(id, sound);
}

function makeCard(id) {
  const el = document.createElement('div');
  el.className = 'card';
  el.tabIndex = 0;
  el.setAttribute('role', 'option');
  el.setAttribute('aria-selected', 'false');
  const thumb = document.createElement('div');
  thumb.className = 'thumb';
  const image = document.createElement('img');
  image.alt = '';
  image.draggable = false;
  image.hidden = true;
  const unavailable = document.createElement('span');
  unavailable.className = 'unavailable';
  unavailable.textContent = t('picker.minimized');
  unavailable.hidden = true;
  thumb.append(image, unavailable);
  const label = document.createElement('div');
  label.className = 'label';
  const icon = document.createElement('img');
  icon.alt = '';
  icon.draggable = false;
  icon.hidden = true;
  const fallbackIcon = document.createElement('span');
  fallbackIcon.className = 'app-icon';
  const name = document.createElement('span');
  name.className = 'name';
  label.append(icon, fallbackIcon, name);
  el.append(thumb, label);
  const enabled = () => el.getAttribute('aria-disabled') === 'false';
  el.addEventListener('keydown', (event) => {
    if (!enabled()) return;
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    if (event.key === 'Enter') confirm(id);
    else select(id);
  });
  el.addEventListener('click', () => { if (enabled()) select(id); });
  el.addEventListener('dblclick', () => confirm(id));
  return { el, image, icon, fallbackIcon, name, unavailable, thumb: null };
}

function update(card, source) {
  if (card.name.textContent !== source.name) {
    card.name.textContent = source.name;
    card.el.title = source.name;
  }
  if (card.thumb !== source.thumb) {
    card.thumb = source.thumb;
    card.image.hidden = !source.thumb;
    if (source.thumb) card.image.src = source.thumb;
  }
  if (source.icon && card.icon.src !== source.icon) card.icon.src = source.icon;
  card.icon.hidden = !source.icon;
  card.fallbackIcon.hidden = Boolean(source.icon);
  card.unavailable.hidden = !source.unavailable;
  card.el.tabIndex = source.unavailable ? -1 : 0;
  card.el.setAttribute('aria-disabled', String(Boolean(source.unavailable)));
}

function show(which, sources) {
  const view = views[which];
  const seen = new Set();
  for (const source of sources) {
    seen.add(source.id);
    let card = view.cards.get(source.id);
    if (!card) {
      card = makeCard(source.id);
      view.cards.set(source.id, card);
      view.grid.append(card.el);
    }
    update(card, source);
    if (which === kind && selected === source.id && source.unavailable) select(null);
  }
  for (const [id, card] of view.cards) {
    if (seen.has(id)) continue;
    card.el.remove();
    view.cards.delete(id);
    if (which === kind && selected === id) select(null);
  }
}

function load(which) {
  const view = views[which];
  view.pending ??= picker.list(which)
    .catch(() => ({ error: true }))
    .then(({ error, sources, permission }) => {
      view.permission = Boolean(permission);
      view.failed = Boolean(error);
      show(which, sources ?? []);
      view.loaded = true;
      paint();
    })
    .finally(() => {
      view.pending = null;
    });
  return view.pending;
}

function switchTo(which) {
  if (which === kind) return;
  kind = which;
  select(null);
  paint();
  void load(which);
}

// The next look starts REFRESH after the last answer, not on a fixed beat, so a slow capture never piles up.
async function refresh() {
  for (;;) {
    await new Promise((done) => setTimeout(done, REFRESH));
    await load(kind);
  }
}

/** Arrow keys walk the cards of the tab on view; up and down jump a row. */
function walk(key) {
  const cards = [...views[kind].cards.values()].map((card) => card.el).filter((el) => el.tabIndex === 0);
  if (!cards.length) return;
  const at = cards.findIndex((el) => el.getAttribute('aria-selected') === 'true');
  const perRow = getComputedStyle(views[kind].grid).gridTemplateColumns.split(' ').length;
  const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -perRow, ArrowDown: perRow }[key];
  const next = cards[Math.min(Math.max(at < 0 ? 0 : at + step, 0), cards.length - 1)];
  next.focus();
  next.scrollIntoView({ block: 'nearest' });
  select([...views[kind].cards].find(([, card]) => card.el === next)[0]);
}

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') return picker.cancel();
  // A focused button keeps its own Enter and Space.
  if (event.target.closest('button')) return;
  if (event.defaultPrevented) return;
  if (event.key === 'Enter') return confirm();
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
    event.preventDefault();
    walk(event.key);
  }
});

for (const [name, view] of Object.entries(views)) {
  view.tab.addEventListener('click', () => switchTo(name));
  view.tab.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 'window' : event.key === 'End' ? 'screen' : name === 'window' ? 'screen' : 'window';
    switchTo(next);
    views[next].tab.focus();
  });
}
$('cancel').addEventListener('click', () => picker.cancel());
$('close').addEventListener('click', () => picker.cancel());
$('settings').addEventListener('click', () => picker.openSettings());
window.addEventListener('focus', () => { if (views[kind].permission) void load(kind); });
$('show').addEventListener('click', () => confirm());
$('sound').addEventListener('click', () => {
  sound = !sound;
  $('sound').setAttribute('aria-checked', String(sound));
});
$('sound').hidden = !new URLSearchParams(location.search).get('sound');

paint();
// Both lists at once, so the other tab is there when it is opened; after that only the one on view is kept fresh.
Promise.all([load('window'), load('screen')]).then(refresh);
