import { useState } from 'react';
import { Button, Input } from '@heroui/react';
import { MagnifyingGlassIcon, PlusIcon } from '@heroicons/react/24/outline';
import { useT } from '../i18n';
import { useStore } from '../store';
import type { Sticker } from '../types';
import { EmojiText } from '../ui/EmojiText';
import { usePersonalItems } from './expressionPreferences';

export const stickerUrl = (id: string) => `/api/server/stickers/${encodeURIComponent(id)}/image`;

export function StickerPanel({ onPick, onAdd }: { onPick: (id: string) => void; onAdd: () => void }) {
  const { t, lang } = useT();
  const stickers = useStore((s) => s.stickers);
  const me = useStore((s) => s.me?.id);
  const canAdd = useStore((s) => s.isAdmin);
  const server = useStore((s) => s.serverName);
  const [recent, saveRecent] = usePersonalItems('recent-stickers', me);
  const [query, setQuery] = useState('');
  const [preview, setPreview] = useState<Sticker | null>(null);
  const needle = query.trim().toLocaleLowerCase(lang);
  const available = stickers.filter((sticker) => sticker.active);
  const results = available.filter((sticker) => [sticker.name, sticker.emoji, sticker.description].some((value) => value.toLocaleLowerCase(lang).includes(needle)));
  const used = recent.map((id) => available.find((sticker) => sticker.id === id)).filter((sticker): sticker is Sticker => !!sticker).slice(0, 8);
  const groups = needle ? [{ label: '', items: results }] : [
    ...(used.length ? [{ label: t('chat.sticker.recent'), items: used }] : []),
    { label: server, items: available },
  ];
  return (
    <>
      <div className="flex items-center gap-2 border-b border-edge px-3 py-3">
        <div className="relative min-w-0 flex-1">
          <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 z-10 size-4 -translate-y-1/2 text-muted" />
          <Input type="search" aria-label={t('chat.sticker.search')} placeholder={t('chat.sticker.search')} value={query} onChange={(e) => { setQuery(e.target.value); setPreview(null); }} className="w-full rounded-full border border-edge bg-window pl-9 max-md:text-base" />
        </div>
        {canAdd && <Button variant="tertiary" isIconOnly aria-label={t('chat.sticker.add')} onPress={onAdd} className="size-9 min-w-9 rounded-full p-0"><PlusIcon className="size-4" /></Button>}
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {groups.map(({ label, items }) => (
          <section key={label} aria-label={label || undefined}>
            {label && <h3 className="mb-2 text-sm font-medium">{label}</h3>}
            {items.length ? <div className="grid grid-cols-4 gap-1 max-sm:grid-cols-3">
              {items.map((sticker) => (
                <Button key={sticker.id} variant="ghost" aria-label={sticker.name} onHoverChange={(hover) => setPreview(hover ? sticker : null)} onFocusChange={(focus) => setPreview(focus ? sticker : null)} onPress={() => {
                  saveRecent([sticker.id, ...recent.filter((id) => id !== sticker.id)].slice(0, 16));
                  onPick(sticker.id);
                }} className="aspect-square h-auto w-full min-w-0 rounded-row p-1.5">
                  <picture className="block size-full">
                    <source media="(prefers-reduced-motion: reduce)" srcSet={stickerUrl(sticker.id) + '?still=true'} />
                    <img src={stickerUrl(sticker.id)} alt="" loading="lazy" className="size-full object-contain" />
                  </picture>
                </Button>
              ))}
            </div> : <p className="py-5 text-center text-sm text-muted">{t(needle ? 'chat.sticker.noResults' : 'chat.sticker.empty')}</p>}
          </section>
        ))}
      </div>
      {preview && <div className="flex items-center gap-2 border-t border-white/10 px-3 py-2 text-sm"><EmojiText text={preview.emoji} /><span className="truncate">{preview.name}</span></div>}
    </>
  );
}
