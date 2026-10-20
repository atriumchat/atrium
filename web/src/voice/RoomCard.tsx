import { Button } from '@heroui/react';
import { useStore, voiceMembers } from '../store';
import { joinVoice } from './voice';
import { Avatar } from '../ui/Avatar';
import { SpeakerIcon } from '../ui/icons';
import { useT } from '../i18n';

/**
 * A call into a voice room, sent from the room's "Call to room" button: the room, who's inside, and a button
 * to go in. Pink when people are there, green when you are, grey when it's empty or gone — as the room
 * circles on the home screen.
 */
export function RoomCard({ channelId }: { channelId: string }) {
  const { t } = useT();
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
        <span className="block truncate text-[15px] font-medium leading-5">{room?.name ?? t('voice.room.deleted')}</span>
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
            {people.length > 0 ? t('voice.room.people', { n: people.length }) : t('voice.room.empty')}
          </span>
        )}
      </span>
      {room && (
        <Button
          size="sm"
          isDisabled={here}
          onPress={() => joinVoice(channelId)}
          className="h-9 shrink-0 rounded-full px-4 text-[14px] font-medium [--button-bg-hover:#2a9a45] [--button-bg:#248a3d] [--button-fg:#fff]"
        >
          {here ? t('voice.room.here') : t('voice.room.enter')}
        </Button>
      )}
    </div>
  );
}
