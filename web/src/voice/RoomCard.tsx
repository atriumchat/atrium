import { Button } from '@heroui/react';
import { useStore, voiceMembers } from '../store';
import { joinVoice } from './voice';
import { plural } from '../chat/format';
import { Avatar } from '../ui/Avatar';
import { SpeakerIcon } from '../ui/icons';

/**
 * A call into a voice room, sent from the room's "Позвать в комнату": the room, who's inside, and a button
 * to go in. Pink when people are there, green when you are, grey when it's empty or gone — as the room
 * circles on the home screen.
 */
export function RoomCard({ channelId }: { channelId: string }) {
  const room = useStore((s) => s.channels.find((c) => c.id === channelId));
  const voiceState = useStore((s) => s.voiceState);
  const here = useStore((s) => s.voiceChannelId === channelId);
  const users = useStore((s) => s.users);
  const people = voiceMembers(voiceState, channelId).map((e) => e.userId);

  const tone = !room || people.length === 0 ? 'bg-default text-muted' : here ? 'bg-here text-here-ink' : 'bg-others text-others-ink';
  return (
    <div className="mt-1 flex w-full max-w-[400px] items-center gap-3 rounded-[24px] bg-white/[0.06] p-3">
      <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full ${tone}`}>
        <SpeakerIcon size={22} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-medium leading-5">{room?.name ?? 'Комната удалена'}</span>
        {room && (
          <span className="flex items-center gap-1.5 text-[13px] leading-5 text-muted">
            {people.length > 0 && (
              <span className="flex -space-x-1.5">
                {people.slice(0, 3).map((id) => (
                  <span key={id} className="rounded-full ring-2 ring-[#1d1d21]">
                    <Avatar user={users[id]} size={16} />
                  </span>
                ))}
              </span>
            )}
            {people.length > 0 ? `${people.length} ${plural(people.length, ['человек', 'человека', 'человек'])}` : 'Пусто'}
          </span>
        )}
      </span>
      {room && (
        <Button
          size="sm"
          isDisabled={here}
          onPress={() => joinVoice(channelId)}
          className="h-9 shrink-0 rounded-full px-4 text-[14px] [--button-bg-hover:#e7e7ea] [--button-bg:white] [--button-fg:#0b0b0c]"
        >
          {here ? 'Вы здесь' : 'Войти'}
        </Button>
      )}
    </div>
  );
}
