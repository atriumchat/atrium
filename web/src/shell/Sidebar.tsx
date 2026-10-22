import { useState, type DragEvent, type FormEvent, type ReactNode } from 'react';
import { InviteButton } from '../people/Invites';
import { ListHead } from './ListHead';
import { CallPill, FaceStack } from './CallPill';
import { Popover } from '@heroui/react';
import { api } from '../api';
import { selectChannel, setChannels, showError, useStore, voiceMembers } from '../store';
import { joinVoice } from '../voice/voice';
import { ensureHistory } from '../chat/history';
import { useT } from '../i18n';
import type { Channel, VoiceEntry } from '../types';
import { Avatar } from '../ui/Avatar';
import { CallDuration } from '../voice/CallDuration';
import { ChannelMenu } from './ChannelMenu';
import { RoundButton, VolumeSlider } from '../ui/ui';
import { EmptyState } from '../ui/Illustrations';
import { BellSlashIcon, HashIcon, HeadphonesSlashIcon, MicSlashIcon, PlusIcon, SpeakerIcon, VideoIcon } from '../ui/icons';

export function Sidebar() {
  const { t } = useT();
  const channels = useStore((s) => s.channels);
  const serverName = useStore((s) => s.serverName);
  const people = useStore((s) => Object.keys(s.users).length);
  const online = useStore((s) => s.online.length);
  const [filter, setFilter] = useState('');
  const query = filter.trim().toLowerCase();
  const visible = query ? channels.filter((c) => c.name.toLowerCase().includes(query)) : channels;
  // The admin reorders by dragging, on a computer and over the whole list (not a search result).
  const canDrag = useStore((s) => s.canManageChannels && !s.isMobile) && !query;
  const drag = useChannelDrag(channels);

  return (
    <aside className="flex min-h-0 min-w-0 flex-1 flex-col">
      <ListHead
        title={serverName}
        sub={`${t('shell.list.people', { n: people })} · ${t('shell.list.online', { n: online })}`}
        action={<InviteButton />}
        search={filter}
        onSearch={setFilter}
        placeholder={t('shell.sidebar.search')}
      />
      <nav className="flex-1 overflow-y-auto px-2 pb-3 max-md:px-3">
        {/* A search that finds nothing shows only that, without the two empty sections under it. */}
        {query && visible.length === 0 ? (
          <EmptyState compact art="search" title={t('shell.sidebar.noResults.title')} text={t('shell.sidebar.noResults.text')} />
        ) : (
          <>
            <Section title={t('shell.sidebar.textChannels')} kind="text">
              {visible
                .filter((c) => c.kind === 'text')
                .map((c) => (
                  <Draggable key={c.id} channel={c} drag={canDrag ? drag : null}>
                    <TextItem channel={c} />
                  </Draggable>
                ))}
            </Section>
            <Section title={t('shell.sidebar.voiceRooms')} kind="voice">
              {visible
                .filter((c) => c.kind === 'voice')
                .map((c) => (
                  <Draggable key={c.id} channel={c} drag={canDrag ? drag : null}>
                    <VoiceItem channel={c} />
                  </Draggable>
                ))}
            </Section>
          </>
        )}
      </nav>
    </aside>
  );
}

type Drag = ReturnType<typeof useChannelDrag>;

/**
 * Dragging channels within their section, like Discord: a line shows where the channel lands, the list
 * takes the new order at once and the server confirms it (or the old order comes back).
 */
