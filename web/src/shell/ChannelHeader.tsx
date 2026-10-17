import type { ReactNode } from 'react';
import { Popover } from '@heroui/react';
import { closeDetail, useStore } from '../store';
import { useIsMobile } from '../hooks';
import { Avatar } from '../ui/Avatar';
import { InboxButton } from '../people/Inbox';
import { UserProfile } from '../people/UserProfile';
import { RoundButton } from '../ui/ui';
import { ChevronLeftIcon } from '../ui/icons';

/** Round grey badge for a channel glyph in the header. */
export function HeaderIcon({ children }: { children: ReactNode }) {
  return <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-muted [&_svg]:size-[18px]">{children}</span>;
}

/** On a phone, the way back from a conversation to its list. */
export function BackButton() {
  const isMobile = useIsMobile();
  if (!isMobile) return null;
  return (
    <RoundButton tone="ghost" label="Назад" onPress={closeDetail} className="[&_svg]:size-6">
      <ChevronLeftIcon />
    </RoundButton>
  );
}

/** Content header: leading icon/avatar and title on the left, actions and people online on the right. */
export function ChannelHeader(props: {
  leading: ReactNode;
  title: string;
  subtitle?: ReactNode;
  bare?: boolean;
  showOnline?: boolean;
  actions?: ReactNode;
}) {
  const { leading, title, subtitle, showOnline = true, actions } = props;
  return (
    <header
      className="mx-2 mt-2 flex h-14 shrink-0 items-center gap-3 rounded-full bg-default pl-2 pr-2 max-md:gap-2"
    >
      <BackButton />
      {leading}
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-[16px] font-medium leading-5">{title}</h1>
        {subtitle && <div className="truncate text-[12px] leading-4 text-muted">{subtitle}</div>}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {actions}
        <InboxButton />
      </div>
      {showOnline && <OnlinePeople />}
    </header>
  );
}

function OnlinePeople() {
  const users = useStore((s) => s.users);
  const online = useStore((s) => s.online);
  const voiceState = useStore((s) => s.voiceState);
  const channels = useStore((s) => s.channels);
  const onlineSet = new Set(online);
  const sorted = Object.values(users).sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  const onlineUsers = sorted.filter((u) => onlineSet.has(u.id));
  const offlineUsers = sorted.filter((u) => !onlineSet.has(u.id));
  const roomOf = (id: string) => {
    const entry = voiceState.find((v) => v.userId === id);
    return entry ? channels.find((c) => c.id === entry.channelId)?.name : undefined;
  };

  return (
    <Popover>
      <Popover.Trigger
        aria-label={`В сети: ${onlineUsers.length}`}
        className="flex h-10 shrink-0 cursor-pointer items-center gap-2 rounded-full bg-white/[0.06] pl-1.5 pr-3.5 text-[14px] font-medium transition-colors hover:bg-white/10 max-md:h-9 max-md:pl-3"
      >
        <span className="flex -space-x-2 max-md:hidden">
          {onlineUsers.slice(0, 3).map((u) => (
            <Avatar key={u.id} user={u} size={28} ringBg="#252528" />
          ))}
        </span>
        {onlineUsers.length} в сети
      </Popover.Trigger>
      <Popover.Content placement="bottom end" className="w-72">
        <Popover.Dialog className="max-h-[60vh] overflow-y-auto p-2">
          {[
            { title: `В сети — ${onlineUsers.length}`, list: onlineUsers, isOnline: true },
            { title: `Не в сети — ${offlineUsers.length}`, list: offlineUsers, isOnline: false },
          ]
            .filter((g) => g.list.length > 0)
            .map((g) => (
              <section key={g.title} className="pb-2">
                <h3 className="px-3 pb-1 pt-2 text-[12px] font-medium text-muted">{g.title}</h3>
                {g.list.map((u) => {
                  const room = g.isOnline ? roomOf(u.id) : undefined;
                  return (
                    <UserProfile
                      key={u.id}
                      userId={u.id}
                      placement="left top"
                      className={`flex cursor-pointer items-center gap-3 rounded-[16px] px-3 py-2 hover:bg-default/50 ${g.isOnline ? '' : 'opacity-50'}`}
                    >
                      <Avatar user={u} size={32} online={g.isOnline} ringBg="var(--overlay)" />
                      <div className="min-w-0">
                        <div className="truncate text-[15px]">{u.name}</div>
                        {room && <div className="truncate text-[12px] text-success">В комнате «{room}»</div>}
                      </div>
                    </UserProfile>
                  );
                })}
              </section>
            ))}
        </Popover.Dialog>
      </Popover.Content>
    </Popover>
  );
}
