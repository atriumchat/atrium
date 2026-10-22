import { useEffect, useState, type ReactNode } from 'react';
import { AtriumMark } from '../ui/Logo';
import {
  ChevronDownIcon,
  GearIcon,
  HashIcon,
  HeadphonesIcon,
  HomeFilledIcon,
  HomeIcon,
  MicIcon,
  MicSlashIcon,
  PhoneDownIcon,
  PhoneIcon,
  PlusIcon,
  ScreenIcon,
  SearchIcon,
  SmileIcon,
  SpeakerIcon,
  UserPlusIcon,
  UsersIcon,
  VideoIcon,
} from '../ui/icons';

/**
 * Design work, development only (#metro, #metro=call): the main window. Discord's order and habits stay (server rail,
 * channels and rooms, your card at the foot, the chat); on top, a little of our own: places named big and light (the
 * Metro look), flat surfaces without glows, and from Webex a room's call as a
 * timer pill, white dots for new and red only for what's yours, labelled call buttons with a device choice. Made up to
 * the worst case: 20-character names, up to 25 people in a call. Nothing here talks to a server.
 */

type Person = { id: string; name: string; color: string; online?: boolean };
type Chat = { id: string; who: string; text: string; time: string; unread?: boolean; call?: string };
type Channel = { id: string; name: string; topic: string; unread?: boolean; mentions?: number };
type Room = { id: string; name: string; people: string[]; time?: string };
type Message = { id: string; from: string; time: string; text: string };

const PEOPLE: Record<string, Person> = {
  me: { id: 'me', name: 'ТимурКоролевДискорда', color: '#6366f1', online: true },
  ann: { id: 'ann', name: 'Аня', color: '#ec4899', online: true },
  dim: { id: 'dim', name: 'Дмитрий_Нагибатор_01', color: '#f59e0b', online: true },
  lera: { id: 'lera', name: 'Лера', color: '#10b981' },
  oleg: { id: 'oleg', name: 'OlegTheDestroyer2004', color: '#3b82f6', online: true },
  max: { id: 'max', name: 'Макс', color: '#ef4444' },
  sasha: { id: 'sasha', name: 'Саша', color: '#8b5cf6', online: true },
  kate: { id: 'kate', name: 'Катя', color: '#14b8a6' },
  igor: { id: 'igor', name: 'Игорь', color: '#f97316' },
  nik: { id: 'nik', name: 'Ник', color: '#22c55e' },
  vera: { id: 'vera', name: 'Вера', color: '#e11d48' },
  lyosha: { id: 'lyosha', name: 'ВеликийКомбинатор228', color: '#0ea5e9' },
  zhenya: { id: 'zhenya', name: 'Женя', color: '#a855f7' },
  roma: { id: 'roma', name: 'Рома', color: '#eab308' },
  polina: { id: 'polina', name: 'Полина', color: '#06b6d4' },
  gleb: { id: 'gleb', name: 'Глеб', color: '#84cc16' },
  yana: { id: 'yana', name: 'Яна', color: '#f43f5e' },
  artem: { id: 'artem', name: 'Артём', color: '#64748b' },
  nastya: { id: 'nastya', name: 'Настя', color: '#d946ef' },
  vlad: { id: 'vlad', name: 'Влад', color: '#10b981' },
  mila: { id: 'mila', name: 'Мила', color: '#fb7185' },
  den: { id: 'den', name: 'Денис', color: '#38bdf8' },
  olya: { id: 'olya', name: 'Оля', color: '#f472b6' },
  timofey: { id: 'timofey', name: 'xX_Тимофей_Xx_1999', color: '#a3e635' },
  liza: { id: 'liza', name: 'Лиза', color: '#c084fc' },
};

const CHATS: Chat[] = [
  { id: 'c1', who: 'ann', text: 'Заходи в голосовой, мы уже там', time: '12:41', unread: true },
  { id: 'c2', who: 'dim', text: 'Кто берёт хила?', time: '12:30', call: '04:51' },
  { id: 'c3', who: 'oleg', text: 'Скинул конфиг, глянь', time: '11:02', unread: true },
  { id: 'c4', who: 'lera', text: 'Ахахах', time: 'Вчера' },
  { id: 'c5', who: 'max', text: 'ок', time: 'Пн' },
  { id: 'c6', who: 'sasha', text: 'Фото', time: 'Пн' },
];

const CHANNELS: Channel[] = [
  { id: 'general', name: 'общий', topic: 'Всё подряд' },
  { id: 'games', name: 'игры', topic: 'Во что играем', unread: true, mentions: 1 },
  { id: 'memes', name: 'мемы', topic: 'Без политики', unread: true },
  { id: 'music', name: 'музыка', topic: 'Что слушаем' },
];

