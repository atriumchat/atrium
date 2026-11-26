import { klipyItems, klipySlug } from './klipy';

export const GIPHY_API = 'https://api.giphy.com/v1/gifs';
export const isGifId = (value: string) => /^[a-zA-Z0-9]{1,64}$/.test(value);

type Rendition = { url?: string; webp?: string; width?: string; height?: string };
export type GifResult = {
  id: string;
  title?: string;
  images?: Record<string, Rendition>;
};
export type Gif = { id: string; title: string; preview: string; animated: string; aspect: number; credit?: string };

function mediaUrl(url: string | undefined) {
  if (!url) return;
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'https:' && parsed.hostname.endsWith('.giphy.com')) return url;
  } catch {
    // A result may be missing a valid rendition.
  }
}

export function resultGif(result: GifResult, size = 'fixed_width_small'): Gif | null {
  const image = result.images?.[size];
  const animated = mediaUrl(image?.webp) ?? mediaUrl(image?.url);
  const still = mediaUrl(result.images?.[`${size}_still`]?.url);
  if (!isGifId(result.id) || !animated || !still) return null;
  const ratio = Number(image?.width) / Number(image?.height);
  const aspect = Number.isFinite(ratio) && ratio > 0 ? ratio : 4 / 3;
  return { id: result.id, title: result.title || 'GIF', preview: still, animated, aspect };
}

type ResolveGif = (gif: Gif | null) => void;

// Collect GIFs entering the viewport together without retaining responses or media URLs.
const pending = new Map<string, Map<string, ResolveGif[]>>();

export function loadChatGif(apiKey: string, id: string, provider: 'klipy' | 'giphy' = 'giphy'): Promise<Gif | null> {
  if (!apiKey || (provider === 'giphy' && !isGifId(id))) return Promise.resolve(null);
  const batchKey = provider + ':' + apiKey;
  let queue = pending.get(batchKey);
  if (!queue) {
    const batch = new Map<string, ResolveGif[]>();
    queue = batch;
    pending.set(batchKey, batch);
    setTimeout(() => {
      pending.delete(batchKey);
      const entries = [...batch];
      for (let start = 0; start < entries.length; start += 50) {
        void resolveGifs(apiKey, entries.slice(start, start + 50), provider);
      }
    }, 40);
  }
  return new Promise((resolve) => {
    const waiting = queue.get(id);
    if (waiting) waiting.push(resolve);
    else queue.set(id, [resolve]);
  });
}

async function resolveGifs(apiKey: string, entries: [string, ResolveGif[]][], provider: 'klipy' | 'giphy') {
  const ids = entries.map(([id]) => id);
  const gifs = new Map<string, Gif>();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    if (provider === 'klipy') {
      for (const gif of await klipyItems(apiKey, ids, controller.signal)) gifs.set(gif.id, gif);
    } else {
      const params = new URLSearchParams({ api_key: apiKey, ids: ids.join(','), rating: 'pg' });
      const response = await fetch(`${GIPHY_API}?${params}`, {
        cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', signal: controller.signal,
      });
      if (response.ok) {
        const { data }: { data: GifResult[] } = await response.json();
        for (const result of data) {
          const gif = resultGif(result, 'fixed_width') ?? resultGif(result);
          if (gif) gifs.set(gif.id, gif);
        }
      }
    }
  } catch {
    // An unavailable GIF is displayed without a player or an external link.
  } finally {
    clearTimeout(timeout);
  }
  for (const [id, waiting] of entries) {
    const gif = gifs.get(provider === 'klipy' ? klipySlug(id) : id) ?? null;
    for (const resolve of waiting) resolve(gif);
  }
}
