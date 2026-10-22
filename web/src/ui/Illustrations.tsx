import type { CSSProperties } from 'react';
import { sketch, type Drawing, type Point, type Sketch } from './iso';

/*
 * Atrium's illustrations, in the landing's technique (gomex-site, the `step-art` drawings): white isometric line
 * drawings, a 0.9 line in the current colour, every face filled with the surface it sits on so it hides what is
 * behind it, secondary lines faint, dashes for whatever moves. The geometry is computed (iso.ts), not drawn by
 * hand. Each empty place in the app has its own object.
 */

const faint = { o: 0.45 };
const fainter = { o: 0.3 };
const dashed = { dash: '2 2.6', o: 0.3 };

/** A rectangle drawn flat on one of the object's faces: its four corners in order. */
function outline(s: Sketch, corners: Point[], style = faint) {
  s.line(corners, style, true);
}

/** An arrow coming straight down, its head in the plane that faces the viewer (as on the landing). */
function arrowDown(s: Sketch, x: number, y: number, from: number, to: number, style?: { dash?: string; o?: number }) {
  s.line([[x, y, from], [x, y, to]], style);
  s.line([[x - 1.8, y + 1.8, to + 3.5], [x, y, to], [x + 1.8, y - 1.8, to + 3.5]]);
}

/** A laptop with its lid up: the keyboard and trackpad on the base, the screen on the lid's face. */
function laptop(s: Sketch, x: number, y: number, w = 40, d = 26, lid = 24) {
  s.slab(x, y, 0, w, d, 2, 2);
  const keys = [x + w * 0.12, y + d * 0.22, x + w * 0.88, y + d * 0.58] as const;
  const pad = [x + w * 0.38, y + d * 0.67, x + w * 0.62, y + d * 0.88] as const;
  outline(s, [[keys[0], keys[1], 2], [keys[2], keys[1], 2], [keys[2], keys[3], 2], [keys[0], keys[3], 2]]);
  outline(s, [[pad[0], pad[1], 2], [pad[2], pad[1], 2], [pad[2], pad[3], 2], [pad[0], pad[3], 2]], fainter);
  s.slab(x + 1, y, 2, w - 2, 1.5, lid);
  outline(s, [[x + 4, y + 1.5, 5], [x + w - 4, y + 1.5, 5], [x + w - 4, y + 1.5, lid - 1], [x + 4, y + 1.5, lid - 1]]);
}

/** A phone lying face up, its top towards the back: the screen, and the toolbar line near the bottom. */
function phone(s: Sketch, x: number, y: number, w = 22, d = 40) {
  s.slab(x, y, 0, w, d, 2.5, 4.5);
  s.slab(x + 1.8, y + 1.8, 2.5, w - 3.6, d - 3.6, 0, 3, { plate: false, o: 0.45 });
  s.line([[x + 1.8, y + d - 8, 2.5], [x + w - 1.8, y + d - 8, 2.5]], fainter);
}

/** The "#" of a text channel, lying flat (ground outline, then its hole). */
const HASH: [number, number][] = [
  [6, 0], [11, 0], [11, 6], [19, 6], [19, 0], [24, 0], [24, 6], [30, 6], [30, 11], [24, 11], [24, 19], [30, 19], [30, 24], [24, 24],
  [24, 30], [19, 30], [19, 24], [11, 24], [11, 30], [6, 30], [6, 24], [0, 24], [0, 19], [6, 19], [6, 11], [0, 11], [0, 6], [6, 6],
];
const HASH_HOLE: [number, number][] = [[11, 11], [19, 11], [19, 19], [11, 19]];

const deg = (a: number) => (a * Math.PI) / 180;

