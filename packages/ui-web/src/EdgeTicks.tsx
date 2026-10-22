import { useEffect, useMemo, useRef, useState } from 'react';
import { edgeTicks, filled, rulerTicks, scale, tickState, useSweep } from '@atrium/ui-common';

/**
 * A flow's progress in ticks (DESIGN.md), the geometry from @atrium/ui-common: one scale for the whole way, the next
 * tick breathing. On a phone-sized window it runs round the window's edge (EdgeTicks); on a bigger one the edge is far
 * from the reading and would take a thousand ticks, so the same scale is unrolled into a ruler over the column
 * (TickRuler).
 */

/** A browser window has no known corner radius; this one reads as a phone's. */
const WINDOW_CORNER = 32;

function useWindowSize() {
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight });
  useEffect(() => {
    const sync = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', sync);
    return () => window.removeEventListener('resize', sync);
  }, []);
  return size;
}

/** Whether the window is phone-sized: the edge carries the ticks there, a ruler does elsewhere. */
export function useNarrow() {
  return useWindowSize().w <= scale.narrowTo;
}

const tickClass = { on: 'on', next: 'next', off: undefined } as const;

export function EdgeTicks({ fill }: { fill: number }) {
  const { w, h } = useWindowSize();
  const all = useMemo(() => edgeTicks(w, h, WINDOW_CORNER), [w, h]);
  const on = useSweep(filled(fill, all.length));
  return (
    <svg className="flow-ticks" width={w} height={h} aria-hidden="true">
      {all.map((t, i) => (
        <line key={i} {...t} className={tickClass[tickState(i, on, all.length)]} />
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
  const all = useMemo(() => rulerTicks(width), [width]);
  const on = useSweep(filled(fill, all.length));
  return (
    <div ref={box} className="flow-ruler" aria-hidden="true">
      <svg width={width} height={scale.rulerHeight}>
        {all.map((t, i) => (
          <line key={i} {...t} className={tickClass[tickState(i, on, all.length)]} />
        ))}
      </svg>
    </div>
  );
}