function useChannelDrag(channels: Channel[]) {
  const { t } = useT();
  const [dragged, setDragged] = useState<Channel | null>(null);
  const [over, setOver] = useState<{ id: string; after: boolean } | null>(null);

  async function drop() {
    const target = over;
    setDragged(null);
    setOver(null);
    if (!dragged || !target || target.id === dragged.id) return;
    const same = channels.filter((c) => c.kind === dragged.kind && c.id !== dragged.id);
    const at = same.findIndex((c) => c.id === target.id) + (target.after ? 1 : 0);
    same.splice(at, 0, dragged);
    const moved = same.values();
    const next = channels.map((c) => (c.kind === dragged.kind ? moved.next().value! : c)).map((c, position) => ({ ...c, position }));
    if (next.every((c, i) => c.id === channels[i].id)) return;
    const before = channels;
    setChannels(next);
    try {
      setChannels(await api.reorderChannels(same.map((c) => c.id)));
    } catch (e) {
      setChannels(before);
      showError(e instanceof Error ? e.message : t('shell.sidebar.reorderFailed'));
    }
  }

  return { dragged, over, setDragged, setOver, drop };
}

function Draggable({ channel, drag, children }: { channel: Channel; drag: Drag | null; children: ReactNode }) {
  if (!drag) return <>{children}</>;
  const { dragged, over, setDragged, setOver, drop } = drag;
  const accepts = dragged?.kind === channel.kind;
  const line = accepts && over?.id === channel.id && dragged?.id !== channel.id ? (over.after ? 'bottom' : 'top') : null;

  function onDragOver(e: DragEvent<HTMLDivElement>) {
    if (!accepts) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    // The upper half drops above this channel, the lower half below (a room counts its people too).
    const r = e.currentTarget.getBoundingClientRect();
    const after = e.clientY > r.top + r.height / 2;
    if (over?.id !== channel.id || over.after !== after) setOver({ id: channel.id, after });
  }

  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', channel.name);
        setDragged(channel);
      }}
      onDragOver={onDragOver}
      onDrop={(e) => {
        e.preventDefault();
        void drop();
      }}
      onDragEnd={() => {
        setDragged(null);
        setOver(null);
      }}
      className={`relative ${dragged?.id === channel.id ? 'opacity-40' : ''}`}
    >
      {children}
      {line && (
        <span
          aria-hidden
          className={`pointer-events-none absolute inset-x-3 h-0.5 rounded-full bg-accent ${line === 'top' ? '-top-px' : '-bottom-px'}`}
        />
      )}
    </div>
  );
}

function Section({ title, kind, children }: { title: string; kind: Channel['kind']; children: ReactNode }) {
  const { t } = useT();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const canManage = useStore((s) => s.canManageChannels);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setAdding(false);
    try {
      useStore.setState({ channels: await api.createChannel(name, kind) });
      setName('');
      setAdding(false);
    } catch (err) {
      showError(err instanceof Error ? err.message : t('shell.sidebar.createFailed'));
    }
  }

  return (
    <section className="pt-4 first:pt-1">
      <div className="flex items-center justify-between pb-1 pl-3">
        <h2 className="text-[14px] font-medium text-muted max-md:text-[17px] max-md:font-semibold max-md:text-foreground">{title}</h2>
        {canManage ? (
          <RoundButton
            size="sm"
            tone="ghost"
            label={kind === 'text' ? t('shell.sidebar.createText') : t('shell.sidebar.createVoice')}
            onPress={() => setAdding((v) => !v)}
            className="h-7 w-7 min-w-7 [&_svg]:size-4"
          >
            <PlusIcon />
          </RoundButton>
        ) : (
          <span className="h-7" />
        )}
      </div>
      {adding && (
        <form onSubmit={submit} className="pb-2">
          <input
            autoFocus
            value={name}
            maxLength={32}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => !name && setAdding(false)}
            onKeyDown={(e) => e.key === 'Escape' && setAdding(false)}
            placeholder={kind === 'text' ? t('shell.sidebar.nameChannel') : t('shell.sidebar.nameRoom')}
            aria-label={kind === 'text' ? t('shell.sidebar.nameTextChannel') : t('shell.sidebar.nameVoiceRoom')}
            className="h-10 w-full rounded-full bg-default px-4 text-[15px] outline-none placeholder:text-faint focus:ring-2 focus:ring-focus"
          />
        </form>
      )}
      <div className="space-y-0.5">{children}</div>
    </section>
  );
}

