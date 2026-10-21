import { useEffect, useRef, useState } from 'react';
import type { DrumItem } from './contract';

/** How many of `count` ticks a fill of 0…1 lights up. */
export function filled(fill: number, count: number) {
  return Math.round(Math.max(0, Math.min(1, fill)) * count);
}

/** A tick's state with `on` of `count` lit: lit, the next one (it breathes), or not yet. */
export function tickState(i: number, on: number, count: number): 'on' | 'next' | 'off' {
  if (i < on) return 'on';
  return i === on && on < count ? 'next' : 'off';
}

/** The lit count walks to its new value a tick at a time, so the scale sweeps rather than jumps. */
export function useSweep(target: number, stepMs = 8) {
  const [shown, setShown] = useState(target);
  const at = useRef(target);
  useEffect(() => {
    const timer = setInterval(() => {
      if (at.current === target) return clearInterval(timer);
      at.current += at.current < target ? 1 : -1;
      setShown(at.current);
    }, stepMs);
    return () => clearInterval(timer);
  }, [target, stepMs]);
  return shown;
}

/** The drum's motion: row height, how rows fade and shrink with their distance from the middle, the turn's length. */
export const drum = {
  row: 46,
  away: [0, 1, 2, 2.6],
  opacity: [1, 0.5, 0.2, 0],
  scaleAway: [0, 2],
  scale: [1, 0.9],
  turnMs: 520,
} as const;

/** Where the drum stands: on the running step, else just after the last one done (on the first before anything ran). */
export function drumAt(items: readonly DrumItem[], current: string | null) {
  const running = items.findIndex((item) => item.id === current && item.state !== 'done');
  if (running >= 0) return running;
  const lastDone = items.reduce((last, item, i) => (item.state === 'done' ? i : last), -1);
  return Math.max(0, Math.min(lastDone + 1, items.length - 1));
}

/** A value along piecewise-linear stops, clamped at the ends (what Reanimated's interpolate does with CLAMP). */
export function interpolate(x: number, from: readonly number[], to: readonly number[]) {
  if (x <= from[0]!) return to[0]!;
  for (let i = 1; i < from.length; i++) {
    if (x <= from[i]!) return to[i - 1]! + ((x - from[i - 1]!) / (from[i]! - from[i - 1]!)) * (to[i]! - to[i - 1]!);
  }
  return to[to.length - 1]!;
}
