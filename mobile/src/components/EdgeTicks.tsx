import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, useWindowDimensions } from 'react-native';
import Animated, { Easing, useAnimatedProps, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import Svg, { Line } from 'react-native-svg';

/**
 * A flow's progress along the edge of the phone's screen (DESIGN.md): ticks that follow its rounded corners, one scale
 * for the whole way, not one per step. They fill clockwise from the right of the camera island, the next one breathing;
 * the screen inside stays free for the step.
 */

const GAP = 9; // between ticks, along the edge
const INSET = 4; // the ticks' outer ends sit this far inside the screen
const AnimatedLine = Animated.createAnimatedComponent(Line);

/**
 * The display's corner radius, by screen size in points (Apple doesn't say it in an API): the phones since the X, the
 * nearest one for anything else; square for the ones with a home button.
 */
export function cornerRadius(width: number, height: number) {
  const [w, h] = [Math.min(width, height), Math.max(width, height)];
  if (h / w < 2) return 0;
  const known: [number, number, number][] = [
    [375, 812, 41.5], [414, 896, 41.5], [390, 844, 47.3], [428, 926, 53.3],
    [393, 852, 55], [430, 932, 55], [402, 874, 62], [440, 956, 62], [420, 912, 62],
  ];
  const nearest = known.reduce((best, k) => (Math.abs(k[0] - w) + Math.abs(k[1] - h) < Math.abs(best[0] - w) + Math.abs(best[1] - h) ? k : best));
  return nearest[2];
}

type Tick = { x1: number; y1: number; x2: number; y2: number };

/** A point `s` along a rounded rectangle's edge (clockwise from the top middle) and the inward normal there. */
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

/** The ticks around a screen this size, leaving out the stretch the camera island covers. */
function ticks(width: number, height: number, island: number): Tick[] {
  const w = width - INSET * 2;
  const h = height - INSET * 2;
  const r = Math.max(0, cornerRadius(width, height) - INSET);
  const perimeter = 2 * (w - 2 * r) + 2 * (h - 2 * r) + 2 * Math.PI * r;
  const count = Math.floor(perimeter / GAP);
  const all: Tick[] = [];
  for (let i = 0; i < count; i++) {
    const p = along((i / count) * perimeter, w, h, r);
    if (p.y < 1 && Math.abs(p.x - w / 2) < island / 2) continue;
    const length = i % 5 === 0 ? 10 : 6;
    all.push({ x1: INSET + p.x, y1: INSET + p.y, x2: INSET + p.x + p.nx * length, y2: INSET + p.y + p.ny * length });
  }
  // From the right of the island round to its left.
  const start = all.findIndex((tick) => tick.x1 > width / 2);
  return [...all.slice(start), ...all.slice(0, start)];
}

function Breathing(tick: Tick) {
  const opacity = useSharedValue(1);
  useEffect(() => {
    opacity.value = withRepeat(withTiming(0.3, { duration: 800, easing: Easing.inOut(Easing.quad) }), -1, true);
  }, [opacity]);
  const props = useAnimatedProps(() => ({ opacity: opacity.value }));
  return <AnimatedLine {...tick} stroke="#fff" strokeWidth={1.7} strokeLinecap="round" animatedProps={props} />;
}

/** The filled count walks to its new value a tick at a time, so the edge sweeps rather than jumps. */
function useSweep(target: number) {
  const [shown, setShown] = useState(target);
  const at = useRef(target);
  useEffect(() => {
    const timer = setInterval(() => {
      if (at.current === target) return clearInterval(timer);
      at.current += at.current < target ? 1 : -1;
      setShown(at.current);
    }, 8);
    return () => clearInterval(timer);
  }, [target]);
  return shown;
}

/** `island`: the phone has a camera island at the top (its top inset is 59 and more); it is about 126 points wide. */
export function EdgeTicks({ fill, island }: { fill: number; island: boolean }) {
  const { width, height } = useWindowDimensions();
  const all = useMemo(() => ticks(width, height, island ? 140 : 0), [width, height, island]);
  const on = useSweep(Math.round(Math.max(0, Math.min(1, fill)) * all.length));
  return (
    <Svg width={width} height={height} style={StyleSheet.absoluteFill} pointerEvents="none">
      {all.map((tick, i) =>
        i === on && on < all.length ? (
          <Breathing key={i} {...tick} />
        ) : (
          <Line key={i} {...tick} stroke={i < on ? '#f2f2f4' : 'rgba(255,255,255,0.13)'} strokeWidth={1.7} strokeLinecap="round" />
        ),
      )}
    </Svg>
  );
}
