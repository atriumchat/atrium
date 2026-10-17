import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { Slider } from '@heroui/react';

/**
 * The server's icon cut from any picture: the picture under a round window (the icon is a circle everywhere in the
 * app), moved by dragging and brought closer with the wheel, a pinch or the slider. The square around the window is
 * what gets uploaded.
 */

/** The picture's point (in its own pixels) at the window's centre, and how close: 1 = its short side fits. */
export type Crop = { x: number; y: number; zoom: number };

const MAX_ZOOM = 4;

/** A picked file, decoded; its object URL stays as the image's src for showing it. */
export async function loadImage(file: File): Promise<HTMLImageElement> {
  const img = new Image();
  img.src = URL.createObjectURL(file);
  try {
    await img.decode();
  } catch {
    URL.revokeObjectURL(img.src);
    throw new Error('Это не похоже на картинку');
  }
  return img;
}

export const centred = (img: HTMLImageElement): Crop => ({ x: img.naturalWidth / 2, y: img.naturalHeight / 2, zoom: 1 });

/** The square's side in the picture's pixels. */
const sideOf = (img: HTMLImageElement, zoom: number) => Math.min(img.naturalWidth, img.naturalHeight) / zoom;

/** The square never leaves the picture. */
function clamp(img: HTMLImageElement, crop: Crop): Crop {
  const zoom = Math.min(MAX_ZOOM, Math.max(1, crop.zoom));
  const half = sideOf(img, zoom) / 2;
  return {
    zoom,
    x: Math.min(img.naturalWidth - half, Math.max(half, crop.x)),
    y: Math.min(img.naturalHeight - half, Math.max(half, crop.y)),
  };
}

function draw(img: HTMLImageElement, crop: Crop, size: number) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  const side = sideOf(img, crop.zoom);
  ctx.drawImage(img, crop.x - side / 2, crop.y - side / 2, side, side, 0, 0, size, size);
  return canvas;
}

/** The square as a PNG (the server makes its own WebP of it); PNG keeps a logo's transparent corners. */
export function cropToBlob(img: HTMLImageElement, crop: Crop, size = 512): Promise<Blob> {
  return new Promise((resolve, reject) =>
    draw(img, crop, size).toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Не получилось вырезать картинку'))), 'image/png'),
  );
}

/** A small copy of the square, to show the icon in place before it's uploaded. */
export const cropToUrl = (img: HTMLImageElement, crop: Crop, size = 160) => draw(img, crop, size).toDataURL('image/png');

export function IconCropper({
  image,
  crop,
  onChange,
  className = '',
}: {
  image: HTMLImageElement;
  crop: Crop;
  onChange: (crop: Crop) => void;
  /** The frame's own look and height; the window inside keeps 20px from its shorter side. */
  className?: string;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const latest = useRef(crop);
  latest.current = crop;
  const pointers = useRef(new Map<number, { x: number; y: number }>());

  useLayoutEffect(() => {
    const el = frame.current!;
    setBox({ w: el.clientWidth, h: el.clientHeight });
    const ro = new ResizeObserver(([e]) => setBox({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const hole = Math.max(0, Math.min(box.w, box.h) - 40);
  const scale = hole / sideOf(image, crop.zoom);
  const move = (next: Partial<Crop>) => onChange(clamp(image, { ...latest.current, ...next }));

  // The wheel zooms; React's own wheel listener is passive and can't stop the page from scrolling.
  useEffect(() => {
    const el = frame.current!;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      onChange(clamp(image, { ...latest.current, zoom: latest.current.zoom * Math.exp(-e.deltaY * 0.002) }));
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, [image, onChange]);

  function down(e: PointerEvent) {
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
  }

  function drag(e: PointerEvent) {
    const was = pointers.current.get(e.pointerId);
    if (!was) return;
    const all = [...pointers.current.values()];
    const now = { x: e.clientX, y: e.clientY };
    if (all.length === 1) {
      move({ x: latest.current.x - (now.x - was.x) / scale, y: latest.current.y - (now.y - was.y) / scale });
    } else if (all.length === 2) {
      // Two fingers: closer by as much as they spread.
      const other = all.find((p) => p !== was)!;
      const before = Math.hypot(was.x - other.x, was.y - other.y);
      const after = Math.hypot(now.x - other.x, now.y - other.y);
      if (before > 0) move({ zoom: (latest.current.zoom * after) / before });
    }
    pointers.current.set(e.pointerId, now);
  }

  function up(e: PointerEvent) {
    pointers.current.delete(e.pointerId);
  }

  function key(e: KeyboardEvent) {
    const step = 12 / scale;
    const by: Record<string, Partial<Crop>> = {
      ArrowLeft: { x: crop.x - step },
      ArrowRight: { x: crop.x + step },
      ArrowUp: { y: crop.y - step },
      ArrowDown: { y: crop.y + step },
      '+': { zoom: crop.zoom * 1.1 },
      '=': { zoom: crop.zoom * 1.1 },
      '-': { zoom: crop.zoom / 1.1 },
    };
    if (!by[e.key]) return;
    e.preventDefault();
    move(by[e.key]);
  }

  return (
    <>
      <div
        ref={frame}
        tabIndex={0}
        role="img"
        aria-label="Кадр значка"
        onPointerDown={down}
        onPointerMove={drag}
        onPointerUp={up}
        onPointerCancel={up}
        onKeyDown={key}
        className={`relative cursor-grab touch-none select-none overflow-hidden outline-none active:cursor-grabbing ${className}`}
      >
        {hole > 0 && (
          <img
            src={image.src}
            alt=""
            draggable={false}
            className="pointer-events-none absolute max-w-none"
            style={{
              left: box.w / 2 - crop.x * scale,
              top: box.h / 2 - crop.y * scale,
              width: image.naturalWidth * scale,
              height: image.naturalHeight * scale,
            }}
          />
        )}
        {/* The window: everything outside it dimmed, a hairline on its edge. */}
        <span
          className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full shadow-[0_0_0_9999px_rgba(12,12,14,0.72),inset_0_0_0_1px_rgba(255,255,255,0.35)]"
          style={{ width: hole, height: hole }}
        />
      </div>
      <Slider
        aria-label="Масштаб"
        minValue={1}
        maxValue={MAX_ZOOM}
        step={0.01}
        value={crop.zoom}
        onChange={(v) => move({ zoom: Array.isArray(v) ? v[0] : v })}
        className="icon-zoom mt-3 w-full"
      >
        <Slider.Track>
          <Slider.Fill />
          <Slider.Thumb />
        </Slider.Track>
      </Slider>
    </>
  );
}