const ROOMS: Room[] = [
  { id: 'r1', name: 'Общая', people: ['ann', 'dim', 'oleg'], time: '23:14' },
  { id: 'r2', name: 'Игры', people: ['sasha'], time: '01:02' },
  { id: 'r3', name: 'Тихая', people: [] },
];

const MESSAGES: Message[] = [
  { id: 'm1', from: 'dim', time: '12:02', text: 'Сегодня в девять собираемся, кто в деле?' },
  { id: 'm2', from: 'ann', time: '12:05', text: 'Я точно, только поем' },
  { id: 'm3', from: 'oleg', time: '12:10', text: 'Обновил сервер, звук теперь не отстаёт даже у Макса' },
  { id: 'm4', from: 'max', time: '12:11', text: 'подтверждаю' },
  { id: 'm5', from: 'lera', time: '12:38', text: 'Скиньте ссылку на голосовой, я с телефона' },
  { id: 'm6', from: 'ann', time: '12:41', text: 'Заходи в «Общую», мы уже там' },
];

// Panels on black with modest corners; inside, everything concentric to them.
const PANEL = 'overflow-hidden rounded-[20px] bg-[#0c0c0e]';

type Mode = 'home' | 'server';

export function MetroShell() {
  const [mode, setMode] = useState<Mode>('server');
  const [chat, setChat] = useState('c1');
  const [channel, setChannel] = useState('general');
  // #metro=call opens straight in the call.
  const [call, setCall] = useState<string | null>(() => (location.hash === '#metro=call' ? 'r1' : null));
  const [mic, setMic] = useState(true);

  const current = CHANNELS.find((c) => c.id === channel) ?? CHANNELS[0];
  return (
    <div className="flex h-full gap-2 bg-black p-2 text-[#ededef]">
      <Rail
        mode={mode}
        onMode={(m) => {
          setMode(m);
          setCall(null);
        }}
      />
      <section className={`${PANEL} flex w-[312px] shrink-0 flex-col`}>
        {mode === 'home' ? (
          <HomeList
            open={chat}
            onOpen={(id) => {
              setChat(id);
              setCall(null);
            }}
          />
        ) : (
          <ServerList
            open={call ? null : channel}
            room={call}
            onChannel={(id) => {
              setChannel(id);
              setCall(null);
            }}
            onRoom={setCall}
          />
        )}
        <YouCard inCall={call ? (ROOMS.find((r) => r.id === call)?.name ?? null) : null} mic={mic} onMic={() => setMic((v) => !v)} onLeave={() => setCall(null)} />
      </section>
      <main className={`${PANEL} flex min-w-0 flex-1 flex-col`}>
        {call ? (
          <CallStage room={ROOMS.find((r) => r.id === call) ?? ROOMS[0]} mic={mic} onMic={() => setMic((v) => !v)} onLeave={() => setCall(null)} />
        ) : mode === 'home' ? (
          <Chat title={PEOPLE[CHATS.find((c) => c.id === chat)?.who ?? 'ann'].name} sub="в сети" dm onJoin={() => setCall('r1')} />
        ) : (
          <Chat title={current.name} sub={current.topic} room={ROOMS[0]} onJoin={() => setCall('r1')} />
        )}
      </main>
    </div>
  );
}

/** The rail: home, then the server. Where you are is white; elsewhere graphite. */
function Rail({ mode, onMode }: { mode: Mode; onMode: (m: Mode) => void }) {
  return (
    <nav className={`${PANEL} flex w-[72px] shrink-0 flex-col items-center gap-2 py-3`}>
      <RailItem label="Чаты" active={mode === 'home'} badge={mode === 'home' ? 0 : 3} onPress={() => onMode('home')}>
        {mode === 'home' ? <HomeFilledIcon size={24} /> : <HomeIcon size={24} />}
      </RailItem>
      <span className="my-0.5 h-px w-8 bg-white/10" />
      <RailItem label="Подвал" active={mode === 'server'} onPress={() => onMode('server')}>
        <AtriumMark size={28} filled={mode === 'server'} />
      </RailItem>
      <RailItem label="Добавить сервер" active={false} onPress={() => undefined} quiet>
        <PlusIcon size={22} />
      </RailItem>
    </nav>
  );
}

