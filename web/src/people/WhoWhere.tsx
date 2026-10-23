import { selectChannel, useStore, voiceMembers } from '../store';
import { joinVoice, lastRoomId } from '../voice/voice';
import type { Channel } from '../types';
import { useT } from '../i18n';
import { Avatar } from '../ui/Avatar';
import { ChevronRightIcon, HeadphonesIcon, SpeakerIcon } from '../ui/icons';
import { CallDuration } from '../voice/CallDuration';

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

const CARD_GUTTER = 12;

/**
 * The phone's "who is in voice right now", as cards (the native app's): the people first, the room under them.
 * Green is the room you're in, pink the others; only rooms with someone in them. With everyone out, the phone gets
 * one quiet line with the way into the room you used last; the computer's Friends page shows nothing, its own
 * empty state is right below. A tap opens the room (with its Join button), never joins.
 */
export function RoomCards({ grid = false }: { grid?: boolean }) {
  const { t } = useT();
  const isMobile = useStore((s) => s.isMobile);
  const channels = useStore((s) => s.channels);
  const voiceState = useStore((s) => s.voiceState);
  const myRoomId = useStore((s) => (s.voiceStatus !== 'idle' && s.channels.some((c) => c.id === s.voiceChannelId) ? s.voiceChannelId : null));
  const rooms = channels.filter((c) => c.kind === 'voice');
  if (rooms.length === 0) return null;
  const live = rooms
    .map((room) => ({ room, people: voiceMembers(voiceState, room.id).map((e) => e.userId) }))
    .filter((r) => r.people.length > 0)
    .sort((a, b) => Number(b.room.id === myRoomId) - Number(a.room.id === myRoomId) || b.people.length - a.people.length || a.room.position - b.room.position);

  if (live.length === 0) {
    if (grid) return null;
    const last = rooms.find((r) => r.id === lastRoomId()) ?? [...rooms].sort((a, b) => a.position - b.position)[0]!;
    return (
      <div style={{ paddingInline: CARD_GUTTER }}>
        <button
          onClick={() => (isMobile ? selectChannel(last.id) : joinVoice(last.id))}
          aria-label={t('people.who.joinRoom', { name: last.name })}
          className="flex h-[52px] w-full items-center gap-3 rounded-[20px] bg-default px-4 text-left transition-[background-color,transform] duration-150 active:scale-[0.98] active:bg-[#28282d]"
        >
          <HeadphonesIcon size={20} className="shrink-0 text-muted" />
          <span className="min-w-0 flex-1 truncate text-[16px] text-muted">{t('people.who.nobodyInVoice')}</span>
          <span className="max-w-[45%] truncate text-[16px] font-medium">{last.name}</span>
          <ChevronRightIcon size={18} className="shrink-0 text-faint" />
        </button>
      </div>
    );
  }

  // One room: the whole width. More: a row you swipe, the next card peeking out at the edge.
  const single = live.length === 1;
  if (grid) {
    return (
      <div className="flex flex-wrap gap-3 px-1 pb-4">
        {live.map((r) => <RoomCard key={r.room.id} room={r.room} people={r.people} mine={r.room.id === myRoomId} single={false} onPress={() => (r.room.id === myRoomId ? selectChannel(r.room.id) : joinVoice(r.room.id))} />)}
      </div>
    );
  }
  return (
    <div className="flex snap-x snap-mandatory gap-2 overflow-x-auto [scrollbar-width:none]" style={{ paddingInline: CARD_GUTTER, scrollPaddingInline: CARD_GUTTER }}>
      {live.map((r) => <RoomCard key={r.room.id} room={r.room} people={r.people} mine={r.room.id === myRoomId} single={single} onPress={() => selectChannel(r.room.id)} />)}
    </div>
  );
}

function RoomCard({ room, people, mine, single, onPress }: { room: Channel; people: string[]; mine: boolean; single: boolean; onPress: () => void }) {
  const { t } = useT();
  const users = useStore((s) => s.users);
  const meId = useStore((s) => s.me?.id);
  const faces = mine && meId ? [meId, ...people.filter((id) => id !== meId)] : people;
  const names = faces.map((id) => (id === meId ? t('people.who.youName') : users[id]?.name ?? '…'));
  const shown = names.length > 3 ? t('people.who.andMore', { names: names.slice(0, 2).join(', '), n: names.length - 2 }) : names.join(', ');
  return (
    <button
      onClick={onPress}
      aria-label={`${room.name}: ${names.join(', ')}`}
      className={`flex min-h-24 shrink-0 snap-start items-center gap-3 rounded-[20px] bg-default p-3.5 text-left transition-[background-color,transform] duration-150 hover:bg-[#28282d] active:scale-[0.98] active:bg-[#28282d] ${single ? 'w-full' : 'w-[min(280px,72vw)]'}`}
    >
      <span className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span className="line-clamp-2 text-[16px] font-semibold leading-[21px]">{shown}</span>
        <span className={`flex items-center gap-1.5 text-[14px] font-medium ${mine ? 'text-here' : 'text-others'}`}>
          <SpeakerIcon size={15} className="shrink-0" />
          <span className="truncate">{room.name}</span>
          {mine && (
            <span className="shrink-0 tabular-nums">
              · <CallDuration />
            </span>
          )}
        </span>
      </span>
      <span className="flex shrink-0 -space-x-3">
        {faces.slice(0, 3).map((id) => (
          <span key={id} className="rounded-full ring-2 ring-[var(--default)]">
            <Avatar user={users[id]} size={36} />
          </span>
        ))}
      </span>
    </button>
  );
}
