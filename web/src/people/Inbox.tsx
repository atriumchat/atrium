import { useEffect, useState } from 'react';
import { Popover } from '@heroui/react';
import { api } from '../api';
import { dmTitle, forgetUnreadMarker, getSessionEpoch, showError, useStore } from '../store';
import { dateOnly, sameDay, timeOf } from '../chat/format';
import { useT, type TFn } from '../i18n';
import type { InboxItem } from '../types';
import { Avatar } from '../ui/Avatar';
import { Markdown } from '../ui/Markdown';
import { EmptyState } from '../ui/Illustrations';
import { openMessage } from '../chat/messageNavigation';
import { BellIcon, InboxArrowDownIcon } from '@heroicons/react/24/solid';
import { AtIcon, ReplyIcon } from '../ui/icons';

/**
 * Notifications: every message that mentions you (or everyone) or answers you, from all channels and your DMs,
 * newest first. A click opens the conversation right at that message.
 */
export function InboxButton({ compact = false, inHeader = false }: { compact?: boolean; inHeader?: boolean }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<InboxItem[] | null>(null);
  const total = useStore((s) => Object.values(s.mentions).reduce((n, m) => n + m, 0));

  useEffect(() => {
    if (!open) return;
    api.inbox().then(setItems, (e) => showError(e instanceof Error ? e.message : t('people.inbox.loadFailed')));
  }, [open, t]);

  function go(item: InboxItem) {
    void openMessage(item.id);
    setOpen(false);
  }

  async function readAll() {
    const ids = Object.keys(useStore.getState().mentions).filter((id) => useStore.getState().mentions[id] > 0);
    const at = Date.now();
    const epoch = getSessionEpoch();
    try {
      await Promise.all(ids.map(async id => {
        const token = useStore.getState().manualUnread[id];
        await api.markRead(id, at, token);
        if (epoch !== getSessionEpoch() || useStore.getState().manualUnread[id] !== token) return;
        if (token) forgetUnreadMarker(id, token);
        else useStore.setState(s => ({ unread: {...s.unread, [id]: 0}, mentions: {...s.mentions, [id]: 0} }));
      }));
      if (epoch === getSessionEpoch()) setItems(await api.inbox());
    } catch (error) { if (epoch === getSessionEpoch()) showError(String(error)); }
  }

  return (
    <><UnreadButton compact={compact} inHeader={inHeader} /><Popover isOpen={open} onOpenChange={setOpen}>
      <Popover.Trigger
        aria-label={total ? t('people.inbox.titleNew', { n: total }) : t('people.inbox.title')}
        className={inHeader ? "relative header-action" : `relative flex shrink-0 items-center justify-center rounded-full outline-none transition-colors hover:bg-white/10 data-[focus-visible=true]:ring-2 data-[focus-visible=true]:ring-focus ${compact ? 'h-8 w-8 text-foreground' : 'h-10 w-10 text-foreground'}`}
      >
        <BellIcon className={compact ? "size-[18px]" : "size-5"} aria-hidden="true" />
        {total > 0 && (
          <span className="absolute -right-0.5 -top-0.5 min-w-[18px] rounded-full bg-danger px-1 text-center text-[10px] font-medium leading-[18px] text-white ring-2 ring-[var(--app-window)]">
            {total > 99 ? '99+' : total}
          </span>
        )}
      </Popover.Trigger>
      <Popover.Content placement="bottom end" className="w-[440px] max-w-[calc(100vw-16px)]">
        <Popover.Dialog aria-label={t('people.inbox.title')} className="flex max-h-[70vh] flex-col p-0">
          <div className="flex items-center justify-between pb-1 pl-5 pr-3 pt-4">
            <h2 className="text-[17px] font-medium">{t('people.inbox.title')}</h2>
            {total > 0 && (
              <button onClick={readAll} className="rounded-full px-3 py-1 text-[13px] text-muted hover:bg-white/10 hover:text-foreground">
                {t('people.inbox.markRead')}
              </button>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
            {items === null ? (
              <p className="py-10 text-center text-[14px] text-muted">{t('people.inbox.loading')}</p>
            ) : items.length === 0 ? (
              <EmptyState compact art="tray" title={t('people.inbox.empty')} text={t('people.inbox.emptyText')} plate="var(--overlay)" />
            ) : (
              <InboxList items={items} onOpen={go} />
            )}
          </div>
        </Popover.Dialog>
      </Popover.Content>
    </Popover></>
  );
}

/** "Today", "Yesterday", or the date — the list's day headers. */
function dayLabel(ts: number, t: TFn) {
  const now = Date.now();
  if (sameDay(ts, now)) return t('people.inbox.today');
  if (sameDay(ts, now - 86_400_000)) return t('people.inbox.yesterday');
  return dateOnly(ts);
}

/** The list grouped by day, newest first. */
function InboxList({ items, onOpen }: { items: InboxItem[]; onOpen: (item: InboxItem) => void }) {
  const { t } = useT();
  const groups: [string, InboxItem[]][] = [];
  for (const item of items) {
    const label = dayLabel(item.createdAt, t);
    const last = groups[groups.length - 1];
    if (last && last[0] === label) last[1].push(item);
    else groups.push([label, [item]]);
  }
  return (
    <>
      {groups.map(([label, list]) => (
        <section key={label}>
          <h3 className="px-3 pb-1 pt-3 text-[12px] font-medium text-muted">{label}</h3>
          {list.map((item) => (
            <InboxRow key={item.id} item={item} onOpen={() => onOpen(item)} />
          ))}
        </section>
      ))}
    </>
  );
}

/**
 * One notification on a grid: the author's face (with an @ or a reply arrow on it), then their name and where
 * it was with the time on the right, and the message underneath, two lines at most.
 */
function InboxRow({ item, onOpen }: { item: InboxItem; onOpen: () => void }) {
  const { t } = useT();
  const author = useStore((s) => s.users[item.userId]);
  const where = useStore((s) => {
    if (!item.dm) return `#${s.channels.find((c) => c.id === item.channelId)?.name ?? t('people.inbox.channel')}`;
    const dm = s.dms.find((d) => d.id === item.channelId);
    return dm ? dmTitle(dm, s.users, s.me?.id) : t('people.inbox.dms');
  });
  const answersMe = useStore((s) => !item.mentionsAll && !item.mentions?.includes(s.me?.id ?? '') && !!item.replyTo);
  return (
    <button
      onClick={onOpen}
      aria-label={`${author?.name ?? t('people.inbox.someone')}, ${where}, ${answersMe ? t('people.inbox.reply') : t('people.inbox.mention')}`}
      className={`flex w-full items-start gap-3 rounded-surface px-3 py-2.5 text-left transition-colors hover:bg-white/[0.06] ${item.unread ? 'bg-white/[0.04]' : ''}`}
    >
      <span className="relative mt-0.5 shrink-0">
        <Avatar user={author} size={40} ringBg="var(--overlay)" />
        <span
          className={`absolute -bottom-1 -right-1 flex size-[18px] items-center justify-center rounded-full ring-2 ring-[var(--overlay)] ${
            answersMe ? 'bg-default text-foreground' : 'bg-[#64a8ff] text-black'
          }`}
        >
          {answersMe ? <ReplyIcon size={11} strokeWidth={2.6} /> : <AtIcon size={11} strokeWidth={2.6} />}
        </span>
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className="min-w-0 flex-1 truncate">
            <span className={`text-[15px] ${item.unread ? 'font-semibold' : 'font-medium'}`}>{author?.name ?? t('people.inbox.someone')}</span>
            <span className="text-[13px] text-muted"> · {where}</span>
          </span>
          <span className="shrink-0 text-[12px] tabular-nums text-faint">{timeOf(item.createdAt)}</span>
          {item.unread && <span className="size-2 shrink-0 self-center rounded-full bg-[#64a8ff]" aria-label={t('people.inbox.new')} />}
        </span>
        <span className="mt-0.5 line-clamp-2 block text-foreground/80 [&_div]:text-[14px] [&_div]:leading-5">
          <Markdown text={item.content || t('people.inbox.attachment')} />
        </span>
      </span>
    </button>
  );
}

function UnreadButton({ compact, inHeader }: { compact: boolean; inHeader: boolean }) {
  const {t} = useT();
  const [open,setOpen] = useState(false);
  const unread = useStore(s => s.unread);
  const first = useStore(s => s.firstUnread);
  const channels = useStore(s => s.channels);
  const dms = useStore(s => s.dms);
  const users = useStore(s => s.users);
  const me = useStore(s => s.me?.id);
  const rows = Object.entries(unread).filter(([id,n]) => n && first[id]).map(([id,count]) => {
    const channel = channels.find(c => c.id === id);
    const dm = dms.find(d => d.id === id);
    return {id,count,title: channel ? '#' + channel.name : dm && dmTitle(dm,users,me)};
  }).filter(row => row.title);
  async function visit(id: string) {
    setOpen(false);
    const token = useStore.getState().manualUnread[id];
    const readAt = Date.now();
    if (await openMessage(first[id]) && token) {
      try { await api.markRead(id, readAt, token); forgetUnreadMarker(id, token); }
      catch(e) { showError(String(e)); }
    }
  }
  return <Popover isOpen={open} onOpenChange={setOpen}><Popover.Trigger aria-label={t('chat.tools.divider')} title={t('chat.tools.divider')} className={inHeader ? "relative header-action" : `relative grid ${compact ? 'size-8' : 'size-10'} place-items-center rounded-full hover:bg-white/10`}>
    <InboxArrowDownIcon className={compact ? "size-[18px]" : "size-5"} aria-hidden="true" />{rows.length > 0 && <span className="absolute right-1 top-1 size-2 rounded-full bg-accent"/>}
    </Popover.Trigger><Popover.Content placement="bottom end" className="w-72 max-w-[90vw]"><Popover.Dialog aria-label={t('chat.tools.divider')} className="max-h-[65vh] overflow-y-auto p-3">
    <h2 className="mb-2 px-2 font-medium">{t('chat.tools.divider')}</h2>
    {rows.length ? rows.map(row => <button key={row.id} onClick={() => void visit(row.id)} className="flex w-full items-center justify-between gap-2 rounded-xl p-2 text-left hover:bg-white/10"><span className="truncate">{row.title}</span><span className="text-sm text-muted">{row.count}</span></button>) : <p className="px-2 py-3 text-sm text-muted">{t('chat.tools.empty')}</p>}
    </Popover.Dialog></Popover.Content></Popover>;
}
