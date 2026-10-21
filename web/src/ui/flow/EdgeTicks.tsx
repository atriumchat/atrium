import { useEffect, useMemo, useRef, useState } from 'react';

/**
 * A flow's progress in ticks (DESIGN.md), as the phone app draws it along the screen's edge
 * (mobile/src/components/EdgeTicks.tsx): one scale for the whole way, the next tick breathing. On a phone-sized window
 * it runs round the window's edge (EdgeTicks); on a bigger one the edge is far from the reading and would take a
 * thousand ticks, so the same scale is unrolled into a ruler over the column (TickRuler).
 */

const GAP = 9;
const INSET = 4;

type Tick = { x1: number; y1: number; x2: number; y2: number };

function along(s: number, w: number, h: number, r: number) {
  const straightW = w - 2 * r;
  const straightH = h - 2 * r;
  const arc = (Math.PI * r) / 2;
  const corner = (cx: number, cy: number, from: number) => (t: number) => {
    const a = from + (r ? t / r : 0);
    return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a), nx: -Math.cos(a), ny: -Math.sin(a) };
  };
  const segments: [number, (t: number) => { x: number; y: number; nx: number; ny: number }][] = [
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

function ticks(width: number, height: number, radius: number): Tick[] {
  const w = width - INSET * 2;
  const h = height - INSET * 2;
  const r = Math.max(0, Math.min(radius - INSET, w / 2, h / 2));
  const perimeter = 2 * (w - 2 * r) + 2 * (h - 2 * r) + 2 * Math.PI * r;
  const count = Math.floor(perimeter / GAP);
  return Array.from({ length: count }, (_, i) => {
    const p = along((i / count) * perimeter, w, h, r);
    const length = i % 5 === 0 ? 10 : 6;
    return { x1: INSET + p.x, y1: INSET + p.y, x2: INSET + p.x + p.nx * length, y2: INSET + p.y + p.ny * length };
  });
}

function useWindowSize() {
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight });
  useEffect(() => {
    const sync = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', sync);
    return () => window.removeEventListener('resize', sync);
  }, []);
  return size;
}

/** The filled count walks to its new value a tick at a time, so the edge sweeps rather than jumps. */
function useSweep(target: number) {
  const [shown, setShown] = useState(target);
  const at = useRef(target);
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (at.current === target) return window.clearInterval(timer);
      at.current += at.current < target ? 1 : -1;
      setShown(at.current);
    }, 8);
    return () => window.clearInterval(timer);
  }, [target]);
  return shown;
}

/** Whether the window is phone-sized: the edge carries the ticks there, a ruler does elsewhere. */
export function useNarrow() {
  return useWindowSize().w <= 820;
}

export function EdgeTicks({ fill }: { fill: number }) {
  const { w, h } = useWindowSize();
  const all = useMemo(() => ticks(w, h, 32), [w, h]);
  const on = useSweep(Math.round(Math.max(0, Math.min(1, fill)) * all.length));
  return (
    <svg className="flow-ticks" width={w} height={h} aria-hidden="true">
      {all.map((t, i) => (
        <line key={i} {...t} className={i === on && on < all.length ? 'next' : i < on ? 'on' : undefined} />
      ))}
    </svg>
  );
}

/** The scale unrolled: a row of ticks across the column, filling from the left. */
export function TickRuler({ fill }: { fill: number }) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = box.current!;
    const ro = new ResizeObserver(([e]) => setWidth(e!.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const count = Math.max(0, Math.floor(width / GAP) + 1);
  const on = useSweep(Math.round(Math.max(0, Math.min(1, fill)) * count));
  return (
    <div ref={box} className="flow-ruler" aria-hidden="true">
      <svg width={width} height={12}>
        {Array.from({ length: count }, (_, i) => (
          <line key={i} x1={i * GAP + 1} x2={i * GAP + 1} y1={i % 5 === 0 ? 0 : 4} y2={12} className={i === on && on < count ? 'next' : i < on ? 'on' : undefined} />
        ))}
      </svg>
    </div>
  );
}
