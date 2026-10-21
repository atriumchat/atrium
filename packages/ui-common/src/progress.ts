import { useEffect, useRef, useState } from 'react';

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
