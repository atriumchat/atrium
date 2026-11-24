import type { ReactNode } from 'react';
import { Popover } from '@heroui/react';
import { closeDetail, useStore } from '../store';
import { useIsMobile } from '../hooks';
import { useT } from '../i18n';
import { Avatar } from '../ui/Avatar';
import { MessageSearchButton } from '../chat/MessageSearch';
import { InboxButton } from '../people/Inbox';
import { desktop } from '../desktop';
import { MemberGroups, MembersButton } from './ServerMembers';
import { RoundButton } from '../ui/ui';
import { ChevronLeftIcon } from '../ui/icons';

/** A channel's glyph in the header: a round grey badge on a phone, a quiet glyph before the big name on a computer. */
export function HeaderIcon({ children, compact = false }: { children: ReactNode; compact?: boolean }) {
  return (
    <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-muted [&_svg]:size-[18px] md:-mr-1 md:w-auto md:bg-transparent md:text-faint ${compact ? 'md:[&_svg]:size-5' : 'md:[&_svg]:size-7'}`}>
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

export function ChannelHeader(props: {
  leading: ReactNode;
  title: string;
  subtitle?: ReactNode;
  compactTitle?: boolean;
  showOnline?: boolean;
  actions?: ReactNode;
  menu?: ReactNode;
}) {
  const { leading, title, subtitle, compactTitle = false, showOnline = true, actions, menu } = props;
  const isMobile = useIsMobile();
  return (
    <header
      className="@container/chat-header mx-2 mt-2 flex h-(--app-panel-header-height) shrink-0 items-center gap-2 rounded-control bg-default px-2 md:mx-0 md:mt-0 md:h-(--app-header-height) md:gap-3 md:rounded-none md:bg-transparent md:px-(--app-pane-inset)"
    >
      <BackButton />
      {leading}
      <div className={`min-w-0 flex-1 ${compactTitle ? 'flex items-center gap-2.5' : ''}`}>
        <h1 className={compactTitle
          ? 'truncate text-[16px] font-medium leading-5 md:text-xl md:leading-6'
          : 'truncate text-[16px] font-medium leading-5 md:text-[26px] md:font-light md:leading-8 md:tracking-[-0.8px] lg:text-[30px] lg:leading-9'}>
          {title}
        </h1>
        {subtitle && (
          <div className={compactTitle ? 'shrink-0 text-xs leading-4 text-muted' : 'truncate text-[12px] leading-4 text-muted md:text-[14px]'}>
            {subtitle}
          </div>
        )}
      </div>
      {showOnline && isMobile && <OnlinePeople />}
      <div className="flex shrink-0 items-center gap-0.5">
        {actions}
        {showOnline && !isMobile && <MembersButton />}
        {menu}
        {!desktop && (!compactTitle || isMobile) && (
          <div className="flex items-center gap-0.5 md:ml-1 md:border-l md:border-separator md:pl-1">
            <InboxButton inHeader />
          </div>
        )}
        <MessageSearchButton className="md:ml-1" shortLabel={compactTitle} />
      </div>
    </header>
  );
}

function OnlinePeople() {
  const { t } = useT();
  const users = useStore((s) => s.users);
  const online = useStore((s) => s.online);
  const onlineUsers = online.map((id) => users[id]).filter((user) => user && !user.removed);

  return (
    <Popover>
      <Popover.Trigger
        aria-label={t('shell.header.onlineLabel', { n: onlineUsers.length })}
        className="flex h-10 shrink-0 cursor-pointer items-center gap-2 rounded-full bg-white/[0.06] pl-1.5 pr-3.5 text-[14px] font-medium transition-colors hover:bg-white/10 max-md:h-9 max-md:pl-3 md:max-lg:w-12 md:max-lg:justify-center md:max-lg:px-0"
      >
        <span className="hidden -space-x-2 lg:flex">
          {onlineUsers.slice(0, 3).map((u) => (
            <Avatar key={u.id} user={u} size={28} ringBg="#252528" />
          ))}
        </span>
        <span aria-hidden="true" className="hidden items-center gap-1.5 md:max-lg:flex">
          <span className="size-1.5 rounded-full bg-success" />
          {onlineUsers.length}
        </span>
        <span className="md:max-lg:hidden">{t('shell.header.onlineCount', { n: onlineUsers.length })}</span>
      </Popover.Trigger>
      <Popover.Content placement="bottom end" className="w-72">
        <Popover.Dialog className="max-h-[60vh] overflow-y-auto p-2">
          <MemberGroups />
        </Popover.Dialog>
      </Popover.Content>
    </Popover>
  );
}
