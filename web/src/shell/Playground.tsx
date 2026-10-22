import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../store';
import { localeOf, useT, type Key } from '../i18n';
import { BubbleCloud, BubblePair, BubblePeanut, type BubblePerson } from '../voice/Bubbles';
import { CallControls } from '../voice/VoiceView';
import { ART, EmptyState, LineArt, SignInArt, type ArtName } from '../ui/Illustrations';
import { WhereToUse, type Platform } from '../account/WhereToUse';

/**
 * Development only (open the app with #bubbles): the call layouts with whoever is on this server, and
 * made-up talking, so they can be checked without a microphone or a second person.
 */
export function Playground() {
  const { t, lang } = useT();
  const users = useStore((s) => s.users);
  const all = useMemo(() => Object.values(users).sort((a, b) => a.name.localeCompare(b.name, localeOf(lang))), [users, lang]);
  const [kind, setKind] = useState<'cloud' | 'pair' | 'peanut'>('peanut');
  const [count, setCount] = useState(5);
  const [talker, setTalker] = useState<string | null>(null);
  const people: BubblePerson[] = all.slice(0, Math.min(count, all.length)).map((u, i) => ({ id: u.id, muted: i === 3 }));
  const ids = people.map((p) => p.id).join(',');

  // Someone new talks every few seconds (sometimes nobody), like a real conversation.
  useEffect(() => {
    const list = ids.split(',').filter(Boolean);
    const tick = () => setTalker(Math.random() < 0.15 ? null : list[Math.floor(Math.random() * list.length)]);
    tick();
    const timer = setInterval(tick, 3200);
    return () => clearInterval(timer);
  }, [ids]);

  const speaking = talker ? [talker] : [];
  const Layout = kind === 'cloud' ? BubbleCloud : kind === 'pair' ? BubblePair : BubblePeanut;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-20 shrink-0 items-center gap-3 px-5">
        <h1 className="text-[20px] font-medium">{t('settings.playground.bubbles')}</h1>
        <span className="text-[14px] text-muted">{t('settings.playground.talking', { name: talker ? (users[talker]?.name ?? '') : t('settings.playground.nobody') })}</span>
        <span className="flex-1" />
        {(['cloud', 'pair', 'peanut'] as const).map((k) => (
          <button key={k} onClick={() => setKind(k)} className={`h-9 rounded-full px-4 text-[14px] ${kind === k ? 'bg-white text-black' : 'bg-default text-muted'}`}>
            {k === 'cloud' ? t('settings.playground.voiceChannel') : k === 'pair' ? t('settings.playground.dm') : t('settings.playground.group')}
          </button>
        ))}
        <input type="range" min={2} max={Math.max(2, all.length)} value={count} onChange={(e) => setCount(Number(e.target.value))} aria-label={t('settings.playground.howMany')} />
        <span className="w-6 text-[14px] text-muted">{count}</span>
      </header>
      <div className={`flex px-6 ${kind === 'cloud' ? 'min-h-0 flex-1' : kind === 'peanut' ? 'h-[300px]' : 'h-[230px]'}`}>
        <Layout people={people} speaking={speaking} live={false} />
      </div>
      <div className="pointer-events-none">
        <CallControls />
      </div>
      {kind !== 'cloud' && <div className="flex-1" />}
      <div className="flex flex-wrap gap-2 px-6 pb-6">
        {people.map((p) => (
          <button key={p.id} onClick={() => setTalker(p.id)} className="h-8 rounded-full bg-default px-3 text-[13px] text-muted hover:text-white">
            {t('settings.playground.says', { name: users[p.id]?.name ?? '' })}
          </button>
        ))}
      </div>
    </div>
  );
}

