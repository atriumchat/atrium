import type { Gif } from './giphy';

const API = 'https://api.klipy.com/api/v1';
const slugPattern = /^[A-Za-z0-9_-]{1,180}$/;
export const isKlipySlug = (slug: string) => slugPattern.test(slug);
// Search adds a request token after "--". The items endpoint uses and returns the permanent slug.
export const klipySlug = (slug: string) => slug.replace(/--[A-Za-z0-9]{9}$/, '');

type Media = { url: string; width: number; height: number };
type Formats = { gif?: Media; webp?: Media; jpg?: Media };
type Item = {
  slug?: string; title?: string; type?: string;
  file?: Partial<Record<'hd' | 'md' | 'sm' | 'xs', Formats>>;
  username?: string; source?: string | { name?: string }; user?: { username?: string };
};
type Page = { data: Item[]; has_next?: boolean };
type Category = { category: string; preview_url?: string };

function mediaUrl(value: string | undefined) {
  if (!value) return;
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' && /^static\d*\.klipy\.com$/.test(url.hostname)) return value;
  } catch {
    // An item may have no usable URL for this rendition.
  }
}

const media = (item: Media | undefined) => mediaUrl(item?.url) ? item : undefined;

function asGif(item: Item, large: boolean): Gif | null {
  if (!item.slug || !isKlipySlug(item.slug) || item.type === 'ad') return null;
  const sizes = large ? [item.file?.md, item.file?.hd, item.file?.sm, item.file?.xs] : [item.file?.sm, item.file?.xs, item.file?.md, item.file?.hd];
  const animated = sizes.map((f) => media(f?.webp) ?? media(f?.gif)).find(Boolean);
  const still = sizes.map((f) => media(f?.jpg)).find(Boolean);
  if (!animated || !still) return null;
  const aspect = animated.width / animated.height;
  const credit = item.user?.username ?? item.username ?? (typeof item.source === 'string' ? item.source : item.source?.name);
  return {
    id: klipySlug(item.slug), title: item.title || 'GIF', preview: still.url, animated: animated.url, credit,
    aspect: Number.isFinite(aspect) && aspect > 0 ? aspect : 4 / 3,
  };
}

export class KlipyError extends Error {
  constructor(public status: number) { super('KLIPY request failed'); }
}

async function request<T>(key: string, endpoint: string, params: URLSearchParams, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${API}/${encodeURIComponent(key)}/gifs/${endpoint}?${params}`, {
    cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', signal,
  });
  if (!response.ok) throw new KlipyError(response.status);
  const body: { result: boolean; data: T } = await response.json();
  if (!body.result || !body.data) throw new KlipyError(502);
  return body.data;
}

export async function searchKlipy(key: string, query: string, page: number, locale: string, signal: AbortSignal) {
  const params = new URLSearchParams({ page: String(page), per_page: '20', locale, content_filter: 'medium', format_filter: 'gif,webp,jpg' });
  if (query) params.set('q', query);
  const result = await request<Page>(key, query ? 'search' : 'trending', params, signal);
  if (!Array.isArray(result.data)) throw new KlipyError(502);
  return { gifs: result.data.map((item) => asGif(item, false)).filter((item) => item !== null), more: result.has_next ?? result.data.length === 20 };
}

export async function klipyCategories(key: string, locale: 'ru' | 'en', signal: AbortSignal) {
  const result = await request<{ categories: Category[] }>(key, 'categories', new URLSearchParams({ locale: locale === 'ru' ? 'ru_RU' : 'en_US' }), signal);
  if (!Array.isArray(result.categories)) throw new KlipyError(502);
  return result.categories
    .filter((item) => typeof item.category === 'string' && item.category.trim())
    .map((item) => ({ query: item.category, preview: mediaUrl(item.preview_url) }));
}

export async function klipyItems(key: string, ids: string[], signal?: AbortSignal) {
  const slugs = [...new Set(ids.filter(isKlipySlug).map(klipySlug))].join(',');
  if (!key || !slugs) return [];
  const result = await request<Page>(key, 'items', new URLSearchParams({ slugs }), signal);
  if (!Array.isArray(result.data)) throw new KlipyError(502);
  return result.data.map((item) => asGif(item, true)).filter((item) => item !== null);
}
