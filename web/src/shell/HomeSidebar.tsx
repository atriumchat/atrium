import type { ReactNode } from 'react';
import { dmTitle, openDm, openFriends, openPicker, useStore } from '../store';
import { shortStamp } from '../chat/format';
import { useT } from '../i18n';
import type { Dm } from '../types';
import { DmAvatar } from '../ui/DmAvatar';
import { ensureHistory } from '../chat/history';
import { plainText } from '../ui/Markdown';
import { RoundButton } from '../ui/ui';
import { EmptyState } from '../ui/Illustrations';
import { PhoneIcon, PlusIcon, UsersIcon } from '../ui/icons';

/**
 * Left list on the home screen: friends on top, then your direct messages and groups, newest first.
 */
export function HomeSidebar() {
  const { t } = useT();
  const view = useStore((s) => (s.mode === 'home' ? s.homeView : null));
  const incoming = useStore((s) => s.friends.filter((f) => f.status === 'incoming').length);
  const dms = useDmList();

  return (
    <aside className="flex min-h-0 min-w-0 flex-1 flex-col">
      {/* The same 72px band, inset and pill height as the server list's search, so switching doesn't jump. */}
      <div className="flex h-[72px] shrink-0 items-center px-4 max-md:px-3">
        <NavItem active={view === 'friends'} onPress={openFriends} icon={<UsersIcon size={18} />} label={t('shell.home.friends')} extra={incoming > 0 && <Badge count={incoming} />} />
      </div>
      <nav className="flex-1 overflow-y-auto px-2 pb-3">
        <div className="flex items-center justify-between pb-1 pl-3 pt-1">
          <h2 className="text-[14px] font-medium text-muted">{t('shell.home.dms')}</h2>
          <RoundButton size="sm" tone="ghost" label={t('shell.home.createGroup')} onPress={() => openPicker({ mode: 'create' })} className="h-7 w-7 min-w-7 [&_svg]:size-4">
            <PlusIcon />
          </RoundButton>
        </div>
        {dms.length === 0 ? (
          <EmptyState compact art="messages" title={t('shell.home.empty.title')} text={t('shell.home.empty.text')} />
        ) : (
          <div className="space-y-0.5">
            {dms.map((dm) => (
              <FeedDm key={dm.id} dm={dm} />
            ))}
          </div>
        )}
      </nav>
    </aside>
  );
}

function NavItem(props: { active: boolean; onPress: () => void; icon: ReactNode; label: string; extra?: ReactNode }) {
  return (
    <button
      onClick={props.onPress}
      className={`flex h-10 w-full items-center gap-2.5 rounded-full px-4 text-left text-[16px] font-medium transition-colors ${
        props.active ? 'bg-default text-foreground' : 'text-muted hover:text-foreground'
      }`}
    >
      {props.icon}
      <span className="flex-1">{props.label}</span>
      {props.extra}
    </button>
  );
}

/**
 * Your conversations, newest first: groups always, a DM once someone has written in it (or while it's open,
 * so there's somewhere to type the first message).
 */
export function useDmList(): Dm[] {
  const dms = useStore((s) => s.dms);
  const openId = useStore((s) => (s.mode === 'home' ? s.homeView : null));
  return dms.filter((dm) => dm.kind === 'group' || dm.preview || dm.id === openId);
}

/** `big`: the phone's home, with roomier rows and no "open" highlight (the list is its own screen there). */
export function FeedDm({ dm, big = false }: { dm: Dm; big?: boolean }) {
  const { t } = useT();
  const users = useStore((s) => s.users);
  const meId = useStore((s) => s.me?.id);
  const active = useStore((s) => !big && s.mode === 'home' && s.homeView === dm.id);
  const online = useStore((s) => dm.kind === 'dm' && s.online.includes(dm.userId ?? ''));
  const unread = useStore((s) => (active ? 0 : (s.unread[dm.id] ?? 0)));
  const inCall = useStore((s) => !!s.calls[dm.id]);
  const who = dm.preview ? (dm.preview.userId === meId ? t('shell.home.you') : dm.kind === 'group' ? `${users[dm.preview.userId]?.name ?? '…'}: ` : '') : '';
  const text = dm.preview
    ? who + (plainText(dm.preview.text, users) || (dm.preview.images > 1 ? t('shell.home.attachments', { n: dm.preview.images }) : t('shell.home.attachment')))
    : dm.kind === 'group'
      ? t('shell.home.members', { n: dm.members.length })
      : t('shell.home.noMessages');
  return (
    <FeedRow
      active={active}
      onPress={() => openDm(dm.id)}
      onWarm={() => void ensureHistory(dm.id, 'dm', { quiet: true })}
      avatar={<DmAvatar dm={dm} size={big ? 48 : 40} online={online} ringBg={active ? 'var(--default)' : 'var(--app-side)'} />}
      title={dmTitle(dm, users, meId)}
      text={text}
      stamp={dm.preview ? shortStamp(dm.lastMessageAt) : ''}
      after={inCall ? <PhoneIcon size={16} className="shrink-0 text-success" aria-label={t('shell.home.callActive')} /> : unread > 0 && <Badge count={unread} />}
      bold={unread > 0}
      big={big}
    />
  );
}

