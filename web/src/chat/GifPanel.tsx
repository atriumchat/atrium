import { useEffect, useState, type ReactNode } from 'react';
import { Button, Input, Spinner } from '@heroui/react';
import { ArrowLeftIcon, ArrowTrendingUpIcon, MagnifyingGlassIcon, StarIcon } from '@heroicons/react/24/outline';
import { useT } from '../i18n';
import { useStore } from '../store';
import type { Gif } from './giphy';
import { isKlipySlug, klipyCategories, klipyItems, KlipyError, klipySlug, searchKlipy } from './klipy';
import { usePersonalItems } from './expressionPreferences';

const fallbackCategories = [
  { query: 'hello', label: 'chat.gif.category.hi' },
  { query: 'lol', label: 'chat.gif.category.laugh' },
  { query: 'love', label: 'chat.gif.category.love' },
  { query: 'happy birthday', label: 'chat.gif.category.birthday' },
] as const;

export function GifPanel({ apiKey, onPick }: { apiKey: string; onPick: (gif: Gif, draft: boolean) => void }) {
  const { t, lang } = useT();
  const user = useStore((s) => s.me?.id);
  const [savedIds, saveFavorites] = usePersonalItems('favorite-gifs', user);
  const favorites = [...new Set(savedIds.filter(isKlipySlug).map(klipySlug))];
  const [view, setView] = useState<'home' | 'trending' | 'favorites'>('home');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<Gif[]>([]);
  const [more, setMore] = useState(false);
  const [state, setState] = useState<'loading' | 'ready' | 'failed' | 'limit'>('ready');
  const [retry, setRetry] = useState(0);
  const [categories, setCategories] = useState<{ query: string; preview?: string }[]>([]);
  const [trendingCover, setTrendingCover] = useState<Gif>();
  const term = query.trim();
  const home = view === 'home' && !term;
  const favoriteIds = view === 'favorites' ? favorites.slice(0, 50).join(',') : '';
  const catalogTerm = view === 'favorites' ? '' : term;
  const locale = /\p{Script=Cyrillic}/u.test(catalogTerm) ? 'ru' : lang;

  useEffect(() => {
    if (!apiKey) return;
    const controller = new AbortController();
    void klipyCategories(apiKey, lang, controller.signal).then((items) => {
      if (!controller.signal.aborted) setCategories(items);
    }, () => {});
    void searchKlipy(apiKey, '', 1, lang, controller.signal).then(({ gifs }) => {
      if (!controller.signal.aborted) setTrendingCover(gifs[0]);
    }, () => {});
    return () => controller.abort();
  }, [apiKey, lang]);

  useEffect(() => {
    if (!apiKey || home) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const result = view === 'favorites'
          ? { gifs: await klipyItems(apiKey, favoriteIds ? favoriteIds.split(',') : [], controller.signal), more: false }
          : await searchKlipy(apiKey, catalogTerm, page, locale, controller.signal);
        if (controller.signal.aborted) return;
        setItems((previous) => page > 1 ? [...previous, ...result.gifs.filter((gif) => !previous.some((old) => old.id === gif.id))] : result.gifs);
        setMore(result.more);
        setState('ready');
      } catch (error) {
        if (!controller.signal.aborted) setState(error instanceof KlipyError && error.status === 429 ? 'limit' : 'failed');
      }
    }, catalogTerm && page === 1 ? 300 : 0);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [apiKey, favoriteIds, home, locale, page, retry, catalogTerm, view]);

  function reset(nextView: typeof view, nextQuery = '') {
    setPage(1);
    setItems([]);
    setMore(false);
    setView(nextView);
    setQuery(nextQuery);
    setState(nextView === 'home' && !nextQuery.trim() ? 'ready' : 'loading');
  }

  if (!apiKey) return <div className="grid min-h-48 place-items-center px-4 text-center text-sm text-muted">{t('chat.gif.disabled')}</div>;
  const shown = view === 'favorites'
    ? favorites.map((id) => items.find((gif) => gif.id === id)).filter((gif): gif is Gif => !!gif && gif.title.toLocaleLowerCase(lang).includes(term.toLocaleLowerCase(lang)))
    : items;
  const sectionTitle = view === 'favorites' ? t('chat.gif.favorites') : t('chat.gif.trending');
  const categoryCards: { query: string; preview?: string }[] = categories.length ? categories : fallbackCategories.map(({ query }) => ({ query }));
  const searchLabel = view === 'favorites' ? t('chat.gif.searchFavorites') : t('chat.gif.search');

  return (
    <>
      <div className="flex shrink-0 items-center gap-2 border-b border-edge px-3 py-3">
        {(view !== 'home' || term) && <Button variant="ghost" isIconOnly aria-label={t('common.back')} onPress={() => reset('home')} className="size-9 min-w-9 rounded-full p-0"><ArrowLeftIcon className="size-4" /></Button>}
        {view !== 'home' && <span className="shrink-0 text-sm font-semibold max-sm:hidden">{sectionTitle}</span>}
        <div className="relative min-w-0 flex-1">
          <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 z-10 size-4 -translate-y-1/2 text-muted" />
          <Input type="search" aria-label={searchLabel} placeholder={searchLabel} maxLength={80} value={query} onChange={(event) => {
            const next = event.target.value;
            if (view === 'favorites' || next.trim() === term) setQuery(next);
            else reset(view, next);
          }} className="w-full rounded-full border border-edge bg-window pl-9 max-md:text-base" />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3" aria-busy={state === 'loading'}>
        {home ? (
          <div className="grid grid-cols-2 gap-2">
            <CategoryCard label={t('chat.gif.favorites')} icon={<StarIcon className="size-4" />} onPress={() => reset('favorites')} />
            <CategoryCard label={t('chat.gif.trending')} icon={<ArrowTrendingUpIcon className="size-4" />} image={trendingCover?.preview} credit={trendingCover?.credit} onPress={() => reset('trending')} />
            {categoryCards.map(({ query, preview }) => {
              const translated = fallbackCategories.find((item) => item.query === query);
              const label = translated ? t(translated.label) : query;
              return <CategoryCard key={query} label={label} image={preview} animated onPress={() => reset('home', label)} />;
            })}
          </div>
        ) : (
          <>
            {view !== 'home' && <p className="pb-2 text-sm font-semibold sm:hidden">{sectionTitle}</p>}
            <div className="columns-2 gap-2">
              {shown.map((gif) => <GifTile key={gif.id} gif={gif} onPick={onPick} saved={favorites.includes(gif.id)} onSave={() => saveFavorites(toggleFavorite(favorites, gif.id))} />)}
            </div>
            {state === 'loading' && <div className="flex justify-center py-6"><Spinner aria-label={t('chat.gif.loading')} /></div>}
            {state === 'limit' && <p role="status" className="py-5 text-center text-sm text-muted">{t('chat.gif.limit')}</p>}
            {state === 'failed' && <div role="status" className="grid justify-items-center gap-2 py-5 text-sm text-muted">{t('chat.gif.failed')}<Button size="sm" variant="tertiary" className="rounded-full" onPress={() => { setState('loading'); setRetry(retry + 1); }}>{t('chat.search.retry')}</Button></div>}
            {state === 'ready' && !shown.length && <p role="status" className="py-5 text-center text-sm text-muted">{t(view === 'favorites' && !term ? 'chat.gif.noFavorites' : 'chat.gif.empty')}</p>}
            {state === 'ready' && more && <Button size="sm" variant="ghost" className="mt-2 w-full rounded-full" onPress={() => { setState('loading'); setPage(page + 1); }}>{t('chat.gif.more')}</Button>}
          </>
        )}
      </div>
    </>
  );
}

