import { useLayoutEffect, useRef, useState } from 'react';
import { Popover } from '@heroui/react';
import { selectChannel, useStore, voiceMembers } from '../store';
import { joinVoice, lastRoomId } from '../voice/voice';
import type { Channel } from '../types';
import { plural } from '../chat/format';
import { Avatar } from '../ui/Avatar';
import { UserProfile } from './UserProfile';
import { DotsIcon, HeadphonesIcon } from '../ui/icons';

/** "4 человека". */
const peopleCount = (n: number) => `${n} ${plural(n, ['человек', 'человека', 'человек'])}`;

const SIZE = 128;
const GAP = 12;

/**
 * The live voice rooms as circles over the friends list, as many as fit across: green is the one you're in
 * (opens it), pink is somewhere people are (joins it), busiest first. Every other room — empty or not fitting —
 * folds into a grey last circle that lists them. When nobody's talking, the room you sat in last is offered back.
 */
export function RoomCircles() {
  const channels = useStore((s) => s.channels);
  const voiceState = useStore((s) => s.voiceState);
  const myRoomId = useStore((s) => (s.voiceStatus !== 'idle' && s.channels.some((c) => c.id === s.voiceChannelId) ? s.voiceChannelId : null));
  const row = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  const hasRooms = channels.some((c) => c.kind === 'voice');
  // Measured before the first paint, so the circles are there from the start instead of popping in.
  useLayoutEffect(() => {
    const el = row.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const observer = new ResizeObserver(() => setWidth(el.clientWidth));
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasRooms]);

  const last = lastRoomId();
  const rooms = channels
    .filter((c) => c.kind === 'voice')
    .map((room) => ({ room, people: voiceMembers(voiceState, room.id).map((e) => e.userId) }))
    .sort(
      (a, b) =>
        Number(b.room.id === myRoomId) - Number(a.room.id === myRoomId) ||
        b.people.length - a.people.length ||
        Number(b.room.id === last) - Number(a.room.id === last) ||
        a.room.position - b.room.position,
    );
  if (rooms.length === 0) return null;

  const live = rooms.filter((r) => r.people.length > 0);
  const lead = live.length ? live : rooms.slice(0, 1);
  const fits = Math.max(1, Math.floor((width + GAP) / (SIZE + GAP)));
  const shown = lead.length + (rooms.length > lead.length ? 1 : 0) > fits ? lead.slice(0, fits - 1) : lead;
  const rest = rooms.filter((r) => !shown.includes(r));

  return (
    <div ref={row} className="flex gap-3 px-1 pb-5 pt-2 max-md:pb-0">
      {width > 0 && shown.map((r) => <RoomCircle key={r.room.id} room={r.room} people={r.people} mine={r.room.id === myRoomId} />)}
      {width > 0 && rest.length > 0 && <RestCircle rooms={rest} />}
    </div>
  );
}

/** The rooms that didn't fit: a grey circle that opens them as a list. */
function RestCircle({ rooms }: { rooms: { room: Channel; people: string[] }[] }) {
  const users = useStore((s) => s.users);
  const [open, setOpen] = useState(false);
  const people = rooms.reduce((n, r) => n + r.people.length, 0);
  return (
    <Popover isOpen={open} onOpenChange={setOpen}>
      <Popover.Trigger
        aria-label="Остальные комнаты"
        className="flex size-32 shrink-0 cursor-pointer flex-col items-center justify-center gap-2 rounded-full bg-default outline-none transition-[background-color,box-shadow] duration-200 hover:bg-[#28282d] data-[pressed=true]:bg-[#1a1a1d] data-[focus-visible=true]:ring-2 data-[focus-visible=true]:ring-focus"
      >
        <DotsIcon size={26} />
        <span className="flex flex-col items-center">
          <span className="text-[15px] font-semibold leading-5">ещё {rooms.length}</span>
          <span className="text-[12px] leading-4 text-muted">{people ? peopleCount(people) : 'все пустые'}</span>
        </span>
      </Popover.Trigger>
      <Popover.Content placement="bottom start" className="w-72 p-0">
        <Popover.Dialog className="p-2 outline-none">
          {rooms.map(({ room, people: inside }) => (
            <button
              key={room.id}
              onClick={() => {
                setOpen(false);
                joinVoice(room.id);
              }}
              className="flex h-12 w-full items-center gap-3 rounded-[16px] px-3 text-left transition-colors hover:bg-default"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-medium leading-5">{room.name}</span>
                <span className={`block text-[12px] leading-4 ${inside.length ? 'text-others' : 'text-muted'}`}>{inside.length ? peopleCount(inside.length) : 'пусто'}</span>
              </span>
              <span className="flex -space-x-2">
                {inside.slice(0, 3).map((id) => (
                  <span key={id} className="rounded-full ring-2 ring-[var(--overlay)]">
                    <Avatar user={users[id]} size={24} />
                  </span>
                ))}
              </span>
            </button>
          ))}
        </Popover.Dialog>
      </Popover.Content>
    </Popover>
  );
}