function FeedRow(props: { active: boolean; onPress: () => void; onWarm: () => void; avatar: ReactNode; title: string; text: string; stamp: string; after: ReactNode; bold: boolean; big?: boolean }) {
  return (
    <button
      onClick={props.onPress}
      onPointerEnter={props.onWarm}
      onFocus={props.onWarm}
      className={`flex w-full items-center gap-3 text-left transition-colors ${props.big ? 'h-[68px] rounded-[20px] px-3 active:bg-default/60' : 'h-[60px] rounded-[20px] px-2.5'} ${props.active ? 'bg-default' : 'hover:bg-default/50'}`}
    >
      {props.avatar}
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className={`min-w-0 flex-1 truncate text-[16px] font-medium leading-5 ${props.bold || props.active ? 'text-foreground' : 'text-foreground/85'}`}>{props.title}</span>
          <span className="shrink-0 text-[12px] leading-4 text-faint">{props.stamp}</span>
        </span>
        <span className="mt-0.5 flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-[14px] leading-5 text-muted">{props.text}</span>
          {props.after}
        </span>
      </span>
    </button>
  );
}

/** Red for what's yours (DMs, mentions); `quiet` is grey, for plain chatter in a channel. */
export function Badge({ count, label, quiet = false }: { count: number; label?: string; quiet?: boolean }) {
  return (
    <span className={`min-w-5 shrink-0 rounded-full px-1.5 text-center text-[11px] font-medium leading-5 ${quiet ? 'bg-default text-muted' : 'bg-danger text-white'}`}>
      {label ?? (count > 99 ? '99+' : count)}
    </span>
  );
}

/**
 * A DM or group in a list. Compact on the computer sidebar; `large` (phone Messages tab) adds the
 * last message underneath, like Discord's mobile list.
 */
export function ConversationRow({ dm, large = false }: { dm: Dm; large?: boolean }) {
  const { t } = useT();
  const users = useStore((s) => s.users);
  const meId = useStore((s) => s.me?.id);
  const active = useStore((s) => !large && s.mode === 'home' && s.homeView === dm.id);
  const online = useStore((s) => dm.kind === 'dm' && s.online.includes(dm.userId ?? ''));
  const unread = useStore((s) => (active ? 0 : (s.unread[dm.id] ?? 0)));
  const inCall = useStore((s) => !!s.calls[dm.id]);
  const title = dmTitle(dm, users, meId);
  const bg = large ? 'var(--app-window)' : active ? 'var(--default)' : 'var(--app-side)';

  let subtitle = '';
  if (large && dm.preview) {
    const who = dm.preview.userId === meId ? t('shell.home.you') : dm.kind === 'group' ? `${users[dm.preview.userId]?.name ?? '…'}: ` : '';
    subtitle = who + (plainText(dm.preview.text, users) || (dm.preview.images ? (dm.preview.images > 1 ? t('shell.home.attachments', { n: dm.preview.images }) : t('shell.home.attachment')) : ''));
  } else if (dm.kind === 'group') {
    subtitle = t('shell.home.members', { n: dm.members.length });
  }

  return (
    <button
      onClick={() => openDm(dm.id)}
      className={`flex w-full items-center gap-2.5 rounded-full px-1.5 text-left transition-colors ${large ? 'h-[68px] rounded-[20px] px-3' : 'h-11 pr-3'} ${
        active ? 'bg-default text-foreground' : unread ? 'text-foreground hover:bg-default/50' : `${large ? 'text-foreground' : 'text-muted'} hover:text-foreground`
      }`}
    >
      <DmAvatar dm={dm} size={large ? 48 : 32} online={online} ringBg={bg} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[16px] font-medium leading-5">{title}</span>
        {subtitle && <span className={`block truncate text-muted ${large ? 'text-[14px]' : 'text-[12px] leading-4'}`}>{subtitle}</span>}
      </span>
      {inCall && <PhoneIcon size={16} className="shrink-0 text-success" aria-label={t('shell.home.callActive')} />}
      {unread > 0 && <Badge count={unread} />}
    </button>
  );
}
