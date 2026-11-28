import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Button, Popover } from '@heroui/react';
import { CakeIcon, ClockIcon, FaceSmileIcon, FlagIcon, GlobeAltIcon, HashtagIcon, LightBulbIcon, MagnifyingGlassIcon, PuzzlePieceIcon, ServerIcon, SparklesIcon, SunIcon, UserIcon } from '@heroicons/react/24/outline';
import { useT } from '../i18n';
import { usePersonalItems } from '../chat/expressionPreferences';
import { useStore } from '../store';
import { EmojiText, serverEmojiUrl, twemojiUrl } from './EmojiText';

// The ones people actually react with, roughly by how often; any other emoji can still be typed into a message.
const EMOJI = [
  '👍', '❤️', '😂', '🔥', '😮', '😢', '😡', '🎉',
  '👀', '💯', '✅', '❌', '🙏', '👏', '🤝', '💀',
  '🤡', '🤔', '😎', '🥲', '😭', '🥰', '😏', '🫡',
  '🤯', '😴', '🙈', '👌', '✌️', '🤙', '💪', '🫶',
  '🍿', '☕', '🍕', '🎮', '🏆', '⚡', '🌚', '🗿',
  '👎', '😐', '🤮', '🥶', '🥵', '😈', '👻', '🚀',
];

type Item = { unicode: string; label: string; url: string; group?: number; aliases?: string[]; search?: string[] };
type Group = number | 'common' | 'server';
const BATCH = 80;
const load = {
  en: () => import('emojibase-data/en/compact.json'),
  ru: () => import('emojibase-data/ru/compact.json'),
};

const englishData = () => Promise.all([
  load.en(),
  import('emojibase-data/en/shortcodes/emojibase.json'),
  import('emojibase-data/en/shortcodes/github.json'),
]);

/** The search box of every picker: the settings field look (plain border, no glow on focus), pill-shaped. */
export const pickerSearch = 'block h-10 w-full rounded-full border border-white/[0.07] bg-white/[0.03] pr-3 text-[15px] outline-none transition-colors placeholder:text-faint focus:border-white/40 max-md:text-[16px]';

const searchTerm = (value: string) => value.toLowerCase().replaceAll('ё', 'е').replace(/[_:-]+/g, ' ').trim();

export function EmojiPicker({ label, onPick, children, className, custom = true, disabled }: {
  label: string; onPick: (emoji: string) => void; children: ReactNode; className?: string; custom?: boolean; disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover isOpen={open} onOpenChange={setOpen}>
      <Button variant="ghost" isIconOnly aria-label={label} className={`min-w-0 p-0 ${className ?? ''}`} isDisabled={disabled}>
        {children}
      </Button>
      <Popover.Content placement="top end" className="w-[328px] max-w-[calc(100vw-24px)]">
        <Popover.Dialog aria-label={label} className="p-2">
          <EmojiGrid custom={custom} onPick={(value) => { setOpen(false); onPick(value); }} />
        </Popover.Dialog>
      </Popover.Content>
    </Popover>
  );
}

