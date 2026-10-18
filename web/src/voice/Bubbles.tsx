import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { Popover } from '@heroui/react';
import { useStore } from '../store';
import type { User } from '../types';
import { VolumeSlider } from '../ui/ui';
import { HeadphonesSlashIcon, MicSlashIcon } from '../ui/icons';
import { useT } from '../i18n';

/**
 * People in a call drawn as photo circles instead of tiles. Three layouts:
 * - BubbleCloud: a voice room. Everyone in a fixed honeycomb; whoever talks grows and the neighbours only
 *   step aside, then return.
 * - BubblePair: a call of two or three. Big circles side by side; the one talking is a bit bigger.
 * - BubblePeanut: a group call. The speaker fills the left lobe, everyone else sits in fixed places in the
 *   right lobe; when someone else takes over, the left lobe deflates into the right and inflates again.
 * Positions are written straight to the DOM every frame, so React only renders when the people change. The
 * frame loop sleeps once everything has settled and wakes when the people, who's talking or the size change.
 * A circle never changes its width or height while it moves: it is drawn once at its biggest size and each frame
 * only moves and scales it with a transform. Resizing the box every frame made the browser lay it out and
 * repaint it, and it left the old edge pixels behind when the circle shrank.
 */

export type BubblePerson = {
  id: string;
  muted?: boolean;
  deafened?: boolean;
  /** Being rung, not in the call yet: drawn faded and pulsing. */
  ringing?: boolean;
};

type Props = {
  people: BubblePerson[];
  speaking: string[];
  /** Clicking someone else opens their volume; only makes sense once we're connected. */
  live: boolean;
};

const GAP = 8;