export const ART = {
  /** A text channel with nothing in it yet: its "#" hovering over its shadow. */
  channel: sketch((s) => {
    s.circle(15, 15, 0, 19, dashed);
    s.float(() => s.prism([HASH, HASH_HOLE], 9, 4));
  }),

  /** A conversation nobody has written in: the message card with its cursor, and the send button. */
  chat: sketch((s) => {
    s.slab(0, 0, 0, 48, 20, 3, 5);
    s.line([[13, 10, 3], [30, 10, 3]], { dash: '1.5 2.5', o: 0.35 });
    s.line([[8.5, 10, 3], [8.5, 10, 8.5]], { w: 1.1, cls: 'art-cursor' });
    s.cylinder(40, 10, 3, 3.6, 2);
    s.line([[40, 11.6, 5], [40, 8, 5]], faint);
    s.line([[38.6, 9.4, 5], [40, 8, 5], [41.4, 9.4, 5]], faint);
  }),

  /** A group with nothing written yet: a round table and the stools around it. */
  group: sketch((s) => {
    const stool = (a: number) => s.cylinder(17 * Math.cos(deg(a)), 17 * Math.sin(deg(a)), 0, 4, 7);
    stool(180);
    stool(270);
    s.cylinder(0, 0, 0, 5, 1);
    s.cylinder(0, 0, 1, 1.3, 13);
    s.cylinder(0, 0, 14, 10, 2);
    stool(0);
    stool(90);
  }),

  /** A voice room with nobody in it: the speakerphone in the middle, its sound rings on the floor. */
  voice: sketch((s) => {
    s.circle(0, 0, 0, 28, { dash: '2 3', o: 0.22 });
    s.circle(0, 0, 0, 19.5, { dash: '2 3', o: 0.4 });
    s.cylinder(0, 0, 0, 11, 4);
    s.circle(0, 0, 4, 7.5, faint);
    s.circle(0, 0, 4, 1.4, { o: 0.7 });
  }),

  /** No friends yet: an empty couch, two seats. */
  couch: sketch((s) => {
    s.slab(42, 0, 0, 2, 2, 2);
    s.slab(0, 16, 0, 2, 2, 2);
    s.slab(42, 16, 0, 2, 2, 2);
    s.slab(0, 0, 2, 44, 18, 7);
    s.line([[22, 5, 9], [22, 18, 9]], faint);
    s.slab(0, 0, 9, 44, 5, 12);
    s.line([[22, 5, 9], [22, 5, 21]], faint);
    s.slab(0, 5, 9, 5, 13, 5);
    s.slab(39, 5, 9, 5, 13, 5);
  }),

  /** Nobody online: a closed laptop and a glass of water beside it. */
  away: sketch((s) => {
    s.slab(0, 0, 0, 36, 24, 2, 2.5);
    s.slab(0.6, 0.6, 2, 34.8, 22.8, 1.4, 2.2);
    s.cylinder(47, 6, 0, 4, 10);
    s.arc(47, 6, 6, 4, 315, 495, faint);
  }),

  /** No friend requests: a mailbox on its post, flag down. */
  mailbox: sketch((s) => {
    s.circle(12, 6, 0, 7, dashed);
    s.slab(10, 4, 0, 4, 4, 17);
    s.slab(0, 0, 17, 24, 12, 12);
    outline(s, [[5, 12, 24], [19, 12, 24], [19, 12, 25.6], [5, 12, 25.6]], { o: 0.6 });
    s.slab(24, 3, 20, 1.2, 7, 2);
  }),

  /** No conversations: two message cards, one on the table and one on its way. */
  messages: sketch((s) => {
    s.slab(0, 0, 0, 30, 17, 2.5, 4);
    s.line([[6, 6, 2.5], [22, 6, 2.5]], faint);
    s.line([[6, 10.5, 2.5], [15, 10.5, 2.5]], fainter);
    s.float(() => {
      s.slab(18, -17, 13, 26, 14, 2.5, 4);
      s.line([[23, -11.5, 15.5], [36, -11.5, 15.5]], faint);
      s.line([[23, -7.5, 15.5], [30, -7.5, 15.5]], fainter);
    });
  }),

  /** Nothing found: a magnifying glass over an empty spot. */
  search: sketch((s) => {
    s.circle(4, 0, 0, 14, dashed);
    s.float(() => {
      s.tube(0, 0, 8, 10.5, 8, 2.5);
      s.slab(10, -1.8, 8, 14, 3.6, 2.5, 1.8);
    });
  }),

  /** No notifications: an empty tray, something on its way down into it. */
  tray: sketch((s) => {
    const [w, d, h, t, floor] = [36, 26, 6, 2, 1.5];
    const depth = h - floor;
    s.slab(0, 0, 0, w, d, h);
    outline(s, [[t, t, h], [w - t, t, h], [w - t, d - t, h], [t, d - t, h]], { o: 1 });
    // Inside: the back corner and the floor's two far edges, as far as the opening lets them be seen.
    s.line([[t, t, h], [t, t, floor]], faint);
    s.line([[w - t - depth, t, floor], [t, t, floor], [t, d - t - depth, floor]], faint);
    s.float(() => arrowDown(s, w / 2, d / 2, h + 20, h + 7));
  }),

  /** Nothing open: a bare floor, and the dashed outline of what will stand on it. */
  nothing: sketch((s) => {
    s.slab(0, 0, 0, 40, 40, 2, 3);
    const [x0, y0, x1, y1, z0, z1] = [11, 11, 29, 29, 2, 16];
    const ghost = { dash: '2 2.4', o: 0.5 };
    s.line([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], ghost, true);
    s.line([[x0, y1, z1], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0], [x1, y0, z1]], ghost);
    s.line([[x1, y1, z0], [x1, y1, z1]], ghost);
  }),

  /** Signing in: the server, and the computer and phone it's reached from. */
  signIn: sketch((s) => {
    s.line([[5, 16, 0], [5, 40, 0]], { dash: '2 2.6', o: 0.45 });
    s.line([[28, 8, 0], [44, 8, 0]], { dash: '2 2.6', o: 0.45 });
    for (const z of [0, 9]) {
      s.slab(0, 0, z, 28, 16, 7);
      s.line([[4, 16, z + 3.5], [5.5, 16, z + 3.5]], { o: 0.5 });
      s.line([[8, 16, z + 3.5], [9.5, 16, z + 3.5]], { o: 0.5 });
      s.line([[12, 16, z + 3.5], [13.5, 16, z + 3.5]], { o: 0.5 });
      s.circle(23, 16, z + 3.5, 0.9, { cls: 'art-led', ink: true });
    }
    laptop(s, -14, 40, 26, 17, 17);
    phone(s, 44, -4, 13, 23);
  }),

  /** The desktop app: a laptop, the download coming down to it. */
  computer: sketch((s) => {
    laptop(s, 0, 0);
    s.float(() => arrowDown(s, 20, 0.75, 46, 32, { dash: '2 2.4', o: 0.55 }));
  }),

  /** On the iPhone: Share, then the app's tile rising off the phone onto the home screen. */
  iphone: sketch((s) => {
    phone(s, 0, 0);
    // The share button in the toolbar: a box open at the top and the arrow out of it.
    s.line([[9.4, 33.4, 2.5], [9.4, 37, 2.5], [12.6, 37, 2.5], [12.6, 33.4, 2.5]]);
    s.line([[11, 35.4, 2.5], [11, 31.6, 2.5]]);
    s.line([[9.9, 32.7, 2.5], [11, 31.6, 2.5], [12.1, 32.7, 2.5]]);
    s.line([[11, 31.6, 2.5], [11, 18, 19]], { dash: '2 2.4', o: 0.45 });
    s.float(() => {
      s.slab(7, 14, 19, 8, 8, 2.5, 2);
      // The plus runs along the tile's diagonals, so on screen it stands upright instead of reading as an x.
      s.line([[9.6, 16.6, 21.5], [12.4, 19.4, 21.5]]);
      s.line([[11.7, 17.3, 21.5], [10.3, 18.7, 21.5]]);
    });
  }),

  /** On Android: the app coming down onto the phone. */
  android: sketch((s) => {
    phone(s, 0, 0);
    s.float(() => arrowDown(s, 11, 20, 36, 18, { dash: '2 2.4', o: 0.55 }));
  }),
} satisfies Record<string, Drawing>;