export function EmojiGrid({ custom, onPick, composer = false, addAction, startOnServer = false }: {
  custom: boolean; onPick: (value: string, keepOpen: boolean) => void; composer?: boolean; addAction?: ReactNode; startOnServer?: boolean;
}) {
  const { t, lang } = useT();
  const catalog = useStore((s) => s.customEmoji);
  const serverName = useStore((s) => s.serverName);
  const user = useStore((s) => composer ? s.me?.id : undefined);
  const [recent, saveRecent] = usePersonalItems('recent-emoji', user);
  const [items, setItems] = useState<Item[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState<Group>(startOnServer ? 'server' : 'common');
  const [count, setCount] = useState(BATCH);
  const [preview, setPreview] = useState<Item | null>(null);
  const scroll = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    Promise.all([englishData(), lang === 'ru' ? load.ru() : undefined]).then(([[english, ...codes], translated]) => {
      if (!active) return;
      const local = new Map(translated?.default.map((item) => [item.hexcode, item]));
      const aliases = codes.map(({ default: data }) => data as Record<string, string | string[]>);
      setItems(english.default.flatMap((item) => {
        const url = twemojiUrl(item.unicode);
        if (!url || item.group === undefined || item.group === 2) return [];
        const other = local.get(item.hexcode);
        const names = [...new Set(aliases.flatMap((data) => data[item.hexcode] ?? []))];
        return [{
          unicode: item.unicode, url, label: other?.label ?? item.label, group: item.group, aliases: names,
          search: [item.unicode, item.label, other?.label ?? '', ...names, ...item.tags ?? [], ...other?.tags ?? []].map(searchTerm),
        }];
      }));
      setFailed(false);
    }, () => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [lang]);

  const own = useMemo<Item[]>(() => custom ? Object.entries(catalog).filter(([, active]) => active).map(([name]) => ({
    unicode: `:${name}:`, label: name, url: serverEmojiUrl(name), search: [searchTerm(name)],
  })) : [], [catalog, custom]);
  const fallback = useMemo<Item[]>(() => EMOJI.flatMap((unicode) => {
    const url = twemojiUrl(unicode);
    return url ? [{ unicode, url, label: unicode }] : [];
  }), []);
  const lookup = useMemo(() => new Map([...items ?? fallback, ...own].map((item) => [item.unicode, item])), [items, own, fallback]);
  const popular = EMOJI.map((unicode) => lookup.get(unicode)).filter((item): item is Item => !!item);
  const recentItems = recent.map((unicode) => lookup.get(unicode)).filter((item): item is Item => !!item);
  const groups = [
    ['common', t(composer && recentItems.length ? 'chat.emoji.recent' : 'chat.emoji.popular'), composer && recentItems.length ? ClockIcon : SparklesIcon],
    ...(own.length ? [['server', composer ? serverName : t('chat.emoji.server'), ServerIcon]] as const : []),
    [0, t('chat.emoji.faces'), FaceSmileIcon], [1, t('chat.emoji.people'), UserIcon], [3, t('chat.emoji.nature'), SunIcon],
    [4, t('chat.emoji.food'), CakeIcon], [5, t('chat.emoji.travel'), GlobeAltIcon], [6, t('chat.emoji.activity'), PuzzlePieceIcon],
    [7, t('chat.emoji.objects'), LightBulbIcon], [8, t('chat.emoji.symbols'), HashtagIcon], [9, t('chat.emoji.flags'), FlagIcon],
  ] as const;
  // One server per install: its emoji sit under the server's name in the list, not as a rail entry of their own.
  const rail = composer ? groups.filter(([id]) => id !== 'server') : groups;
  const needle = searchTerm(query);
  useEffect(() => {
    if (!startOnServer) return;
    const frame = requestAnimationFrame(() => {
      const scroller = scroll.current;
      const section = scroller?.querySelector<HTMLElement>('[data-emoji-section="server"]');
      if (scroller && section) scroller.scrollTop = section.offsetTop - 8;
    });
    return () => cancelAnimationFrame(frame);
  }, [startOnServer]);
  const results = useMemo(() => {
    if (!needle) return [];
    const terms = needle.split(/\s+/);
    return [...own, ...items ?? fallback]
      .map((item: Item) => {
        const fields = item.search ?? [item.unicode];
        return { item, rank: fields.includes(needle) ? 0 : fields.some((field) => field.includes(needle)) ? 1 :
          terms.every((term) => fields.some((field) => field.includes(term))) ? 2 : 3 };
      })
      .filter(({ rank }) => rank < 3).sort((a, b) => a.rank - b.rank).map(({ item }) => item);
  }, [needle, own, items, fallback]);

  function groupItems(id: Group) {
    if (id === 'common') return composer && recentItems.length ? recentItems : popular;
    if (id === 'server') return own;
    return (items ?? []).filter((item) => item.group === id);
  }

  function choose(item: Item, keepOpen: boolean) {
    if (composer) saveRecent([item.unicode, ...recent.filter((value) => value !== item.unicode)].slice(0, 18));
    onPick(item.unicode, composer && keepOpen);
  }

  function selectGroup(id: Group) {
    const jump = () => {
      const scroller = scroll.current;
      const section = scroller?.querySelector<HTMLElement>(`[data-emoji-section="${id}"]`);
      if (scroller && section) scroller.scrollTop = section.offsetTop - 8;
    };
    setQuery('');
    setCount(BATCH);
    setGroup(id);
    setPreview(null);
    if (needle) requestAnimationFrame(jump);
    else jump();
  }

  function updateCategory() {
    const scroller = scroll.current;
    if (!scroller || needle || !composer) return;
    let current: Group = 'common';
    for (const section of scroller.querySelectorAll<HTMLElement>('[data-emoji-section]')) {
      if (section.offsetTop > scroller.scrollTop + 12) break;
      const id = section.dataset.emojiSection;
      current = id === 'common' || id === 'server' ? id : Number(id);
    }
    setGroup(current);
  }

  function renderItems(values: Item[], lazy = false) {
    return (
      <div className={`grid gap-0.5 ${composer ? 'grid-cols-9 max-sm:grid-cols-8' : 'grid-cols-8'}`}>
        {values.map((item) => (
          <button key={item.unicode} type="button" aria-label={item.label}
            data-emoji={item.unicode} onClick={(event) => choose(item, event.shiftKey)}
            className={`grid w-full place-items-center rounded-row p-0 hover:bg-white/10 focus-visible:bg-white/10 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus ${composer ? 'h-10 text-[31px] max-sm:h-9 max-sm:text-[26px]' : 'h-9 text-[22px]'}`}>
            <img src={item.url} alt="" draggable={false} loading={lazy ? 'lazy' : undefined} decoding="async" className="size-[1em] object-contain" />
          </button>
        ))}
      </div>
    );
  }

  const options = needle ? results : groupItems(group);
  const visiblePreview = preview && lookup.get(preview.unicode);
  const caption = visiblePreview && (visiblePreview.unicode.startsWith(':') ? visiblePreview.unicode :
    visiblePreview.aliases?.[0] ? `:${visiblePreview.aliases[0]}:` : visiblePreview.label);
  return (
    <>
      <div className={`flex shrink-0 items-center gap-2 ${composer ? 'border-b border-edge px-3 py-3' : ''}`}>
        <div className="relative min-w-0 flex-1">
          {composer && <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 z-10 size-4 -translate-y-1/2 text-muted" />}
          <input type="search" aria-label={t('chat.emoji.search')} placeholder={t('chat.emoji.search')} value={query}
            onChange={(event) => { setQuery(event.target.value); setCount(BATCH); setPreview(null); if (scroll.current) scroll.current.scrollTop = 0; }}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              if (event.key === 'Enter' && needle && results[0]) { event.preventDefault(); choose(results[0], event.shiftKey); }
              if (event.key === 'ArrowDown') { event.preventDefault(); scroll.current?.querySelector<HTMLButtonElement>('[data-emoji]')?.focus(); }
            }}
            className={`${pickerSearch} ${composer ? 'pl-9' : 'pl-3'}`} />
        </div>
        {addAction}
      </div>
      <div className={composer ? 'flex min-h-0 flex-1' : ''}>
        {rail.length > 1 && <div className={`flex gap-1 ${composer ? 'w-11 shrink-0 flex-col items-center overflow-y-auto border-r border-edge py-2' : 'my-2 overflow-x-auto'}`} role="group" aria-label={t('chat.emoji.categories')}>
          {rail.map(([id, label, Icon]) => (
            <Button key={id} size="sm" variant="ghost" isIconOnly={composer} aria-label={label} aria-pressed={!needle && group === id}
              onPress={() => selectGroup(id)} className={`shrink-0 rounded-full ${composer ? 'size-8 min-w-8 p-0' : ''} ${!needle && group === id ? 'bg-white/15' : 'text-muted'}`}>
              {composer ? <Icon className="size-4" title={label} /> : label}
            </Button>
          ))}
        </div>}
        <div ref={scroll} onScroll={updateCategory}
          onPointerOver={composer ? (event) => {
            const tile = (event.target as HTMLElement).closest<HTMLElement>('[data-emoji]');
            if (tile) setPreview(lookup.get(tile.dataset.emoji ?? '') ?? null);
          } : undefined}
          onFocus={composer ? (event) => {
            const tile = event.target.closest<HTMLElement>('[data-emoji]');
            if (tile) setPreview(lookup.get(tile.dataset.emoji ?? '') ?? null);
          } : undefined}
          className={`relative overflow-y-auto overscroll-contain ${composer ? 'min-w-0 flex-1 px-3 py-2' : 'max-h-[min(17rem,35dvh)]'}`}>
          {composer && !needle ? groups.map(([id, label]) => {
            const values = groupItems(id);
            return values.length > 0 && <section key={id} data-emoji-section={id} className="mb-4 last:mb-0">
              <h3 className="mb-2 text-sm font-semibold">{label}</h3>
              {renderItems(values, id !== 'common')}
            </section>;
          }) : renderItems(options.slice(0, count))}
          {(!composer || needle) && !options.length && <p role="status" className="px-2 py-5 text-center text-sm text-muted">{failed ? t('chat.emoji.failed') : !items ? t('chat.emoji.loading') : t('chat.emoji.empty')}</p>}
          {(!composer || needle) && options.length > count && <Button variant="ghost" size="sm" className="mt-2 w-full rounded-full" onPress={() => setCount(count + BATCH)}>{t('chat.emoji.more')}</Button>}
        </div>
      </div>
      {composer && <div className="flex h-10 shrink-0 items-center gap-2 border-t border-edge px-3 text-sm">
        {visiblePreview && <><EmojiText text={visiblePreview.unicode} /><span className="truncate">{caption}</span></>}
      </div>}
    </>
  );
}
