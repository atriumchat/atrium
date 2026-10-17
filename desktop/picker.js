// The screen-share picker window: live thumbnails of the windows and the screens. A choice goes to the main
// process, which hands it to getDisplayMedia; closing without one is a cancel.
const REFRESH = 2000;
const $ = (id) => document.getElementById(id);
const picker = window.gomexPicker;

const NOTES = { window: 'Нет окон для показа', screen: 'Нет экранов', error: 'Не удалось получить список' };

// One list per tab. A card is made once and then only updated, so a refresh never moves what the pointer is on.
const views = {
  window: { grid: $('window'), tab: $('tab-window'), cards: new Map(), loaded: false, failed: false },
  screen: { grid: $('screen'), tab: $('tab-screen'), cards: new Map(), loaded: false, failed: false },
};
let kind = 'window';
let selected = null; // the id of the chosen card, in the tab on view
let sound = true;

function paint() {
  const view = views[kind];
  for (const [name, other] of Object.entries(views)) {
    other.grid.hidden = name !== kind;
    other.tab.setAttribute('aria-selected', String(name === kind));
  }
  $('wait').hidden = view.loaded;
  $('note').hidden = !view.loaded || view.cards.size > 0;
  $('note').textContent = view.failed ? NOTES.error : NOTES[kind];
  $('show').disabled = selected === null;
}

function select(id) {
  selected = id;
  for (const [cardId, card] of views[kind].cards) card.el.setAttribute('aria-selected', String(cardId === id));
  $('show').disabled = id === null;
}

function confirm(id = selected) {
  if (id !== null) picker.choose(id, sound);
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
  thumb.append(image);
  const label = document.createElement('div');
  label.className = 'label';
  const icon = document.createElement('img');
  icon.alt = '';
  icon.draggable = false;
  icon.hidden = true;
  const name = document.createElement('span');
  label.append(icon, name);
  el.append(thumb, label);
  el.addEventListener('click', () => select(id));
  el.addEventListener('dblclick', () => confirm(id));
  return { el, image, icon, name, thumb: null };
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
  }
  for (const [id, card] of view.cards) {
    if (seen.has(id)) continue;
    card.el.remove();
    view.cards.delete(id);
    if (which === kind && selected === id) select(null);
  }
}

async function load(which) {
  const answer = await picker.list(which).catch(() => ({ error: true }));
  const view = views[which];
  view.failed = Boolean(answer.error);
  if (answer.sources) show(which, answer.sources);
  view.loaded = true;
  paint();
}

function switchTo(which) {
  if (which === kind) return;
  kind = which;
  select(null);
  paint();
  if (!views[which].loaded) load(which);
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
  const cards = [...views[kind].cards.values()].map((card) => card.el);
  if (!cards.length) return;
  const at = cards.findIndex((el) => el.getAttribute('aria-selected') === 'true');
  const perRow = cards.filter((el) => el.offsetTop === cards[0].offsetTop).length;
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
  if (event.key === 'Enter') return confirm();
  if (event.key.startsWith('Arrow')) {
    event.preventDefault();
    walk(event.key);
  }
  if (event.key === ' ' && event.target.classList.contains('card')) {
    event.preventDefault();
    event.target.click();
  }
});

for (const [name, view] of Object.entries(views)) view.tab.addEventListener('click', () => switchTo(name));
$('cancel').addEventListener('click', () => picker.cancel());
$('show').addEventListener('click', () => confirm());
$('sound').addEventListener('click', () => {
  sound = !sound;
  $('sound').setAttribute('aria-checked', String(sound));
});
$('sound').hidden = !new URLSearchParams(location.search).get('sound');

paint();
// Both lists at once, so the other tab is there when it is opened; after that only the one on view is kept fresh.
Promise.all([load('window'), load('screen')]).then(refresh);