function RoomCircle({ room, people, mine }: { room: Channel; people: string[]; mine: boolean }) {
  const users = useStore((s) => s.users);
  const meId = useStore((s) => s.me?.id);
  const line = people.length ? peopleCount(people.length) : 'пусто';
  const faces = mine && meId ? [meId, ...people.filter((id) => id !== meId)] : people;

  return (
    <button
      onClick={() => (mine ? selectChannel(room.id) : joinVoice(room.id))}
      aria-label={mine ? `«${room.name}»: открыть комнату` : `Зайти в «${room.name}»`}
      className={`group flex size-32 shrink-0 flex-col items-center justify-center gap-2 rounded-full outline-none transition-[filter,box-shadow] duration-200 hover:brightness-[1.07] active:brightness-95 focus-visible:ring-2 focus-visible:ring-focus ${
        mine ? 'bg-here text-here-ink' : 'bg-others text-others-ink'
      }`}
    >
      <span className="flex h-8 items-center">
        {faces.length ? (
          // On hover the faces part a little, as if making room for you.
          <span className="flex -space-x-2.5 group-hover:-space-x-1 [&>*]:transition-[margin] [&>*]:duration-300 [&>*]:ease-out">
            {faces.slice(0, 3).map((id) => (
              <span key={id} className={`rounded-full ring-2 ${mine ? 'ring-here' : 'ring-others'}`}>
                <Avatar user={users[id]} size={30} />
              </span>
            ))}
          </span>
        ) : (
          <HeadphonesIcon size={26} />
        )}
      </span>
      <span className="flex max-w-[104px] flex-col items-center">
        <span className="max-w-full truncate text-[15px] font-semibold leading-5">{room.name}</span>
        <span className="max-w-full truncate text-[12px] leading-4 opacity-70">{line}</span>
      </span>
    </button>
  );
}

/** Which server room someone is sitting in, and whether it's yours — for the line under their name. */
export function useRoomOf(userId: string): { name: string; withYou: boolean } | null {
  // A plain string out of the store, so the row only re-renders when this person's room changes.
  const key = useStore((s) => {
    const entry = s.voiceState.find((e) => e.userId === userId && e.kind === 'channel');
    const room = entry && s.channels.find((c) => c.id === entry.channelId);
    if (!room) return '';
    return `${s.voiceStatus !== 'idle' && s.voiceChannelId === room.id ? 1 : 0}${room.name}`;
  });
  return key ? { name: key.slice(1), withYou: key[0] === '1' } : null;
}

const RING = { here: 'var(--room-here)', others: 'var(--room-others)', online: 'var(--foreground)' } as const;
const PLACE = { here: 'text-here', others: 'text-others', online: 'text-muted' } as const;

/**
 * The phone home's "Кто где": everyone around in one row, ringed by where they are — with you (green), in
 * another room (pink), just online (white) — and whoever's away folded into "+N" at the end.
 */
export function PeopleRow() {
  const users = useStore((s) => s.users);
  const meId = useStore((s) => s.me?.id);
  const online = useStore((s) => s.online);
  const blocked = useStore((s) => s.blocked);
  const channels = useStore((s) => s.channels);
  const voiceState = useStore((s) => s.voiceState);
  const myRoomId = useStore((s) => (s.voiceStatus !== 'idle' ? s.voiceChannelId : null));

  const roomOf = new Map<string, Channel>();
  for (const e of voiceState) {
    const room = e.kind === 'channel' ? channels.find((c) => c.id === e.channelId) : undefined;
    if (room) roomOf.set(e.userId, room);
  }
  const ring = (id: string): keyof typeof RING | null => {
    const room = roomOf.get(id);
    if (room) return room.id === myRoomId ? 'here' : 'others';
    return online.includes(id) ? 'online' : null;
  };
  const order = { here: 0, others: 1, online: 2 };
  const people = Object.values(users).filter((u) => u.id !== meId && !blocked.includes(u.id));
  const around = people
    .filter((u) => ring(u.id))
    .sort((a, b) => order[ring(a.id)!] - order[ring(b.id)!] || a.name.localeCompare(b.name, 'ru'));
  const away = people.length - around.length;
  if (people.length === 0) return null;

  return (
    <section>
      <h2 className="flex items-baseline gap-2 px-6 text-[17px] font-semibold">
        Кто где <span className="text-[15px] font-normal text-muted">{around.length} из {people.length}</span>
      </h2>
      <div className="flex gap-3 overflow-x-auto px-4 pb-1 pt-3 no-scrollbar">
        {around.map((u) => {
          const r = ring(u.id)!;
          return (
            <UserProfile key={u.id} userId={u.id} placement="bottom" className="flex w-16 shrink-0 cursor-pointer flex-col items-center gap-1.5 text-center">
              <span className="rounded-full p-[3px]" style={{ boxShadow: `inset 0 0 0 2px ${RING[r]}` }}>
                <Avatar user={u} size={52} />
              </span>
              <span className="w-full">
                <span className="block truncate text-[12px] font-medium leading-4">{u.name}</span>
                <span className={`block truncate text-[11px] leading-4 ${PLACE[r]}`}>{roomOf.get(u.id)?.name ?? (u.statusText || 'в сети')}</span>
              </span>
            </UserProfile>
          );
        })}
        {away > 0 && (
          <span className="flex w-16 shrink-0 flex-col items-center gap-1.5 text-center">
            <span className="flex size-[58px] items-center justify-center rounded-full bg-default text-[15px] font-medium text-muted">+{away}</span>
            <span className="text-[11px] leading-4 text-muted">не в сети</span>
          </span>
        )}
      </div>
    </section>
  );
}
