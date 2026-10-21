import { radius, space } from './tokens';

/**
 * The scale's geometry (DESIGN.md): where the ticks stand, on a phone round the screen's edge and in a wide window as a
 * ruler over the column. Pure numbers, so every client draws the same scale and tests can check it.
 */
export const scale = {
  /** Between ticks, along the edge or the ruler. */
  gap: 9,
  /** The ticks' outer ends sit this far inside the screen. */
  inset: 4,
  /** Every `every`-th tick is long. */
  every: 5,
  long: 10,
  short: 6,
  stroke: 1.7,
  /** The ruler's height; a short tick starts this much lower than a long one. */
  rulerHeight: 12,
  rulerShortFrom: 4,
  /** The stretch of the top edge a camera island covers, with some air. */
  island: 140,
  /** Phone-sized windows (≤ this) carry the ticks on their edge. */
  narrowTo: 820,
} as const;

export type Tick = { x1: number; y1: number; x2: number; y2: number };

const KNOWN_CORNERS: readonly (readonly [number, number, number])[] = [
  [375, 812, 41.5], [414, 896, 41.5], [390, 844, 47.3], [428, 926, 53.3],
  [393, 852, 55], [430, 932, 55], [402, 874, 62], [440, 956, 62], [420, 912, 62],
];

/**
 * The display's corner radius, by screen size in points (Apple doesn't say it in an API): the phones since the X, the
 * nearest one for anything else; square for the ones with a home button.
 */
export function cornerRadius(width: number, height: number) {
  const [w, h] = [Math.min(width, height), Math.max(width, height)];
  if (h / w < 2) return 0;
  const distance = (k: readonly [number, number, number]) => Math.abs(k[0] - w) + Math.abs(k[1] - h);
  return KNOWN_CORNERS.reduce((best, k) => (distance(k) < distance(best) ? k : best))[2];
}

type Point = { x: number; y: number; nx: number; ny: number };

/** A point `s` along a rounded rectangle's edge (clockwise from the top middle) and the inward normal there. */
function along(s: number, w: number, h: number, r: number): Point {
  const straightW = w - 2 * r;
  const straightH = h - 2 * r;
  const arc = (Math.PI * r) / 2;
  const corner = (cx: number, cy: number, from: number) => (t: number) => {
    const a = from + (r ? t / r : 0);
    return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a), nx: -Math.cos(a), ny: -Math.sin(a) };
  };
  const segments: [number, (t: number) => Point][] = [
    [straightW / 2, (t) => ({ x: w / 2 + t, y: 0, nx: 0, ny: 1 })],
    [arc, corner(w - r, r, -Math.PI / 2)],
    [straightH, (t) => ({ x: w, y: r + t, nx: -1, ny: 0 })],
    [arc, corner(w - r, h - r, 0)],
    [straightW, (t) => ({ x: w - r - t, y: h, nx: 0, ny: -1 })],
    [arc, corner(r, h - r, Math.PI / 2)],
    [straightH, (t) => ({ x: 0, y: h - r - t, nx: 1, ny: 0 })],
    [arc, corner(r, r, Math.PI)],
    [straightW / 2, (t) => ({ x: r + t, y: 0, nx: 0, ny: 1 })],
  ];
  let left = s;
  for (const [length, at] of segments) {
    if (left <= length) return at(left);
    left -= length;
  }
  return { x: w / 2, y: 0, nx: 0, ny: 1 };
}

/**
 * The ticks round a screen (or window) this size with these corners, clockwise from the top middle, leaving out the
 * `island` stretch of the top edge a camera covers.
 */
export function edgeTicks(width: number, height: number, corner: number, island = 0): Tick[] {
  const { inset, gap, every, long, short } = scale;
  const w = width - inset * 2;
  const h = height - inset * 2;
  const r = Math.max(0, Math.min(corner - inset, w / 2, h / 2));
  const perimeter = 2 * (w - 2 * r) + 2 * (h - 2 * r) + 2 * Math.PI * r;
  const count = Math.floor(perimeter / gap);
  const all: Tick[] = [];
  for (let i = 0; i < count; i++) {
    const p = along((i / count) * perimeter, w, h, r);
    if (island && p.y < 1 && Math.abs(p.x - w / 2) < island / 2) continue;
    const length = i % every === 0 ? long : short;
    all.push({ x1: inset + p.x, y1: inset + p.y, x2: inset + p.x + p.nx * length, y2: inset + p.y + p.ny * length });
  }
  return all;
}

/** The scale unrolled into a ruler this wide: one tick per `gap`, filling from the left. */
export function rulerTicks(width: number): Tick[] {
  const { gap, every, rulerHeight, rulerShortFrom } = scale;
  const count = Math.max(0, Math.floor(width / gap) + 1);
  return Array.from({ length: count }, (_, i) => ({
    x1: i * gap + 1,
    x2: i * gap + 1,
    y1: i % every === 0 ? 0 : rulerShortFrom,
    y2: rulerHeight,
  }));
}

/**
 * A flow's side margin: concentric with the screen's corners (Apple's rule), so the buttons' radius stands the same
 * distance in from the edge as the screen's own corner; never less than `space.edgeMin`.
 */
export function concentricEdge(corner: number) {
  return Math.max(space.edgeMin, corner - radius.button);
}

/** Where a flow's content sits on a screen this size with these safe-area insets. */
export function flowFrame(width: number, height: number, insets: { top: number; bottom: number }) {
  const corner = cornerRadius(width, height);
  const edge = concentricEdge(corner);
  return {
    radius: corner,
    edge,
    top: Math.max(insets.top + 8, space.ring + 22),
    bottom: Math.max(edge, insets.bottom + 8),
    /** A camera island at the top: the top inset is 59 and more. */
    island: insets.top >= 59,
  };
}
