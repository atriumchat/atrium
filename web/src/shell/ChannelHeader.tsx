import type { ReactNode } from 'react';
import { Popover } from '@heroui/react';
import { closeDetail, useStore } from '../store';
import { useIsMobile } from '../hooks';
import { localeOf, useT } from '../i18n';
import { Avatar } from '../ui/Avatar';
import { InboxButton } from '../people/Inbox';
import { desktop } from '../desktop';
import { UserProfile } from '../people/UserProfile';
import { RoundButton } from '../ui/ui';
import { ChevronLeftIcon } from '../ui/icons';

/** A channel's glyph in the header: a round grey badge on a phone, a quiet glyph before the big name on a computer. */
export function HeaderIcon({ children }: { children: ReactNode }) {
  return (
    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-muted [&_svg]:size-[18px] md:-mr-1 md:w-auto md:bg-transparent md:text-faint md:[&_svg]:size-7">
      {children}
    </span>
  );
}

/** On a phone, the way back from a conversation to its list. */
export function BackButton() {
  const { t } = useT();
  const isMobile = useIsMobile();
  if (!isMobile) return null;
  return (
    <RoundButton tone="ghost" label={t('shell.header.back')} onPress={closeDetail} className="[&_svg]:size-6">
      <ChevronLeftIcon />
    </RoundButton>
  );
}

/**
 * Content header: leading icon/avatar and title on the left; on the right, in this order, people online, the actions,
 * the bell and last the "…" menu (an overflow menu always ends the row). On a computer the name is big and light on
 * the panel itself (the Metro part of the look); on a phone it's a graphite pill.
 */
export function ChannelHeader(props: {
  leading: ReactNode;
  title: string;
  subtitle?: ReactNode;
  bare?: boolean;
  showOnline?: boolean;
  actions?: ReactNode;
  menu?: ReactNode;
}) {
  const { leading, title, subtitle, showOnline = true, actions, menu } = props;
  return (
    <header
      className="mx-2 mt-2 flex h-14 shrink-0 items-center gap-3 rounded-full bg-default pl-2 pr-2 max-md:gap-2 md:mx-0 md:mt-0 md:h-auto md:rounded-none md:bg-transparent md:px-6 md:pb-3 md:pt-5"
    >
      <BackButton />
      {leading}
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-[16px] font-medium leading-5 md:text-[32px] md:font-light md:leading-[38px] md:tracking-[-0.8px]">
          {title}
        </h1>
        {subtitle && <div className="truncate text-[12px] leading-4 text-muted md:text-[14px] md:leading-5">{subtitle}</div>}
      </div>
      {showOnline && <OnlinePeople />}
      <div className="flex shrink-0 items-center gap-1">
        {actions}
        {/* In the desktop app the bell is in the window's title row (TitleBar). */}
        {!desktop && <InboxButton />}
        {menu}
      </div>
    </header>
  );
}

function OnlinePeople() {
  const { t, lang } = useT();
  const users = useStore((s) => s.users);
  const online = useStore((s) => s.online);
  const voiceState = useStore((s) => s.voiceState);
  const channels = useStore((s) => s.channels);
  const onlineSet = new Set(online);
  // Whoever the admin took off the server isn't on it any more.
  const sorted = Object.values(users).filter((u) => !u.removed).sort((a, b) => a.name.localeCompare(b.name, localeOf(lang)));
  const onlineUsers = sorted.filter((u) => onlineSet.has(u.id));
  const offlineUsers = sorted.filter((u) => !onlineSet.has(u.id));
  const roomOf = (id: string) => {
    const entry = voiceState.find((v) => v.userId === id);
    return entry ? channels.find((c) => c.id === entry.channelId)?.name : undefined;
  };

  return (
    <Popover>
      <Popover.Trigger
        aria-label={t('shell.header.onlineLabel', { n: onlineUsers.length })}
        className="flex h-10 shrink-0 cursor-pointer items-center gap-2 rounded-full bg-white/[0.06] pl-1.5 pr-3.5 text-[14px] font-medium transition-colors hover:bg-white/10 max-md:h-9 max-md:pl-3"
      >
        <span className="flex -space-x-2 max-md:hidden">
          {onlineUsers.slice(0, 3).map((u) => (
            <Avatar key={u.id} user={u} size={28} ringBg="#252528" />
          ))}
        </span>
        {t('shell.header.onlineCount', { n: onlineUsers.length })}
      </Popover.Trigger>
      <Popover.Content placement="bottom end" className="w-72">
        <Popover.Dialog className="max-h-[60vh] overflow-y-auto p-2">
          {[
            { title: t('shell.header.onlineGroup', { n: onlineUsers.length }), list: onlineUsers, isOnline: true },
            { title: t('shell.header.offlineGroup', { n: offlineUsers.length }), list: offlineUsers, isOnline: false },
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
                        {room && <div className="truncate text-[12px] text-success">{t('shell.header.inRoom', { room })}</div>}
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