export type ArtName = keyof typeof ART;

/**
 * One drawing. `scale` sizes it (1 is the landing's size, where the line is 0.9 px); `plate` is the colour of
 * the surface under it, which every face is filled with.
 */
export function LineArt({ art, scale = 1.6, plate, className = '' }: { art: ArtName; scale?: number; plate?: string; className?: string }) {
  const { marks, box } = ART[art];
  const style = plate ? ({ '--plate': plate } as CSSProperties) : undefined;
  return (
    <svg
      viewBox={box.join(' ')}
      width={Math.round(box[2] * scale)}
      height={Math.round(box[3] * scale)}
      fill="none"
      stroke="currentColor"
      strokeWidth={0.9}
      strokeLinejoin="round"
      strokeLinecap="round"
      aria-hidden="true"
      focusable="false"
      className={`line-art shrink-0 ${className}`}
      style={style}
    >
      {marks.map((m, i) => (
        <path
          key={i}
          d={m.d}
          fill={m.ink ? 'currentColor' : m.plate ? 'var(--plate)' : undefined}
          fillRule={m.even ? 'evenodd' : undefined}
          stroke={m.ink ? 'none' : undefined}
          opacity={m.o}
          strokeDasharray={m.dash}
          strokeWidth={m.w}
          className={m.cls}
        />
      ))}
    </svg>
  );
}

/**
 * An empty place: its drawing, a short title and one quiet line. It fills the rest of a flex column and sits in
 * its middle, a touch above, where the eye puts the centre. `compact` is for narrow lists, dialogs and popovers.
 */
export function EmptyState({ art, title, text, compact, plate }: { art: ArtName; title: string; text?: string; compact?: boolean; plate?: string }) {
  return (
    <div className={`flex flex-1 flex-col items-center justify-center text-center ${compact ? 'px-4 py-8' : 'px-6 pb-[8vh] pt-8'}`}>
      <LineArt art={art} scale={compact ? 1.1 : 1.6} plate={plate} />
      <p className={`font-medium ${compact ? 'mt-4 text-[15px]' : 'mt-6 text-[17px]'}`}>{title}</p>
      {text && <p className={`mt-1 max-w-[320px] text-muted ${compact ? 'text-[13px]' : 'text-[14px]'}`}>{text}</p>}
    </div>
  );
}

/** The phone sign-in's picture: the server, and the computer and phone that reach it. */
export function SignInArt({ className = '' }: { className?: string }) {
  return (
    <div className={`flex justify-center pb-4 pt-10 ${className}`}>
      <LineArt art="signIn" scale={2} />
    </div>
  );
}