function CategoryCard({ label, icon, image, credit, animated, onPress }: {
  label: string; icon?: ReactNode; image?: string; credit?: string; animated?: boolean; onPress: () => void;
}) {
  return (
    <Button variant="ghost" onPress={onPress} className="group relative isolate flex aspect-[2.05] h-auto w-full min-w-0 items-center justify-center gap-2 overflow-hidden rounded-row bg-window px-2 text-sm font-semibold text-foreground hover:bg-white/10 sm:text-base">
      {image && <img src={image} alt="" loading="lazy" className={`absolute inset-0 -z-10 size-full object-cover opacity-45 transition-opacity group-hover:opacity-65 motion-reduce:transition-none ${animated ? 'motion-reduce:hidden' : ''}`} />}
      {icon}<span className="truncate">{label}</span>
      {credit && <span className="absolute bottom-1 left-1 max-w-[90%] truncate rounded-full bg-black/80 px-2 py-0.5 text-xs text-white opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 pointer-coarse:opacity-100">{credit}</span>}
    </Button>
  );
}

function GifTile({ gif, onPick, saved, onSave }: { gif: Gif; onPick: (gif: Gif, draft: boolean) => void; saved: boolean; onSave: () => void }) {
  const [hover, setHover] = useState(false);
  const animated = hover && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  return (
    <div className="group relative mb-2 break-inside-avoid">
      <Button variant="ghost" aria-label={gif.title} onPress={(event) => onPick(gif, event.shiftKey)} onHoverChange={setHover} onFocusChange={setHover} className="block h-auto w-full min-w-0 overflow-hidden rounded-row border-0 bg-transparent p-0 shadow-none [--button-bg-hover:transparent]">
        <img src={animated ? gif.animated : gif.preview} alt="" loading="lazy" style={{ aspectRatio: gif.aspect }} className="block w-full" />
      </Button>
      <FavoriteGifButton saved={saved} onPress={onSave} />
      {gif.credit && <p className="pointer-events-none absolute bottom-1 left-1 max-w-[90%] truncate rounded-full bg-black/80 px-2 py-0.5 text-xs text-white opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 pointer-coarse:opacity-100">{gif.credit}</p>}
    </div>
  );
}

export function toggleFavorite(ids: string[], id: string) {
  const current = [...new Set(ids.map(klipySlug))];
  return current.includes(id) ? current.filter((saved) => saved !== id) : [id, ...current].slice(0, 50);
}

export function FavoriteGifButton({ saved, onPress }: { saved: boolean; onPress: () => void }) {
  const { t } = useT();
  return (
    <Button variant="ghost" isIconOnly aria-label={t(saved ? 'chat.gif.unfavorite' : 'chat.gif.favorite')} aria-pressed={saved} onPress={onPress} className={`absolute right-1 top-1 size-8 min-w-8 rounded-full bg-black/75 p-0 text-white hover:bg-black motion-safe:transition-opacity ${saved ? 'opacity-100' : 'opacity-0 focus-visible:opacity-100 group-hover:opacity-100 pointer-coarse:opacity-100'}`}>
      <StarIcon className={`size-4 ${saved ? 'fill-current' : ''}`} />
    </Button>
  );
}
