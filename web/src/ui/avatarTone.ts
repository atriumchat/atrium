import { useEffect, useState } from 'react';
import type { User } from '../types';

/**
 * The backdrop of a person's tile, taken from their picture the way Discord does it: the picture's own colour in one flat
 * mid tone, dark enough for white text. A person with no picture gets a dimmed version of their colour.
 */

const cache = new Map<string, string | null>();

function dominant(img: HTMLImageElement): string | null {
  const size = 24;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  try {
    ctx.drawImage(img, 0, 0, size, size);
    const { data } = ctx.getImageData(0, 0, size, size);
    let r = 0;
    let g = 0;
    let b = 0;
    let total = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 128) continue;
      const max = Math.max(data[i], data[i + 1], data[i + 2]);
      const min = Math.min(data[i], data[i + 1], data[i + 2]);
      // Colourful pixels count most; near-black and near-white ones barely, so a white wall doesn't turn the tile grey.
      const saturation = max === 0 ? 0 : (max - min) / max;
      const weight = (saturation * saturation + 0.04) * (max < 24 || min > 235 ? 0.2 : 1);
      r += data[i] * weight;
      g += data[i + 1] * weight;
      b += data[i + 2] * weight;
      total += weight;
    }
    if (total === 0) return null;
    return held(r / total, g / total, b / total);
  } catch {
    return null;
  }
}

/** The colour as HSL with its saturation kept in a calm range and its lightness fixed. */
function held(r: number, g: number, b: number) {
  const max = Math.max(r, g, b) / 255;
  const min = Math.min(r, g, b) / 255;
  const l = (max + min) / 2;
  const d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === r / 255) h = ((g - b) / 255 / d) % 6;
    else if (max === g / 255) h = (b - r) / 255 / d + 2;
    else h = (r - g) / 255 / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  return `hsl(${Math.round(h)} ${Math.round(Math.min(0.5, Math.max(0.22, s)) * 100)}% 36%)`;
}

/** A CSS colour for the tile, or null until there is one (the tile keeps its plain fill meanwhile). */
export function useAvatarTone(user: User | undefined): string | null {
  const url = user?.avatarUrl ?? null;
  const [tone, setTone] = useState<string | null>(() => (url ? (cache.get(url) ?? null) : null));
  useEffect(() => {
    if (!url) {
      setTone(null);
      return;
    }
    const known = cache.get(url);
    if (known !== undefined) {
      setTone(known);
      return;
    }
    let live = true;
    const img = new Image();
    img.onload = () => {
      const found = dominant(img);
      cache.set(url, found);
      if (live) setTone(found);
    };
    img.onerror = () => cache.set(url, null);
    img.src = url;
    return () => {
      live = false;
    };
  }, [url]);
  if (url) return tone;
  return user?.color ? `color-mix(in oklab, ${user.color}, black 45%)` : null;
}
