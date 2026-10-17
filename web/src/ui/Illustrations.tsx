import type { CSSProperties } from 'react';
import { PlusIcon } from './icons';

/**
 * Fillings for the spheres: soft multi-colour light, opal, soap bubble. Each is plain CSS, so the
 * illustration costs no image downloads. The glass shell on top is the `.glass-sphere` class (index.css).
 */
const ART = {
  aurora:
    'radial-gradient(circle at 30% 25%, #ffe08a 0, transparent 45%), radial-gradient(circle at 75% 38%, #ff6ad5 0, transparent 50%), radial-gradient(circle at 45% 82%, #7b5cff 0, transparent 55%), linear-gradient(160deg, #3d2bff, #12063a)',
  lagoon: 'radial-gradient(circle at 70% 30%, #a8fbff 0, transparent 42%), radial-gradient(circle at 25% 72%, #1e90ff 0, transparent 55%), linear-gradient(170deg, #0a3a8a, #04122e)',
  peach: 'radial-gradient(circle at 35% 30%, #fff1c9 0, transparent 38%), radial-gradient(circle at 70% 66%, #ff7a59 0, transparent 55%), linear-gradient(150deg, #ff3d77, #7a0f3a)',
  mint: 'radial-gradient(circle at 40% 28%, #eafff2 0, transparent 34%), radial-gradient(circle at 62% 72%, #23d18b 0, transparent 55%), linear-gradient(170deg, #0d7a55, #032a1d)',
  dusk: 'radial-gradient(circle at 30% 72%, #ff9d6c 0, transparent 45%), radial-gradient(circle at 72% 30%, #a77bff 0, transparent 55%), linear-gradient(170deg, #2a1650, #0c0620)',
  holo: 'radial-gradient(circle at 50% 50%, rgba(18,18,30,.55) 35%, transparent 68%), conic-gradient(from 200deg, #ff8ad8, #8ad1ff, #b2ff9e, #ffe58a, #ff9b6a, #ff8ad8)',
  brand: 'radial-gradient(circle at 35% 30%, #a9c3ff 0, transparent 38%), radial-gradient(circle at 70% 75%, #3d7bff 0, transparent 50%), linear-gradient(165deg, #0052ff, #001a66)',
  ember: 'radial-gradient(circle at 52% 62%, #ffcf5a 0, transparent 38%), radial-gradient(circle at 30% 30%, #ff5f3d 0, transparent 55%), linear-gradient(170deg, #5a0d0d, #1a0505)',
  moss: 'radial-gradient(circle at 50% 42%, #ff66c4 0, transparent 26%), radial-gradient(ellipse 70% 40% at 50% 82%, #4fae4a 0, transparent 70%), linear-gradient(175deg, #10301a, #050d06)',
  soap: 'radial-gradient(circle closest-side, rgba(255,255,255,.02) 55%, rgba(150,200,255,.18) 80%, rgba(255,150,220,.38) 95%, transparent 100%), conic-gradient(from 120deg, rgba(255,140,220,.25), rgba(140,210,255,.25), rgba(180,255,170,.22), rgba(255,230,140,.25), rgba(255,140,220,.25))',
  opal: 'radial-gradient(circle at 42% 38%, rgba(255,255,255,.55), transparent 34%), conic-gradient(from 40deg at 46% 58%, #ff9ad5, #9ad7ff, #b9ffb0, #ffe29a, #ffb38a, #ff9ad5)',
  marble: 'radial-gradient(ellipse 40% 28% at 30% 72%, rgba(255,255,255,.7), transparent 70%), radial-gradient(ellipse 80% 45% at 62% 38%, #6c63ff, transparent 70%), linear-gradient(135deg, #12c2e9, #c471ed 55%, #f64f59)',
  sky: 'radial-gradient(circle at 50% 18%, #ffffff 0, transparent 40%), linear-gradient(175deg, #9fd4ff, #3b7dd8)',
  candy: 'radial-gradient(circle at 25% 35%, #ffd1f0 0, transparent 40%), radial-gradient(circle at 75% 62%, #ff4fa3 0, transparent 50%), linear-gradient(160deg, #a2136b, #3a0526)',
} as const;

type Art = keyof typeof ART;

/** [x, y, diameter, filling] on the W x H canvas: a dense, slightly uneven band, the brand sphere in the middle. */
const LAYOUT: [number, number, number, Art][] = [
  [40, 112, 104, 'candy'], [150, 84, 122, 'soap'], [272, 104, 132, 'mint'], [398, 78, 126, 'moss'], [522, 92, 98, 'opal'],
  [612, 70, 134, 'sky'], [738, 104, 120, 'soap'], [862, 82, 128, 'ember'], [978, 116, 112, 'marble'],
  [18, 244, 168, 'lagoon'], [178, 214, 188, 'dusk'], [336, 232, 214, 'aurora'], [500, 206, 248, 'brand'],
  [684, 224, 226, 'peach'], [856, 210, 192, 'candy'], [1004, 246, 172, 'opal'],
  [92, 342, 96, 'ember'], [256, 344, 108, 'marble'], [404, 328, 88, 'soap'], [604, 340, 86, 'mint'], [772, 346, 104, 'holo'], [930, 332, 98, 'aurora'],
];

// Where people's photos go first: the big spheres around the middle one (indices into LAYOUT).
const PHOTO_SLOTS = [11, 13, 10, 14, 5, 2, 7, 3, 15, 9];

/**
 * What fills the band's spheres: art-directed images (web/public/art, sources in its CREDITS.txt) — one palette
 * of deep blue, hot pink and glass.
 */