function useBox(ref: RefObject<HTMLElement | null>) {
  const [box, setBox] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // The size right away (before the first paint), then on every change.
    setBox({ w: el.clientWidth, h: el.clientHeight });
    const ro = new ResizeObserver(([e]) => setBox({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return box;
}

/**
 * Calls `step` with the time in seconds on every animation frame while it returns true (still moving); once it
 * returns false the loop stops, so a quiet call costs no CPU. The loop restarts whenever `deps` change.
 */
function useFrame(step: (t: number) => boolean, deps: unknown[]) {
  const ref = useRef(step);
  ref.current = step;
  const raf = useRef(0);
  useEffect(
    () => () => {
      cancelAnimationFrame(raf.current);
      raf.current = 0;
    },
    [],
  );
  useEffect(() => {
    if (raf.current) return;
    const loop = (now: number) => {
      raf.current = ref.current(now / 1000) ? requestAnimationFrame(loop) : 0;
    };
    raf.current = requestAnimationFrame(loop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

/** Below this many pixels of movement per frame the eye can't tell, so the layout counts as settled. */
const SETTLED = 0.05;

// One Set per `speaking` array, not one per frame.
const speakingSets = new WeakMap<readonly string[], Set<string>>();
function asSet(list: readonly string[]) {
  let set = speakingSets.get(list);
  if (!set) speakingSets.set(list, (set = new Set(list)));
  return set;
}

/**
 * Puts a bubble's wrapper at the centre (x, y) and hands the parts inside its radius: the disc scales by
 * --bubble-s, the badge and the nick tag follow --bubble-r and keep their own size. `max` is the radius the
 * disc was drawn at (the biggest it gets).
 */
function place(el: HTMLElement | null | undefined, x: number, y: number, r: number, max: number) {
  if (!el) return;
  el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
  el.style.setProperty('--bubble-r', r.toFixed(1));
  el.style.setProperty('--bubble-s', (r / max).toFixed(4));
}

/** A circle drawn with `fullSize(max)`, moved and scaled to (x, y, r). */
function placeDisc(el: HTMLElement | null | undefined, x: number, y: number, r: number, max: number) {
  if (!el) return;
  el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) scale(${(r / max).toFixed(4)})`;
}

/** The box of a circle at its biggest, centred on the origin of whatever holds it. It never changes after that. */
function fullSize(max: number): CSSProperties {
  return { width: max * 2, height: max * 2, margin: -max };
}

/** Pushes overlapping circles apart. `weight(a)` is how much of the push `a` takes (0 = it stays put). */
function separate<T extends { x: number; y: number; r: number }>(list: T[], weight: (a: T, b: T) => number, passes = 6) {
  for (let k = 0; k < passes; k++) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i], b = list[j];
        const dx = b.x - a.x, dy = b.y - a.y;
        const d = Math.hypot(dx, dy) || 0.01;
        const min = a.r + b.r + GAP;
        if (d >= min) continue;
        const wa = weight(a, b);
        const push = min - d, ux = dx / d, uy = dy / d;
        a.x -= ux * push * wa; a.y -= uy * push * wa;
        b.x += ux * push * (1 - wa); b.y += uy * push * (1 - wa);
      }
    }
  }
}

/* ---------- one person ---------- */

function Face({ user }: { user: User | undefined }) {
  if (user?.avatarUrl) return <img src={user.avatarUrl} alt="" draggable={false} className="h-full w-full object-cover" />;
  const letter = (user?.name ?? '?').trim().charAt(0).toUpperCase() || '?';
  return (
    <span className="flex h-full w-full items-center justify-center font-medium text-white" style={{ background: user?.color ?? 'var(--default)' }}>
      <span className="bubble-letter">{letter}</span>
    </span>
  );
}

/**
 * A circle placed by the layout, which moves the wrapper and sets --bubble-r / --bubble-s on it (see `place`).
 * The disc inside is `max` pixels in radius for good and only scaled; the mute badge and the nick tag sit
 * outside it so they keep their size. Shows the nick on hover; a click on someone else, once connected, opens
 * their volume.
 */
function Bubble(props: { person: BubblePerson; nodeRef: (el: HTMLDivElement | null) => void; live: boolean; max: number; tag?: boolean; badge?: boolean }) {
  const { t } = useT();
  const { person, live, max, tag = true, badge = true } = props;
  const user = useStore((s) => s.users[person.id]);
  const isMe = useStore((s) => s.me?.id === person.id);
  const name = user?.name ?? '…';
  const off = person.muted || person.deafened;

  const face = (
    <span className={`block h-full w-full overflow-hidden rounded-full bg-default ${person.ringing ? 'opacity-40' : ''}`}>
      <Face user={user} />
    </span>
  );

  return (
    <div ref={props.nodeRef} className="group absolute left-0 top-0 h-0 w-0 will-change-transform">
      <div
        className={`absolute left-0 top-0 rounded-full will-change-transform ${person.ringing ? 'call-ringing' : ''}`}
        style={{ ...fullSize(max), transform: 'scale(var(--bubble-s, 0))' }}
      >
        {live && !isMe && !person.ringing ? (
          <Popover>
            <Popover.Trigger aria-label={t('voice.volume', { name })} className="block h-full w-full cursor-pointer rounded-full outline-none data-[focus-visible=true]:ring-2 data-[focus-visible=true]:ring-white">
              {face}
            </Popover.Trigger>
            <Popover.Content placement="bottom" className="w-64">
              <Popover.Dialog className="p-5">
                <VolumeSlider userId={person.id} name={name} />
              </Popover.Dialog>
            </Popover.Content>
          </Popover>
        ) : (
          <span role="img" aria-label={person.ringing ? t('voice.ringingAria', { name }) : isMe ? `${name} ${t('voice.you')}` : name} className="block h-full w-full">
            {face}
          </span>
        )}
      </div>
      {badge && off && (
        // Its bottom right corner sits 6% in from the circle's, whatever the circle's size.
        <span
          className="absolute left-0 top-0 flex h-7 w-7 items-center justify-center rounded-full bg-default text-white ring-4 ring-[var(--app-window)] will-change-transform"
          style={{ transform: 'translate(calc(var(--bubble-r) * 0.88px - 28px), calc(var(--bubble-r) * 0.88px - 28px))' }}
        >
          {person.deafened ? <HeadphonesSlashIcon size={15} /> : <MicSlashIcon size={15} />}
        </span>
      )}
      {tag && (
        // A point 10px above the top of the circle; the tag hangs from it, centred.
        <div className="absolute left-0 top-0 z-10 h-0 w-0 will-change-transform" style={{ transform: 'translateY(calc(var(--bubble-r) * -1px - 10px))' }}>
          <span className="pointer-events-none absolute bottom-0 left-0 -translate-x-1/2 translate-y-1 whitespace-nowrap rounded-full bg-default px-3 py-2 text-[13px] font-medium leading-none text-white opacity-0 shadow-[0_2px_10px_rgba(0,0,0,.35)] transition-[opacity,transform] duration-150 group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:translate-y-0 group-focus-within:opacity-100">
            {name}
          </span>
        </div>
      )}
    </div>
  );
}

function useNodeRefs() {
  const els = useRef(new Map<string, HTMLDivElement>());
  const refFor = (id: string) => (el: HTMLDivElement | null) => {
    if (el) els.current.set(id, el);
    else els.current.delete(id);
  };
  return { els, refFor };
}

/* ---------- voice room: the cloud ---------- */

// Rows of the packed layout for each head count; neighbouring rows that differ by one nest (honeycomb).
const ROWS: Record<number, number[]> = { 1: [1], 2: [2], 3: [3], 4: [1, 2, 1], 5: [3, 2], 6: [3, 2, 1], 7: [2, 3, 2], 8: [3, 2, 3], 9: [3, 4, 2], 10: [3, 4, 3] };

function rowsFor(n: number) {
  if (ROWS[n]) return ROWS[n];
  const cols = Math.ceil(Math.sqrt(n * 1.2));
  const rows: number[] = [];
  for (let left = n, k = 0; left > 0; k++) {
    const c = Math.min(left, k % 2 ? cols - 1 : cols);
    rows.push(c);
    left -= c;
  }
  return rows;
}

function rowOffsets(rows: number[], step: number) {
  const ys = [0];
  for (let i = 1; i < rows.length; i++) {
    const nested = Math.abs(rows[i] - rows[i - 1]) % 2 === 1;
    ys.push(ys[i - 1] + (nested ? (step * Math.sqrt(3)) / 2 : step));
  }
  return ys;
}

const GROW = 0.6;

/** The biggest circle (up to 70px radius) that fits the room with space for one to grow. */
function cloudRadius(n: number, w: number, h: number) {
  const rows = rowsFor(n);
  for (let R = 70; R > 22; R -= 2) {
    const step = R * 2 + GAP;
    const ys = rowOffsets(rows, step);
    const wide = Math.max(...rows) * step + R * 2 * GROW;
    const tall = ys[ys.length - 1] + R * 2 * (1 + GROW);
    if (wide <= w - 32 && tall <= h - 24) return R;
  }
  return 22;
}

/** `px`/`py`/`pr`: where the circle was last frame, to tell when everything has stopped. */
type CloudNode = { id: string; x: number; y: number; r: number; grow: number; hx: number; hy: number; px: number; py: number; pr: number };

export function BubbleCloud({ people, speaking, live }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const { w, h } = useBox(box);
  const { els, refFor } = useNodeRefs();
  const nodes = useRef(new Map<string, CloudNode>());
  const R = useMemo(() => cloudRadius(people.length, w, h), [people.length, w, h]);
  // The biggest a circle gets, which is what each one is drawn at.
  const max = R * (1 + GROW);
  const latest = useRef({ people, speaking, w, h, R, max });
  latest.current = { people, speaking, w, h, R, max };
  const layoutKey = useRef('');
  // The last people/size the layout was worked out for, so a frame with nothing new skips it.
  const layoutOf = useRef<{ people: BubblePerson[] | null; w: number; h: number }>({ people: null, w: 0, h: 0 });
  const list = useRef<CloudNode[]>([]);

  useFrame(() => {
    const { people, speaking, w, h, R, max } = latest.current;
    if (!w || !h || people.length === 0) return false;
    const seen = layoutOf.current;
    const changed = seen.people !== people || seen.w !== w || seen.h !== h;
    if (changed) layoutOf.current = { people, w, h };
    const key = changed ? `${people.map((p) => p.id).join(',')}|${Math.round(w)}x${Math.round(h)}` : layoutKey.current;
    if (key !== layoutKey.current) {
      // New head count or size: fresh places, in order of joining.
      layoutKey.current = key;
      const rows = rowsFor(people.length);
      const step = R * 2 + GAP;
      const ys = rowOffsets(rows, step);
      const top = h / 2 - ys[ys.length - 1] / 2;
      let i = 0;
      const next = new Map<string, CloudNode>();
      rows.forEach((count, r) => {
        for (let c = 0; c < count; c++, i++) {
          const id = people[i].id;
          const hx = w / 2 + (c - (count - 1) / 2) * step, hy = top + ys[r];
          const old = nodes.current.get(id);
          next.set(id, old ? { ...old, hx, hy } : { id, x: hx, y: hy, r: R, grow: 0, hx, hy, px: 0, py: 0, pr: 0 });
        }
      });
      nodes.current = next;
      list.current = [...next.values()];
    }
    const talking = asSet(speaking);
    // Only whoever talks changes size; everyone heads back to their own place and steps aside just enough.
    for (const n of list.current) {
      n.px = n.x; n.py = n.y; n.pr = n.r;
      n.grow += ((talking.has(n.id) ? 1 : 0) - n.grow) * 0.08;
      n.r = R * (1 + GROW * n.grow);
      n.x += (n.hx - n.x) * 0.15;
      n.y += (n.hy - n.y) * 0.15;
    }
    separate(list.current, (a, b) => (talking.has(a.id) && !talking.has(b.id) ? 0.1 : talking.has(b.id) && !talking.has(a.id) ? 0.9 : 0.5));
    let moved = changed ? Infinity : 0;
    for (const n of list.current) {
      place(els.current.get(n.id), n.x, n.y, n.r, max);
      moved = Math.max(moved, Math.abs(n.x - n.px), Math.abs(n.y - n.py), Math.abs(n.r - n.pr));
    }
    return moved > SETTLED;
  }, [people, speaking, w, h]);

  return (
    <div ref={box} className="relative min-h-0 flex-1 overflow-hidden">
      {people.map((p) => (
        <Bubble key={p.id} person={p} nodeRef={refFor(p.id)} live={live} max={max} />
      ))}
    </div>
  );
}

/* ---------- two or three people: side by side ---------- */

type PairNode = { id: string; x: number; y: number; r: number; grow: number; px: number; py: number; pr: number };

// How much bigger than its resting size the one talking gets.
const PAIR_GROW = 0.32;

/** Big circles with room for the one talking to grow. */
function pairRadius(n: number, w: number, h: number) {
  return Math.max(32, Math.min(96, (h - 16) / 2 / (1 + PAIR_GROW), (w - 48) / (n * 2 + 0.7) - GAP));
}

export function BubblePair({ people, speaking, live }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const { w, h } = useBox(box);
  const { els, refFor } = useNodeRefs();
  const nodes = useRef(new Map<string, PairNode>());
  const R = pairRadius(people.length, w, h);
  // The biggest a circle gets, which is what each one is drawn at.
  const max = R * (1 + PAIR_GROW);
  const latest = useRef({ people, speaking, w, h, R, max });
  latest.current = { people, speaking, w, h, R, max };

  const list = useRef<PairNode[]>([]);
  const listFor = useRef<BubblePerson[] | null>(null);

  useFrame(() => {
    const { people, speaking, w, h, R, max } = latest.current;
    if (!w || !h || people.length === 0) return false;
    const n = people.length;
    const cx = w / 2, cy = h / 2;
    if (listFor.current !== people) {
      listFor.current = people;
      const next = new Map<string, PairNode>();
      people.forEach((p, i) => {
        const old = nodes.current.get(p.id);
        next.set(p.id, old ?? { id: p.id, x: cx + (i - (n - 1) / 2) * (R * 2 + GAP), y: cy, r: R, grow: 0, px: 0, py: 0, pr: 0 });
      });
      nodes.current = next;
      // In the order of `people`, so a node's index is its place in the row.
      list.current = [...next.values()];
    }
    const talking = asSet(speaking);
    const anyone = people.some((p) => talking.has(p.id) && !p.ringing);
    list.current.forEach((node, i) => {
      node.px = node.x; node.py = node.y; node.pr = node.r;
      const on = talking.has(node.id);
      node.grow += ((on ? 1 : 0) - node.grow) * 0.06;
      node.r = R * (1 + PAIR_GROW * node.grow) * (anyone && !on ? 0.95 : 1);
      // Pulled to the middle in a row, never overlapping: side by side with one small gap.
      node.x += (cx + (i - (n - 1) / 2) * (R * 2 + GAP) - node.x) * 0.05;
      node.y += (cy - node.y) * 0.08;
    });
    separate(list.current, () => 0.5, 3);
    let moved = 0;
    for (const node of list.current) {
      place(els.current.get(node.id), node.x, node.y, node.r, max);
      moved = Math.max(moved, Math.abs(node.x - node.px), Math.abs(node.y - node.py), Math.abs(node.r - node.pr));
    }
    return moved > SETTLED;
  }, [people, speaking, w, h]);

  return (
    <div ref={box} className="relative min-h-0 flex-1 overflow-hidden">
      {people.map((p) => (
        <Bubble key={p.id} person={p} nodeRef={refFor(p.id)} live={live} max={max} />
      ))}
    </div>
  );
}

/* ---------- a group: the peanut ---------- */

// Proportions from the reference, at full size: the left lobe (speaker) and the right lobe (everyone).
const P = { R1: 94, R2: 79, D: 200, RING: 13, NICK_H: 28, NICK_GAP: 10 };
const WAIST = 0.65, HANDLE = 2.4;
const SWAP = 1.4;
const MAX_PLACES = 9;
// Fixed places in the right lobe as [x, y, radius] in percent of its radius, loose like the reference.
// Everyone owns one; the speaker's stays empty until they come back to it.
const SLOTS: Record<number, number[][]> = {
  3: [[-6, 37, 36], [-26, -33, 30], [34, -18, 25]],
  4: [[26, -32, 35], [-24, 27, 28], [35, 32, 24], [-36, -27, 21]],
  5: [[-1, -44, 34], [20, 21, 28], [-45, 2, 23], [-27, 50, 20], [53, -21, 18]],
  6: [[21, 42, 33], [13, -48, 27], [-24, -3, 23], [52, -10, 20], [-39, -48, 18], [-35, 41, 16]],
  7: [[28, 40, 33], [-36, -41, 27], [20, -53, 23], [-33, 13, 20], [-27, 57, 18], [3, -10, 16], [40, -13, 14]],
  8: [[44, 25, 33], [-41, -21, 27], [45, -38, 23], [-8, 56, 20], [0, -53, 18], [-42, 29, 16], [7, -15, 14], [-8, 16, 13]],
  9: [[-30, -39, 33], [-41, 34, 27], [39, 23, 23], [6, 61, 20], [55, -22, 18], [26, -50, 16], [-72, -4, 14], [18, -15, 13], [-1, 11, 12]],
};

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const ease = (s: number) => (s < 0.5 ? 4 * s * s * s : 1 - Math.pow(-2 * s + 2, 3) / 2);
const lerp = (a: number, b: number, f: number) => a + (b - a) * f;
type Pt = { x: number; y: number };
const curve = (a: Pt, c: Pt, b: Pt, f: number): Pt => ({
  x: (1 - f) * (1 - f) * a.x + 2 * (1 - f) * f * c.x + f * f * b.x,
  y: (1 - f) * (1 - f) * a.y + 2 * (1 - f) * f * c.y + f * f * b.y,
});

/** The smooth bridge between two circles (a metaball neck) as an SVG path; empty when one is inside the other. */
function bridge(r1: number, r2: number, c1: Pt, c2: Pt) {
  const d = Math.hypot(c1.x - c2.x, c1.y - c2.y);
  if (!r1 || !r2 || d > r1 + r2 * 2.5 || d <= Math.abs(r1 - r2)) return '';
  let u1 = 0, u2 = 0;
  if (d < r1 + r2) {
    u1 = Math.acos((r1 * r1 + d * d - r2 * r2) / (2 * r1 * d));
    u2 = Math.acos((r2 * r2 + d * d - r1 * r1) / (2 * r2 * d));
  }
  const angle = Math.atan2(c2.y - c1.y, c2.x - c1.x), spread = Math.acos((r1 - r2) / d);
  const toward = (c: Pt, a: number, r: number) => ({ x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) });
  const a1 = angle + u1 + (spread - u1) * WAIST, a2 = angle - u1 - (spread - u1) * WAIST;
  const a3 = angle + Math.PI - u2 - (Math.PI - u2 - spread) * WAIST, a4 = angle - Math.PI + u2 + (Math.PI - u2 - spread) * WAIST;
  const p1 = toward(c1, a1, r1), p2 = toward(c1, a2, r1), p3 = toward(c2, a3, r2), p4 = toward(c2, a4, r2);
  const k = Math.min(WAIST * HANDLE, Math.hypot(p1.x - p3.x, p1.y - p3.y) / (r1 + r2)) * Math.min(1, (d * 2) / (r1 + r2));
  const h1 = toward(p1, a1 - Math.PI / 2, r1 * k), h2 = toward(p2, a2 + Math.PI / 2, r1 * k);
  const h3 = toward(p3, a3 + Math.PI / 2, r2 * k), h4 = toward(p4, a4 - Math.PI / 2, r2 * k);
  const f = (q: Pt) => `${q.x.toFixed(1)} ${q.y.toFixed(1)}`;
  return `M ${f(p1)} C ${f(h1)} ${f(h3)} ${f(p3)} L ${f(c2)} L ${f(p4)} C ${f(h4)} ${f(h2)} ${f(p2)} L ${f(c1)} Z`;
}

type Swap = { out: string; inc: string; t0: number; up: number };

/** Everything scales with the space we have, centred, with room for the nick under the left lobe. */
function peanutScale(w: number, h: number) {
  return Math.max(0.05, Math.min(1, (h - 8) / (P.R1 * 2 + P.NICK_GAP + P.NICK_H + 8), (w - 32) / (P.R1 + P.D + P.R2)));
}

/**
 * Who sits in the left lobe. A new speaker takes over only after talking for a moment while the current one
 * is quiet, so a quick "uh-huh" doesn't send the bubbles flying.
 */
class SpeakerPicker {
  speaker = '';
  private since = new Map<string, number>();
  private lastHeard = new Map<string, number>();
  private lastSwap = -99;

  /** Returns who just handed over the left lobe, if anyone. */
  step(t: number, present: string[], talking: Set<string>, busy: boolean): string | null {
    for (const id of present) {
      if (talking.has(id)) {
        if (!this.since.has(id)) this.since.set(id, t);
        this.lastHeard.set(id, t);
      } else this.since.delete(id);
    }
    if (!present.includes(this.speaker)) {
      // First frame, or the speaker left the call: take someone straight away, no animation.
      this.speaker = present.find((id) => talking.has(id)) ?? present[0] ?? '';
      return null;
    }
    if (busy || t - this.lastSwap < 1.5) return null;
    const quiet = t - (this.lastHeard.get(this.speaker) ?? -99) > 0.8;
    const next = present.find((id) => id !== this.speaker && t - (this.since.get(id) ?? t) >= 0.6);
    if (!next || !quiet) return null;
    this.lastSwap = t;
    const out = this.speaker;
    this.speaker = next;
    return out;
  }
}

export function BubblePeanut({ people, speaking, live }: Props) {
  const { t } = useT();
  const box = useRef<HTMLDivElement>(null);
  const { w, h } = useBox(box);
  const { els, refFor } = useNodeRefs();
  const lobe = useRef<HTMLDivElement>(null);
  const shapes = useRef<(HTMLDivElement | null)[]>([]);
  const bridges = useRef<(HTMLDivElement | null)[]>([]);
  const nick = useRef<HTMLDivElement>(null);
  const nickText = useRef<HTMLSpanElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const swap = useRef<Swap | null>(null);
  const picker = useRef(new SpeakerPicker());
  const latest = useRef({ people, speaking, w, h });
  latest.current = { people, speaking, w, h };
  const users = useStore((s) => s.users);
  const names = useRef(users);
  names.current = users;

  const total = people.length;
  const places = Math.min(total, MAX_PLACES);
  const extra = total > MAX_PLACES ? total - (MAX_PLACES - 1) : 0;
  const shown = extra ? people.slice(0, MAX_PLACES - 1) : people;
  // The radius each part is drawn at, its biggest: the photos, the white behind the ones on the move (photo
  // plus ring), the right lobe, and the "+N" place (which never changes size).
  const k = peanutScale(w, h);
  const bigMax = (P.R1 - P.RING) * k, shapeMax = P.R1 * k, lobeMax = P.R2 * k;
  const tipMax = extra ? (SLOTS[Math.max(3, places)][places - 1][2] * lobeMax) / 100 : 0;

  // Who's in sight and who's talking, worked out when those change rather than every frame.
  const derived = useRef<{ people: BubblePerson[] | null; speaking: string[] | null; ids: string[]; talking: Set<string> }>({
    people: null,
    speaking: null,
    ids: [],
    talking: new Set(),
  });

  useFrame((t) => {
    const { people, speaking, w, h } = latest.current;
    if (!w || !h || people.length < 2) return false;
    const seen = derived.current;
    if (seen.people !== people || seen.speaking !== speaking) {
      const visible = people.length > MAX_PLACES ? people.slice(0, MAX_PLACES - 1) : people;
      derived.current = {
        people,
        speaking,
        ids: visible.map((p) => p.id),
        talking: new Set(speaking.filter((id) => !people.find((p) => p.id === id)?.ringing)),
      };
    }
    const { ids, talking } = derived.current;

    const k = peanutScale(w, h);
    const R1 = P.R1 * k, R2 = P.R2 * k, D = P.D * k, RING = P.RING * k;
    const cy = (h - (P.NICK_GAP + P.NICK_H) * k) / 2;
    const C1 = { x: (w - (R1 + D + R2)) / 2 + R1, y: cy };
    const C2 = { x: C1.x + D, y: cy };
    const BIG = R1 - RING;
    const slots = SLOTS[Math.max(3, places)].map(([x, y, r]) => ({ x: C2.x + (x * R2) / 100, y: C2.y + (y * R2) / 100, r: (r * R2) / 100 }));
    const slotOf = (id: string) => slots[Math.max(0, people.findIndex((p) => p.id === id))];
    const inflate = (x: number) => ease(clamp01((C2.x - R2 + 10 * k - x) / (C2.x - R2 + 10 * k - C1.x)));

    // A swap runs to the end before the next one can start.
    if (swap.current && t - swap.current.t0 >= SWAP) swap.current = null;
    const out = picker.current.step(t, ids, talking, !!swap.current);
    const speaker = picker.current.speaker;
    if (out) swap.current = { out, inc: speaker, t0: t, up: slotOf(out).y < slotOf(speaker).y ? -1 : 1 };

    const sw = swap.current;
    const s = sw ? clamp01((t - sw.t0) / SWAP) : 1;
    const mid = (C1.x + C2.x) / 2;
    const pose = (id: string) => {
      const slot = slotOf(id);
      if (sw && id === sw.out) {
        // The old speaker's bubble deflates and flows through the waist back into their place.
        const f = ease(clamp01(s / 0.65));
        const at = curve(C1, { x: mid, y: cy + sw.up * 20 * k }, slot, f);
        return { ...at, r: lerp(slot.r, BIG, inflate(at.x)), ring: RING, move: true };
      }
      if (sw && id === sw.inc) {
        // The new one leaves their place and inflates into the left lobe.
        const f = ease(clamp01((s - 0.35) / 0.65));
        const at = curve(slot, { x: mid, y: cy - sw.up * 20 * k }, C1, f);
        return { ...at, r: lerp(slot.r, BIG, inflate(at.x)), ring: RING * clamp01(f * 4), move: f > 0 };
      }
      if (id === speaker) return { ...C1, r: BIG, ring: RING, move: true };
      return { ...slot, ring: 0, move: false };
    };

    placeDisc(lobe.current, C2.x, C2.y, R2, R2);
    let shapeIndex = 0;
    for (const id of ids) {
      const q = pose(id);
      place(els.current.get(id), q.x, q.y, q.r, BIG);
      const el = els.current.get(id);
      if (el) el.style.zIndex = q.move ? '2' : '1';
      if (!q.move) continue;
      const shape = shapes.current[shapeIndex], br = bridges.current[shapeIndex];
      shapeIndex++;
      const r = q.r + q.ring;
      if (shape) {
        shape.style.display = 'block';
        placeDisc(shape, q.x, q.y, r, R1);
      }
      if (br) {
        const d = bridge(r, R2, q, C2);
        br.style.display = d ? 'block' : 'none';
        if (d) br.style.clipPath = `path('${d}')`;
      }
    }
    for (let i = shapeIndex; i < 2; i++) {
      if (shapes.current[i]) shapes.current[i]!.style.display = 'none';
      if (bridges.current[i]) bridges.current[i]!.style.display = 'none';
    }
    if (tipRef.current && extra) {
      const tip = slots[places - 1];
      placeDisc(tipRef.current, tip.x, tip.y, tip.r, tip.r);
    }

    // The speaker's nick under the left lobe: fades out as they leave, back in once the new one is in place.
    const fade = sw ? (s < 0.3 ? 1 - s / 0.3 : s > 0.7 ? (s - 0.7) / 0.3 : 0) : 1;
    const o = fade * fade * (3 - 2 * fade);
    if (nick.current && nickText.current) {
      const who = sw && s < 0.5 ? sw.out : speaker;
      const name = names.current[who]?.name ?? '';
      if (nickText.current.textContent !== name) nickText.current.textContent = name;
      nick.current.style.opacity = o.toFixed(3);
      nick.current.style.transform = `translate(${C1.x.toFixed(1)}px, ${(cy + R1 + P.NICK_GAP * k + (1 - o) * 6).toFixed(1)}px) translateX(-50%) scale(${lerp(0.92, 1, o).toFixed(3)})`;
    }

    // Without a swap every pose is fixed, so the loop can sleep, unless someone besides the speaker is
    // talking: the picker may hand them the left lobe in a moment, and it needs the clock for that.
    if (swap.current) return true;
    for (const id of talking) if (id !== speaker && ids.includes(id)) return true;
    return false;
  }, [people, speaking, w, h, users]);

  return (
    <div ref={box} className="relative min-h-0 flex-1 overflow-hidden">
      <div ref={lobe} className="absolute left-0 top-0 rounded-full bg-white will-change-transform" style={fullSize(lobeMax)} />
      {[0, 1].map((i) => (
        <div key={i} ref={(el) => void (shapes.current[i] = el)} className="absolute left-0 top-0 hidden rounded-full bg-white will-change-transform" style={fullSize(shapeMax)} />
      ))}
      {[0, 1].map((i) => (
        <div key={i} ref={(el) => void (bridges.current[i] = el)} className="absolute inset-0 hidden bg-white" />
      ))}
      <div ref={nick} className="pointer-events-none absolute left-0 top-0 flex h-7 max-w-[220px] items-center rounded-full bg-white px-3.5 text-[13px] font-medium text-black opacity-0">
        <span ref={nickText} className="min-w-0 truncate" />
      </div>
      {shown.map((p) => (
        <Bubble key={p.id} person={p} nodeRef={refFor(p.id)} live={live} max={bigMax} badge={false} />
      ))}
      {extra > 0 && (
        <div ref={tipRef} role="img" aria-label={t('voice.moreAria', { count: extra })} className="absolute left-0 top-0 flex items-center justify-center rounded-full bg-[#e5e5ea] text-[13px] font-medium text-black" style={fullSize(tipMax)}>
          +{extra}
        </div>
      )}
    </div>
  );
}