const EMPTY: { art: ArtName; id: string; where: 'main' | 'list' | 'dialog' }[] = [
  { art: 'couch', id: 'friends', where: 'main' },
  { art: 'away', id: 'online', where: 'main' },
  { art: 'mailbox', id: 'requests', where: 'main' },
  { art: 'channel', id: 'channel', where: 'main' },
  { art: 'chat', id: 'chat', where: 'main' },
  { art: 'group', id: 'group', where: 'main' },
  { art: 'voice', id: 'voice', where: 'main' },
  { art: 'nothing', id: 'nothing', where: 'main' },
  { art: 'messages', id: 'messages', where: 'list' },
  { art: 'search', id: 'searchChannels', where: 'list' },
  { art: 'tray', id: 'tray', where: 'dialog' },
  { art: 'search', id: 'searchFriends', where: 'dialog' },
  { art: 'group', id: 'allHere', where: 'dialog' },
];

/**
 * Development only (open the app with #art): the line drawings at any size, every empty state at the size it has
 * in the app (the content panel, the list on the left, a dialog), the "where to use Atrium" screen for each system
 * and the phone sign-in's picture.
 */
export function ArtPlayground() {
  const { t } = useT();
  const [platform, setPlatform] = useState<Platform>('mac');
  const [scale, setScale] = useState(() => Number(new URLSearchParams(location.search).get('scale')) || 3);
  const frame = 'flex flex-col overflow-hidden rounded-[24px] border-[0.5px] border-edge';
  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="flex items-center gap-3">
        <h1 className="text-[20px] font-medium">{t('settings.playground.art')}</h1>
        <input type="range" min={1} max={8} step={0.5} value={scale} onChange={(e) => setScale(Number(e.target.value))} aria-label={t('settings.playground.scale')} />
        <span className="text-[14px] text-muted">×{scale}</span>
      </div>
      <div className="mt-4 flex flex-wrap items-end gap-x-10 gap-y-6">
        {(Object.keys(ART) as ArtName[]).map((name) => (
          <figure key={name} className="flex flex-col items-center gap-2">
            <LineArt art={name} scale={scale} />
            <figcaption className="text-[12px] text-faint">{name}</figcaption>
          </figure>
        ))}
      </div>
      <h1 className="mt-10 text-[20px] font-medium">{t('settings.playground.empties')}</h1>
      <div className="mt-4 grid grid-cols-[repeat(auto-fill,minmax(360px,1fr))] gap-3">
        {EMPTY.map((e, i) => (
          <div
            key={i}
            data-shot={`empty-${i}`}
            className={`${frame} ${e.where === 'list' ? 'h-[300px] w-[320px]' : e.where === 'dialog' ? 'h-[300px] bg-overlay' : 'h-[420px]'}`}
          >
            <EmptyState art={e.art} title={t(`settings.playground.empty.${e.id}.title` as Key)} text={t(`settings.playground.empty.${e.id}.text` as Key)} compact={e.where !== 'main'} plate={e.where === 'dialog' ? 'var(--overlay)' : undefined} />
          </div>
        ))}
      </div>
      <div className="mt-10 flex items-center gap-2">
        <h1 className="mr-3 text-[20px] font-medium">{t('settings.playground.whereToUse')}</h1>
        {(['mac', 'windows', 'ios', 'android', 'other'] as const).map((p) => (
          <button key={p} onClick={() => setPlatform(p)} className={`h-9 rounded-full px-4 text-[14px] ${platform === p ? 'bg-white text-black' : 'bg-default text-muted'}`}>
            {p}
          </button>
        ))}
      </div>
      <div data-shot="where" className={`${frame} mt-4 h-[760px] ${platform === 'ios' || platform === 'android' ? 'w-[375px]' : ''}`}>
        <WhereToUse key={platform} platform={platform} onDone={() => setPlatform('mac')} />
      </div>
      <h1 className="mt-10 text-[20px] font-medium">{t('settings.playground.phoneSignIn')}</h1>
      <div data-shot="sign-in" className={`${frame} mt-4 w-[375px] bg-background`}>
        <SignInArt />
      </div>
    </div>
  );
}