/** A pill row: 40px, plain 18px icon, 16px label; the open one gets the graphite fill, a new one is bold. */
function itemClass(active: boolean, strong = false) {
  return `flex h-10 w-full items-center gap-2.5 rounded-full px-4 text-left text-[16px] transition-colors max-md:h-11 ${
    active ? 'bg-default font-medium text-foreground' : strong ? 'font-semibold text-foreground hover:bg-white/[0.04]' : 'font-medium text-muted hover:bg-white/[0.04] hover:text-foreground'
  }`;
}

/**
 * A row's "…" (ChannelMenu), Discord's gear: shown on hover on a computer; on a phone it's in the channel's
 * header. Rows that have one make room for it while hovered.
 */
function RowMenu({ channelId }: { channelId: string }) {
  return (
    <ChannelMenu
      channelId={channelId}
      className="absolute right-2 top-[18px] h-7 w-7 -translate-y-1/2 text-muted opacity-0 hover:text-foreground group-hover:opacity-100 aria-expanded:opacity-100 data-[focus-visible=true]:opacity-100 max-md:hidden [&_svg]:size-4"
    />
  );
}

const ROW_MENU_ROOM = 'md:group-hover:pr-9';

function TextItem({ channel }: { channel: Channel }) {
  const { t } = useT();
  // On a phone the list is its own screen, so nothing in it is "the open one".
  const active = useStore((s) => s.selectedChannelId === channel.id && !s.isMobile);
  const unread = useStore((s) => s.unread[channel.id] ?? 0);
  const mentions = useStore((s) => s.mentions[channel.id] ?? 0);
  const muted = useStore((s) => s.mutedChannels.includes(channel.id));
  // New messages make the name bright and bold with a white dot at the end; only mentions of you get a red number,
  // and they still do in a muted channel, which otherwise stays quiet and dimmed.
  const showUnread = unread > 0 && !active && !muted;
  const showMentions = mentions > 0 && !active;
  const label = showMentions
    ? t('shell.sidebar.mentions', { name: channel.name, n: mentions })
    : showUnread
      ? t('shell.sidebar.unread', { name: channel.name })
      : undefined;
  return (
    <div className="group relative">
      <button
        onClick={() => selectChannel(channel.id)}
        onPointerEnter={() => void ensureHistory(channel.id, 'channel', { quiet: true })}
        className={`${itemClass(active, showUnread || showMentions)} ${ROW_MENU_ROOM} ${muted && !active && !showMentions ? 'opacity-45' : ''}`}
        aria-label={label}
      >
        <HashIcon size={18} className="shrink-0 opacity-60" />
        <span className="min-w-0 flex-1 truncate">{channel.name}</span>
        {muted && !showMentions && <BellSlashIcon size={14} className="shrink-0 md:group-hover:hidden" />}
        {showMentions ? (
          <span className="min-w-5 rounded-full bg-danger px-1.5 text-center text-[11px] font-medium leading-5 text-white md:group-hover:hidden">
            {mentions > 99 ? '99+' : mentions}
          </span>
        ) : (
          showUnread && <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-foreground md:group-hover:hidden" />
        )}
      </button>
      <RowMenu channelId={channel.id} />
    </div>
  );
}

/**
 * A voice room in one row: its name, and when people are in it their faces and names under it with the running time
 * (yours) or the headcount in a pill. The room you're in lists everyone under it instead, to set each one's volume.
 */