export const DEFAULT_PHOTOS = [
  '/art/portrait.webp',
  '/art/mushroom.webp',
  '/art/flower.webp',
  '/art/burst.webp',
  '/art/glass-flowers.webp',
  '/art/blue-mushrooms.webp',
  '/art/eye.webp',
];

// Canvas: 1000 wide, 500 tall — the band, room below for the "+" sphere, and margin so shadows aren't cut off.
const W = 1000;
const H = 500;
const TOP = 24; // everything sits this much lower than the layout numbers, leaving room for the top row's shadows
const pct = (n: number, of: number) => `${(n / of) * 100}%`;

/**
 * Gomex's illustration, after the Wabi references: a band of glassy spheres running off both edges, with a
 * white "+" sphere in front. Pass people's photos to put real faces in the big spheres; `onPlus` turns the
 * "+" into a button. Sized by its width; everything is in percentages, so it scales without JS.
 */
export function Bubbles({
  photos = DEFAULT_PHOTOS,
  onPlus,
  plusLabel = 'Добавить',
  className = '',
}: {
  photos?: string[];
  onPlus?: () => void;
  plusLabel?: string;
  className?: string;
}) {
  const photoAt = new Map(PHOTO_SLOTS.slice(0, photos.length).map((slot, i) => [slot, photos[i]]));
  // Small ones first so the big ones overlap them.
  const order = LAYOUT.map((s, i) => [s, i] as const).sort((a, b) => a[0][2] - b[0][2]);
  const plusStyle: CSSProperties = { left: '50%', top: pct(350 + TOP, H), width: pct(128, W), aspectRatio: '1' };

  return (
    <div
      aria-hidden={onPlus ? undefined : true}
      // The band dissolves at the sides instead of ending in a hard edge.
      className={`relative w-full overflow-hidden [mask-image:linear-gradient(90deg,transparent,#000_8%,#000_92%,transparent)] ${className}`}
      style={{ aspectRatio: `${W} / ${H}` }}
    >
      {order.map(([[x, y, d, art], i]) => {
        const photo = photoAt.get(i);
        return (
          <span
            key={i}
            className="glass-sphere absolute -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-full"
            style={{ left: pct(x, W), top: pct(y + TOP, H), width: pct(d, W), aspectRatio: '1', background: photo ? '#222' : ART[art] }}
          >
            {photo && <img src={photo} alt="" draggable={false} className="h-full w-full object-cover" />}
          </span>
        );
      })}
      {onPlus ? (
        <button onClick={onPlus} aria-label={plusLabel} title={plusLabel} className="plus-sphere absolute -translate-x-1/2 -translate-y-1/2 rounded-full transition-transform active:scale-95" style={plusStyle}>
          <PlusIcon className="mx-auto h-[30%] w-[30%]" strokeWidth={2.4} />
        </button>
      ) : (
        <span className="plus-sphere absolute -translate-x-1/2 -translate-y-1/2 rounded-full" style={plusStyle}>
          <PlusIcon className="mx-auto h-[30%] w-[30%]" strokeWidth={2.4} />
        </span>
      )}
    </div>
  );
}

/**
 * [x, y, diameter, image, zoom] on an LW x LH canvas — a cluster after the reference, packed so every
 * neighbouring pair is the same 12 apart, with the "+" below on the centre line (the canvas's middle is also
 * the cluster's centre of mass), and the canvas trimmed to the cluster.
 */
const LW = 491;
const LH = 563;
const LENSES: [number, number, number, string, number][] = [
  [183.9, 75.5, 135, '/art/mushroom.webp', 1.08],
  [285.2, 70.1, 44, '/art/eye.webp', 1.08],
  [93, 212.6, 170, '/art/flower.webp', 1.35],
  [335.4, 244.5, 295, '/art/portrait.webp', 1.08],
  [111.9, 376, 135, '/art/burst.webp', 1.08],
];
const LENS_PLUS = [245.5, 470.7, 168];

/**
 * The empty-screen illustration: a few big glass lenses, each holding one picture, and a soft "+" sphere.
 * Each lens shows its picture sharp and slightly magnified, ringed by the same picture blurred — the
 * glass's thickness — under reflections (`.lens` in index.css).
 */
export function LensArt({ className = '' }: { className?: string }) {
  return (
    <div aria-hidden="true" className={`relative w-full ${className}`} style={{ aspectRatio: `${LW} / ${LH}` }}>
      {LENSES.map(([x, y, d, src, zoom]) => (
        <span key={src} className="lens" style={{ left: pct(x, LW), top: pct(y, LH), width: pct(d, LW) }}>
          <img src={src} alt="" draggable={false} className="lens-back" />
          <span className="lens-inner">
            <img src={src} alt="" draggable={false} style={{ transform: `scale(${zoom})` }} />
          </span>
        </span>
      ))}
      <span className="lens-plus" style={{ left: pct(LENS_PLUS[0], LW), top: pct(LENS_PLUS[1], LH), width: pct(LENS_PLUS[2], LW) }}>
        <PlusIcon className="h-[34%] w-[34%]" strokeWidth={1.6} />
      </span>
    </div>
  );
}

/**
 * Friendly empty state: the lens illustration, a title and a hint. It fills the rest of a flex column and sits
 * in its middle (a touch above, where the eye puts the centre).
 */
export function EmptyState({ title, text }: { title: string; text: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-4 pb-[6vh] pt-6 text-center">
      <LensArt className="max-w-[260px] md:max-w-[300px]" />
      <p className="mt-6 text-[18px] font-medium">{title}</p>
      <p className="mt-1 max-w-[320px] text-[14px] text-muted">{text}</p>
    </div>
  );
}
