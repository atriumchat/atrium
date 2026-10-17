import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../store';
import { BubbleCloud, BubblePair, BubblePeanut, type BubblePerson } from '../voice/Bubbles';
import { CallControls } from '../voice/VoiceView';

/**
 * Development only (open the app with #bubbles): the call layouts with whoever is on this server, and
 * made-up talking, so they can be checked without a microphone or a second person.
 */
export function Playground() {
  const users = useStore((s) => s.users);
  const all = useMemo(() => Object.values(users).sort((a, b) => a.name.localeCompare(b.name, 'ru')), [users]);
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
        <h1 className="text-[20px] font-medium">Пузыри</h1>
        <span className="text-[14px] text-muted">говорит: {talker ? users[talker]?.name : 'никто'}</span>
        <span className="flex-1" />
        {(['cloud', 'pair', 'peanut'] as const).map((k) => (
          <button key={k} onClick={() => setKind(k)} className={`h-9 rounded-full px-4 text-[14px] ${kind === k ? 'bg-white text-black' : 'bg-default text-muted'}`}>
            {k === 'cloud' ? 'Голосовой канал' : k === 'pair' ? 'Личка' : 'Группа'}
          </button>
        ))}
        <input type="range" min={2} max={Math.max(2, all.length)} value={count} onChange={(e) => setCount(Number(e.target.value))} aria-label="Сколько людей" />
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
            {users[p.id]?.name} говорит
          </button>
        ))}
      </div>
    </div>
  );
}