function VoiceItem({ channel }: { channel: Channel }) {
  const active = useStore((s) => s.selectedChannelId === channel.id);
  const connectedHere = useStore((s) => s.voiceChannelId === channel.id && s.voiceStatus === 'connected');
  const voiceState = useStore((s) => s.voiceState);
  const users = useStore((s) => s.users);
  const isMobile = useStore((s) => s.isMobile);
  const members = voiceMembers(voiceState, channel.id);
  const lit = active && !isMobile;
  const names = members.map((m) => users[m.userId]?.name ?? '…').join(', ');

  return (
    <div className="group relative">
      {/* A click joins on a computer; on a phone it opens the room first, with a Join button, like Discord's app. */}
      <button
        onClick={() => (isMobile ? selectChannel(channel.id) : joinVoice(channel.id))}
        className={`flex w-full items-center gap-2.5 rounded-[18px] px-4 text-left transition-colors ${members.length && !connectedHere ? 'py-2' : 'h-10 max-md:h-11'} ${ROW_MENU_ROOM} ${
          lit || connectedHere ? 'bg-default text-foreground' : members.length ? 'text-foreground hover:bg-white/[0.04]' : 'text-muted hover:bg-white/[0.04] hover:text-foreground'
        }`}
      >
        <SpeakerIcon size={18} className={`shrink-0 ${connectedHere ? 'text-success' : 'opacity-60'}`} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[16px] font-medium leading-5">{channel.name}</span>
          {members.length > 0 && !connectedHere && (
            <span className="mt-1.5 flex items-center gap-2">
              <FaceStack users={members.map((m) => users[m.userId])} ringBg={lit || connectedHere ? 'var(--default)' : 'var(--app-side)'} />
              <span className="min-w-0 truncate text-[13px] text-muted">
                {names}
              </span>
            </span>
          )}
        </span>
        {connectedHere ? (
          <CallPill>
            <CallDuration />
          </CallPill>
        ) : (
          members.length > 0 && <CallPill>{members.length}</CallPill>
        )}
      </button>
      <RowMenu channelId={channel.id} />
      {connectedHere && members.length > 0 && (
        <ul className="pb-1 pl-8 pt-1">
          {members.map((m) => (
            <VoiceMember key={m.userId} entry={m} />
          ))}
        </ul>
      )}
    </div>
  );
}

/** Person under a voice room, Discord-style. Click someone else in your room to set their volume. */
function VoiceMember({ entry }: { entry: VoiceEntry }) {
  const { t } = useT();
  const user = useStore((s) => s.users[entry.userId]);
  const isMe = useStore((s) => s.me?.id === entry.userId);
  const inSameRoom = useStore((s) => s.voiceChannelId === entry.channelId && s.voiceStatus === 'connected');
  const speaking = useStore((s) => inSameRoom && s.speaking.includes(entry.userId));

  const content = (
    <>
      <Avatar user={user} size={22} speaking={speaking} ringBg="var(--app-side)" />
      <span className={`min-w-0 flex-1 truncate text-left text-[15px] ${speaking ? 'text-foreground' : 'text-muted'}`}>
        {user?.name ?? '…'}
      </span>
      {entry.screen && <span className="rounded-[4px] bg-danger px-1 text-[10px] font-bold uppercase leading-4 text-white">{t('shell.sidebar.live')}</span>}
      {entry.video && <VideoIcon size={16} className="text-muted" />}
      {entry.deafened ? (
        <HeadphonesSlashIcon size={16} className="text-muted" />
      ) : (
        entry.muted && <MicSlashIcon size={16} className="text-muted" />
      )}
    </>
  );
  const row = 'flex h-8 w-full items-center gap-2 rounded-full px-1.5';

  if (isMe || !inSameRoom) return <li className={row}>{content}</li>;
  return (
    <li>
      <Popover>
        <Popover.Trigger aria-label={t('shell.sidebar.volume', { name: user?.name ?? '' })} className={`${row} cursor-pointer hover:bg-default/50`}>
          {content}
        </Popover.Trigger>
        <Popover.Content placement="right" className="w-64">
          <Popover.Dialog className="p-5">
            <VolumeSlider userId={entry.userId} name={user?.name ?? ''} />
          </Popover.Dialog>
        </Popover.Content>
      </Popover>
    </li>
  );
}