function RailItem(props: { label: string; active: boolean; badge?: number; quiet?: boolean; onPress: () => void; children: ReactNode }) {
  return (
    <button
      aria-label={props.label}
      title={props.label}
      aria-current={props.active || undefined}
      onClick={props.onPress}
      className={`relative flex h-12 w-12 items-center justify-center rounded-full transition-colors ${
        props.active ? 'bg-white text-black' : props.quiet ? 'border border-dashed border-white/25 text-[#a1a1aa] hover:text-white' : 'bg-[#1e1e22] text-white hover:bg-[#28282d]'
      }`}
    >
      {props.children}
      {!!props.badge && (
        <span className="absolute -bottom-0.5 -right-0.5 min-w-5 rounded-full bg-[#ff453a] px-1 text-center text-[11px] font-bold leading-5 text-white ring-[3px] ring-[#0c0c0e]">
          {props.badge}
        </span>
      )}
    </button>
  );
}

/** The top of the list: the place's name big and light, a line under it, the search. */
function ListHead({ title, sub, action }: { title: string; sub: string; action?: ReactNode }) {
  return (
    <header className="shrink-0 px-5 pb-2 pt-5">
      <div className="flex items-center gap-2">
        <h1 className="min-w-0 flex-1 truncate text-[32px] font-light leading-[38px] tracking-[-0.8px] text-white">{title}</h1>
        {action}
      </div>
      <p className="text-[14px] text-[#a1a1aa]">{sub}</p>
      <label className="mt-4 flex h-10 items-center gap-2 rounded-full bg-[#1e1e22] px-4 text-[#71717a] focus-within:ring-2 focus-within:ring-[#4a4a52]">
        <SearchIcon size={16} />
        <input placeholder="Поиск" aria-label="Поиск" className="min-w-0 flex-1 bg-transparent text-[15px] text-white outline-none placeholder:text-[#71717a]" />
      </label>
    </header>
  );
}

function GhostButton({ label, onPress, children }: { label: string; onPress?: () => void; children: ReactNode }) {
  return (
    <button aria-label={label} title={label} onClick={onPress} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[#a1a1aa] hover:bg-[#1e1e22] hover:text-white">
      {children}
    </button>
  );
}

/** A call that's on: its running time in a pill, as in Webex; pressing it joins. */
function CallPill({ time, onPress }: { time: string; onPress?: () => void }) {
  return (
    <span
      role={onPress ? 'button' : undefined}
      onClick={(e) => {
        if (!onPress) return;
        e.stopPropagation();
        onPress();
      }}
      className="flex shrink-0 items-center gap-1 rounded-full bg-white/[0.08] px-2 text-[12px] font-medium leading-6 tabular-nums text-white"
    >
      <span className="h-1.5 w-1.5 rounded-full bg-white" />
      {time}
    </span>
  );
}

/** New here: a white dot. Red is kept for what's yours: mentions, a DM's count. */
function Dot() {
  return <span className="h-2 w-2 shrink-0 rounded-full bg-white" />;
}

function HomeList({ open, onOpen }: { open: string; onOpen: (id: string) => void }) {
  return (
    <>
      <ListHead
        title="Чаты"
        sub="6 переписок"
        action={
          <GhostButton label="Новая группа">
            <PlusIcon size={20} />
          </GhostButton>
        }
      />
      <div className="flex-1 overflow-y-auto px-2 pb-3">
        <button className="mb-1 flex h-11 w-full items-center gap-3 rounded-full px-4 text-[16px] font-medium text-[#a1a1aa] hover:bg-white/[0.04] hover:text-white">
          <UsersIcon size={19} />
          Друзья
        </button>
        <h2 className="px-3 pb-1 pt-3 text-[14px] font-medium text-[#a1a1aa]">Переписки</h2>
        <div className="space-y-0.5">
          {CHATS.map((c) => {
            const p = PEOPLE[c.who];
            const active = open === c.id;
            return (
              <button
                key={c.id}
                onClick={() => onOpen(c.id)}
                className={`flex h-[60px] w-full items-center gap-3 rounded-[16px] px-2.5 text-left transition-colors ${active ? 'bg-[#1e1e22]' : 'hover:bg-white/[0.04]'}`}
              >
                <Face person={p} size={40} ring={active ? '#1e1e22' : '#0c0c0e'} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className={`min-w-0 flex-1 truncate text-[16px] leading-5 ${c.unread ? 'font-semibold text-white' : 'font-medium text-white/85'}`}>{p.name}</span>
                    {c.call ? <CallPill time={c.call} /> : <span className="shrink-0 text-[13px] text-[#71717a] tabular-nums">{c.time}</span>}
                  </span>
                  <span className="mt-0.5 flex items-center gap-2">
                    <span className={`min-w-0 flex-1 truncate text-[14px] leading-5 ${c.unread ? 'text-white/80' : 'text-[#a1a1aa]'}`}>{c.text}</span>
                    {c.unread && <Dot />}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}

function ServerList(props: { open: string | null; room: string | null; onChannel: (id: string) => void; onRoom: (id: string) => void }) {
  return (
    <>
      <ListHead
        title="Подвал"
        sub="12 человек · 5 в сети"
        action={
          <GhostButton label="Позвать">
            <UserPlusIcon size={19} />
          </GhostButton>
        }
      />
      <div className="flex-1 overflow-y-auto px-2 pb-3">
        <Group title="Каналы">
          {CHANNELS.map((c) => {
            const active = props.open === c.id;
            const lit = active || c.unread;
            return (
              <button
                key={c.id}
                onClick={() => props.onChannel(c.id)}
                className={`flex h-10 w-full items-center gap-2.5 rounded-full px-3.5 text-left text-[16px] transition-colors ${
                  active ? 'bg-[#1e1e22] font-medium text-white' : lit ? 'font-semibold text-white hover:bg-white/[0.04]' : 'font-medium text-[#a1a1aa] hover:bg-white/[0.04] hover:text-white'
                }`}
              >
                <HashIcon size={18} className="shrink-0 opacity-60" />
                <span className="min-w-0 flex-1 truncate">{c.name}</span>
                {!active && (c.mentions ? <Count n={c.mentions} /> : c.unread && <Dot />)}
              </button>
            );
          })}
        </Group>
        <Group title="Комнаты">
          {ROOMS.map((r) => {
            const here = props.room === r.id;
            return (
              <button
                key={r.id}
                onClick={() => props.onRoom(r.id)}
                className={`flex w-full items-center gap-2.5 rounded-[18px] px-3.5 text-left transition-colors ${r.people.length ? 'py-2' : 'h-10'} ${
                  here ? 'bg-[#1e1e22] text-white' : r.people.length ? 'text-white hover:bg-white/[0.04]' : 'text-[#a1a1aa] hover:bg-white/[0.04] hover:text-white'
                }`}
              >
                <SpeakerIcon size={18} className={`shrink-0 ${here ? '' : 'opacity-60'}`} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[16px] font-medium leading-5">{r.name}</span>
                  {r.people.length > 0 && (
                    <span className="mt-1.5 flex items-center gap-2">
                      <Stack ids={r.people} ring={here ? '#1e1e22' : '#0c0c0e'} />
                      <span className="min-w-0 truncate text-[13px] text-[#a1a1aa]">{r.people.map((id) => PEOPLE[id].name).join(', ')}</span>
                    </span>
                  )}
                </span>
                {r.time && <CallPill time={r.time} />}
              </button>
            );
          })}
        </Group>
      </div>
    </>
  );
}

/** Who's in a room, as overlapping faces. */
function Stack({ ids, ring, size = 20 }: { ids: string[]; ring: string; size?: number }) {
  return (
    <span className="flex shrink-0">
      {ids.map((id, i) => (
        <span key={id} style={{ marginLeft: i ? -Math.round(size * 0.3) : 0 }}>
          <Face person={PEOPLE[id]} size={size} ring={ring} border />
        </span>
      ))}
    </span>
  );
}

/** A section of channels or rooms: its name folds it, + adds one. */
function Group({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <section className="pt-3">
      <div className="flex items-center pb-1 pl-3 pr-1">
        <button onClick={() => setOpen((v) => !v)} className="flex flex-1 items-center gap-1 text-left text-[14px] font-medium text-[#a1a1aa] hover:text-white">
          {title}
          <ChevronDownIcon size={14} className={`transition-transform ${open ? '' : '-rotate-90'}`} />
        </button>
        <GhostButton label="Добавить">
          <PlusIcon size={16} />
        </GhostButton>
      </div>
      {open && <div className="space-y-0.5">{children}</div>}
    </section>
  );
}

/** Your card at the foot of the list: who you are, mic and sound, settings; the call you're in above it. */
function YouCard({ inCall, mic, onMic, onLeave }: { inCall: string | null; mic: boolean; onMic: () => void; onLeave: () => void }) {
  return (
    <div className="shrink-0 p-2">
      <div className="overflow-hidden rounded-[14px] bg-[#141417]">
        {inCall && (
          <div className="flex items-center gap-2 border-b border-white/[0.06] px-3 py-2.5">
            <span className="min-w-0 flex-1">
              <span className="block text-[14px] font-medium text-white">В звонке</span>
              <span className="block truncate text-[12px] text-[#a1a1aa]">{inCall} · Подвал</span>
            </span>
            <GhostButton label="Выйти" onPress={onLeave}>
              <PhoneDownIcon size={18} />
            </GhostButton>
          </div>
        )}
        <div className="flex items-center gap-1 p-2">
          <span className="flex min-w-0 flex-1 items-center gap-2.5 rounded-full p-1">
            <Face person={PEOPLE.me} size={36} ring="#141417" />
            <span className="min-w-0">
              <span className="block truncate text-[15px] font-medium leading-5 text-white">{PEOPLE.me.name}</span>
              <span className="block truncate text-[12px] leading-4 text-[#a1a1aa]">В сети</span>
            </span>
          </span>
          <GhostButton label={mic ? 'Выключить микрофон' : 'Включить микрофон'} onPress={onMic}>
            {mic ? <MicIcon size={19} /> : <MicSlashIcon size={19} className="text-[#ff453a]" />}
          </GhostButton>
          <GhostButton label="Звук">
            <HeadphonesIcon size={19} />
          </GhostButton>
          <GhostButton label="Настройки">
            <GearIcon size={19} />
          </GhostButton>
        </div>
      </div>
    </div>
  );
}

/**
 * A chat: the name big and light at the top, the way the list names its place; a call that's on in the room beside
 * it, with Join. History opens on the name again, not on Discord's "Welcome to #".
 */
function Chat({ title, sub, dm = false, room, onJoin }: { title: string; sub: string; dm?: boolean; room?: Room; onJoin: () => void }) {
  return (
    <>
      <header className="flex shrink-0 items-center gap-3 px-6 pb-3 pt-5">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[32px] font-light leading-[38px] tracking-[-0.8px] text-white">
            {!dm && <span className="text-[#5a5a63]">#</span>}
            {title}
          </h2>
          <p className="truncate text-[14px] text-[#a1a1aa]">{sub}</p>
        </div>
        {room?.time ? (
          <button onClick={onJoin} className="flex h-10 items-center gap-2.5 whitespace-nowrap rounded-full bg-[#f2f2f4] pl-1.5 pr-4 text-[15px] font-medium text-[#0c0c0e] hover:bg-white">
            <Stack ids={room.people} ring="#f2f2f4" />
            Войти · {room.name}
          </button>
        ) : (
          dm && (
            <button onClick={onJoin} className="flex h-10 items-center gap-2 whitespace-nowrap rounded-full bg-[#f2f2f4] px-4 text-[15px] font-medium text-[#0c0c0e] hover:bg-white">
              <PhoneIcon size={16} />
              Позвонить
            </button>
          )
        )}
        <GhostButton label="Участники">
          <UsersIcon size={19} />
        </GhostButton>
        <GhostButton label="Поиск по чату">
          <SearchIcon size={18} />
        </GhostButton>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex flex-col gap-1 px-4 py-4">
          {MESSAGES.map((m, i) => (
            <div key={m.id}>
              {i === 4 && (
                <div className="my-3 flex items-center gap-3 px-2 text-[13px] font-medium text-white">
                  Новые
                  <span className="h-px flex-1 bg-white/25" />
                </div>
              )}
              <article className="flex gap-3.5 rounded-[14px] px-2 py-1.5 hover:bg-white/[0.03]">
                <Face person={PEOPLE[m.from]} size={40} />
                <div className="min-w-0">
                  <p className="flex items-baseline gap-2">
                    <span className="text-[16px] font-semibold text-white">{PEOPLE[m.from].name}</span>
                    <span className="text-[12px] text-[#71717a] tabular-nums">{m.time}</span>
                  </p>
                  <p className="text-[16px] leading-6 text-[#dbdbe0]">{m.text}</p>
                </div>
              </article>
            </div>
          ))}
          <p className="mt-1 flex items-center justify-end gap-2 px-2 text-[12px] text-[#71717a]">
            Прочитали
            <Stack ids={['dim', 'oleg', 'lera']} ring="#0c0c0e" />
          </p>
        </div>
      </div>
      <footer className="shrink-0 px-5 pb-5">
        <label className="flex h-12 items-center gap-2 rounded-full bg-[#1e1e22] pl-1.5 pr-3 focus-within:ring-2 focus-within:ring-[#4a4a52]">
          <span className="flex h-9 w-9 items-center justify-center rounded-full text-[#a1a1aa] hover:text-white">
            <PlusIcon size={20} />
          </span>
          <input placeholder={dm ? `Сообщение для ${title}` : `Сообщение в #${title}`} aria-label="Сообщение" className="min-w-0 flex-1 bg-transparent text-[16px] text-white outline-none placeholder:text-[#71717a]" />
          <SmileIcon size={20} className="text-[#a1a1aa]" />
        </label>
      </footer>
    </>
  );
}

/**
 * A call: people as tiles between 16:9 and square, as big as the window allows, rows centred. Tiles don't shrink below MIN_TILE: whoever
 * doesn't fit, and anyone past nine tiles, folds into a last "+N" tile with their faces, which opens the list of everyone at the side. The order
 * puts first whoever has a camera or a screen on and whoever talked last; quiet people without a camera fold first.
 * Showing a screen (or pressing a tile) focuses it: big in the middle, everyone else in a strip under it, as in
 * Discord. Whoever talks gets a white frame; a name of any length truncates.
 * The − / + in the header is for trying sizes here.
 */
const MIN_TILE = 168;
// A tile: one plain fill, no stroke; whoever talks gets a white stroke on the inside of its edge.
const TILE = 'bg-[#18181b]';
const TALKING = 'ring-2 ring-inset ring-white';
// Never more tiles than this: past it, the ninth becomes "+N".
const MAX_TILES = 9;

type Tile = { id: string; video: boolean; muted: boolean };

function CallStage({ room, mic, onMic, onLeave }: { room: Room; mic: boolean; onMic: () => void; onLeave: () => void }) {
  const [cam, setCam] = useState(false);
  const [screen, setScreen] = useState(false);
  const [focus, setFocus] = useState<string | null>(null);
  const [side, setSide] = useState(false);
  const everyone = ['me', ...room.people, ...Object.keys(PEOPLE).filter((id) => id !== 'me' && !room.people.includes(id))];
  const [count, setCount] = useState(1 + room.people.length);
  const [area, setArea] = useState<HTMLDivElement | null>(null);

  // Made up: every fourth person has a camera on, every third is muted; the second one is talking.
  const tiles: Tile[] = everyone.slice(0, count).map((id, i) => ({
    id,
    video: id === 'me' ? cam : i % 4 === 3,
    muted: id === 'me' ? !mic : i % 3 === 2,
  }));
  const talking = tiles[1]?.id;
  const ordered = [...tiles].sort((a, b) => rank(b, talking) - rank(a, talking));
  const focused = screen && !focus ? 'screen' : focus;

  const fit = useTileGrid(area, focused ? 0 : ordered.length);
  const shown = fit.fits < ordered.length ? ordered.slice(0, Math.max(1, fit.fits - 1)) : ordered;
  const hidden = ordered.slice(shown.length);

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex shrink-0 items-center gap-3 px-6 pb-3 pt-5">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-[32px] font-light leading-[38px] tracking-[-0.8px] text-white">{room.name}</h2>
            <p className="text-[14px] tabular-nums text-[#a1a1aa]">
              {count} в звонке · {room.time ?? '00:12'}
            </p>
          </div>
          <span className="flex items-center gap-1 rounded-full bg-[#1e1e22] p-1 text-[13px] tabular-nums text-[#a1a1aa]">
            <GhostButton label="Меньше людей" onPress={() => setCount((n) => Math.max(2, n - 1))}>
              −
            </GhostButton>
            {count}
            <GhostButton label="Больше людей" onPress={() => setCount((n) => Math.min(everyone.length, n + 1))}>
              +
            </GhostButton>
          </span>
          <GhostButton label="Участники" onPress={() => setSide((v) => !v)}>
            <UsersIcon size={19} />
          </GhostButton>
          <GhostButton label="Чат комнаты">
            <HashIcon size={19} />
          </GhostButton>
        </header>

        {focused ? (
          <div className="flex min-h-0 flex-1 flex-col gap-2 px-5 pb-1">
            <button onClick={() => setFocus(null)} className={`relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-[16px] ${TILE} ${focused === talking ? TALKING : ''}`} aria-label="Обратно к сетке">
              {focused === 'screen' ? (
                <span className="flex flex-col items-center gap-3 text-[#71717a]">
                  <ScreenIcon size={48} />
                  <span className="text-[15px]">Экран: Вы</span>
                </span>
              ) : (
                <TileFace tile={tiles.find((t) => t.id === focused) ?? tiles[0]} height={320} />
              )}
            </button>
            {/* Everyone else in a strip under it, scrolled sideways when it's longer than the window. */}
            <div className="no-scrollbar flex shrink-0 gap-2 overflow-x-auto px-1 py-1">
              {ordered
                .filter((t) => t.id !== focused)
                .map((t) => (
                  <button key={t.id} onClick={() => setFocus(t.id)} className={`relative h-[90px] w-[160px] shrink-0 overflow-hidden rounded-[12px] ${TILE} ${t.id === talking ? TALKING : ''}`}>
                    <TileFace tile={t} height={90} />
                  </button>
                ))}
            </div>
          </div>
        ) : (
          <div ref={setArea} className="flex min-h-0 flex-1 flex-wrap content-center justify-center gap-2 px-5 pb-1">
            {shown.map((t) => (
              <button key={t.id} onClick={() => setFocus(t.id)} className={`relative shrink-0 overflow-hidden rounded-[16px] ${TILE} ${t.id === talking ? TALKING : ''}`} style={{ width: fit.tileW, height: fit.tileH }}>
                <TileFace tile={t} height={fit.tileH} />
              </button>
            ))}
            {hidden.length > 0 && (
              <button
                onClick={() => setSide(true)}
                className={`flex shrink-0 flex-col items-center justify-center gap-3 rounded-[16px] ${TILE} text-white hover:bg-[#1e1e22]`}
                style={{ width: fit.tileW, height: fit.tileH }}
              >
                <Stack ids={hidden.slice(0, 4).map((t) => t.id)} ring="#18181b" size={Math.round(Math.min(56, Math.max(24, fit.tileH * 0.22)))} />
                <span className={`font-medium ${fit.tileH < 120 ? 'text-[13px]' : 'text-[16px]'}`}>+{hidden.length}</span>
              </button>
            )}
          </div>
        )}

        {/* Narrower than the labelled buttons: the labels go, the icons stay (a label never wraps). */}
        <footer className="@container flex shrink-0 items-center justify-center gap-2 px-5 py-5">
          <CallButton on={!mic} onPress={onMic} icon={mic ? <MicIcon size={18} /> : <MicSlashIcon size={18} />} choose>
            Микрофон
          </CallButton>
          <CallButton on={cam} onPress={() => setCam((v) => !v)} icon={<VideoIcon size={18} />} choose>
            Камера
          </CallButton>
          <CallButton
            on={screen}
            onPress={() => {
              setScreen((v) => !v);
              setFocus(null);
            }}
            icon={<ScreenIcon size={18} />}
          >
            Экран
          </CallButton>
          <button aria-label="Выйти" onClick={onLeave} className="ml-2 flex h-11 items-center gap-2 whitespace-nowrap rounded-full bg-[#ff453a] px-4 text-[15px] font-medium text-white hover:brightness-110 @[600px]:px-5">
            <PhoneDownIcon size={18} />
            <span className="hidden @[600px]:inline">Выйти</span>
          </button>
        </footer>
      </div>

      {side && <People tiles={ordered} talking={talking} onClose={() => setSide(false)} />}
    </div>
  );
}

/** Camera or screen first, then whoever is talking, then the rest in the order they came. */
function rank(t: Tile, talking: string | undefined) {
  return (t.video ? 2 : 0) + (t.id === talking ? 1 : 0);
}

/**
 * What's in a tile: the face sized to the tile (about 40% of its height) and the name at the foot, with a camera mark
 * when the camera is on (made up: no real video here). The tile itself carries the fill and the talking frame.
 */
function TileFace({ tile, height }: { tile: Tile; height: number }) {
  const person = PEOPLE[tile.id];
  const name = tile.id === 'me' ? 'Вы' : person.name;
  const small = height < 120;
  const face = Math.round(Math.min(128, Math.max(28, height * 0.4)));
  return (
    <span className="absolute inset-0 flex items-center justify-center">
      <Face person={person} size={face} dot={false} />
      <span
        title={name}
        className={`absolute flex max-w-[calc(100%-16px)] items-center gap-1.5 rounded-full bg-black/55 font-medium text-white ${small ? 'bottom-1.5 left-1.5 px-2 py-0.5 text-[12px]' : 'bottom-2.5 left-2.5 px-2.5 py-1 text-[13px]'}`}
      >
        {tile.muted ? <MicSlashIcon size={12} className="shrink-0 text-[#ff453a]" /> : <MicIcon size={12} className="shrink-0" />}
        {tile.video && <VideoIcon size={12} className="shrink-0" />}
        <span className="min-w-0 truncate">{name}</span>
      </span>
    </span>
  );
}

/** Everyone in the call, at the side: the "+N" tile and the people button open it. */
function People({ tiles, talking, onClose }: { tiles: Tile[]; talking: string | undefined; onClose: () => void }) {
  return (
    <aside className="flex w-[280px] shrink-0 flex-col border-l border-white/[0.06]">
      <header className="flex h-[76px] shrink-0 items-center gap-2 pl-5 pr-3">
        <h3 className="flex-1 text-[20px] font-light tracking-[-0.3px] text-white">Участники · {tiles.length}</h3>
        <GhostButton label="Закрыть" onPress={onClose}>
          <span className="text-[20px] leading-none">×</span>
        </GhostButton>
      </header>
      <ul className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {tiles.map((t) => {
          const name = t.id === 'me' ? `${PEOPLE.me.name} (вы)` : PEOPLE[t.id].name;
          return (
            <li key={t.id} className="flex h-11 items-center gap-2.5 rounded-full px-2.5 hover:bg-white/[0.04]">
              <Face person={PEOPLE[t.id]} size={28} />
              <span title={name} className={`min-w-0 flex-1 truncate text-[15px] ${t.id === talking ? 'font-medium text-white' : 'text-[#dbdbe0]'}`}>
                {name}
              </span>
              {t.video && <VideoIcon size={15} className="shrink-0 text-[#a1a1aa]" />}
              {t.muted ? <MicSlashIcon size={15} className="shrink-0 text-[#ff453a]" /> : <MicIcon size={15} className="shrink-0 text-[#a1a1aa]" />}
            </li>
          );
        })}
      </ul>
    </aside>
  );
}

/**
 * The tiles for n people in this area. A tile may be anything from 16:9 to square, so it fills its cell (no bands
 * above and below, on a wide window or a tall one) without turning into a strip; the column count is the one that gives the largest tile.
 * `fits`: how many tiles fit at MIN_TILE wide or more, at most MAX_TILES.
 */
function useTileGrid(area: HTMLDivElement | null, n: number) {
  const [size, setSize] = useState({ w: 800, h: 500 });
  useEffect(() => {
    if (!area) return;
    const watch = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    watch.observe(area);
    return () => watch.disconnect();
  }, [area]);
  const best = (k: number) => {
    const gap = 8;
    let tile = { w: 0, h: 0 };
    for (let cols = 1; cols <= k; cols++) {
      const rows = Math.ceil(k / cols);
      const cellW = (size.w - gap * (cols - 1)) / cols;
      const cellH = (size.h - gap * (rows - 1)) / rows;
      const w = Math.min(cellW, (cellH * 16) / 9);
      const h = Math.min(cellH, w);
      if (w * h > tile.w * tile.h) tile = { w: Math.floor(w), h: Math.floor(h) };
    }
    return tile;
  };
  let fits = Math.min(n, MAX_TILES);
  while (fits > 1 && best(fits).w < MIN_TILE) fits--;
  const tile = best(fits);
  return { fits, tileW: tile.w, tileH: tile.h };
}

/** A call button with its name; `choose` adds Webex's ▾ for picking the device. White when switched off/on from usual. */
function CallButton({ on, onPress, icon, choose = false, children }: { on: boolean; onPress: () => void; icon: ReactNode; choose?: boolean; children: string }) {
  const fill = on ? 'bg-white text-black' : 'bg-[#1e1e22] text-white hover:bg-[#28282d]';
  return (
    <span className="flex h-11 items-stretch">
      <button
        aria-label={children}
        onClick={onPress}
        className={`flex items-center gap-2 whitespace-nowrap px-3.5 text-[15px] font-medium transition-colors @[600px]:px-4 ${fill} ${choose ? 'rounded-l-full' : 'rounded-full'}`}
      >
        {icon}
        <span className="hidden @[600px]:inline">{children}</span>
      </button>
      {choose && (
        <button aria-label={`${children}: устройство`} className={`ml-px flex items-center rounded-r-full pl-1.5 pr-2.5 transition-colors ${fill}`}>
          <ChevronDownIcon size={15} />
        </button>
      )}
    </span>
  );
}

function Count({ n }: { n: number }) {
  return <span className="min-w-5 shrink-0 rounded-full bg-[#ff453a] px-1.5 text-center text-[11px] font-medium leading-5 text-white">{n}</span>;
}

/** Someone without a photo: their letter on their colour, the green dot when online, as in the app. */
function Face({ person, size, ring = '#0c0c0e', border = false, dot: showDot = true }: { person: Person; size: number; ring?: string; border?: boolean; dot?: boolean }) {
  const dot = Math.max(10, Math.round(size * 0.3));
  return (
    <span className="relative inline-flex shrink-0" style={{ width: size, height: size }}>
      <span
        className="flex h-full w-full items-center justify-center rounded-full font-medium text-white"
        style={{ background: person.color, fontSize: Math.round(size * 0.42), boxShadow: border ? `0 0 0 2px ${ring}` : undefined }}
      >
        {person.name.charAt(0)}
      </span>
      {showDot && person.online && size >= 32 && size <= 48 && (
        <span className="absolute -bottom-0.5 -right-0.5 rounded-full bg-[#30d158]" style={{ width: dot, height: dot, boxShadow: `0 0 0 3px ${ring}` }} />
      )}
    </span>
  );
}
