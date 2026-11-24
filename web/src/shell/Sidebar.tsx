import { useRef, useState, type DragEvent, type FormEvent, type ReactNode } from 'react';
import { Dropdown, Label } from '@heroui/react';
import { ChatBubbleLeftIcon } from '@heroicons/react/24/solid';
import { InviteButton } from '../people/Invites';
import { ListHead } from './ListHead';
import { CallPill, FaceStack } from './CallPill';
import { Popover } from '@heroui/react';
import { api } from '../api';
import { selectChannel, setChannels, setVoiceChat, showError, useNameColor, useStore, voiceMembers } from '../store';
import { joinVoice } from '../voice/voice';
import { ensureHistory } from '../chat/history';
import { useT } from '../i18n';
import type { Category, Channel, VoiceEntry } from '../types';
import { Avatar } from '../ui/Avatar';
import { CallDuration } from '../voice/CallDuration';
import { SoundPlayedMark } from '../voice/SoundPad';
import { ChannelMenu, InviteToRoom } from './ChannelMenu';
import { RoundButton, VolumeSlider } from '../ui/ui';
import { EmptyState } from '../ui/Illustrations';
import { UserPlusIcon } from '../ui/icons';
import { BellSlashIcon, ChevronDownIcon, DotsIcon, HashIcon, HashLockIcon, HeadphonesSlashIcon, MicSlashIcon, PencilIcon, PlusIcon, SpeakerIcon, SpeakerLockIcon, TrashIcon, VideoIcon } from '../ui/icons';

export function Sidebar() {
  const { t } = useT();
  const channels = useStore((s) => s.channels);
  const categories = useStore((s) => s.categories);
  const serverName = useStore((s) => s.serverName);
  const [filter, setFilter] = useState('');
  const query = filter.trim().toLowerCase();
  const visible = query ? channels.filter((c) => c.name.toLowerCase().includes(query)) : channels;
  // The admin reorders by dragging, on a computer and over the whole list (not a search result).
  const canDrag = useStore((s) => s.canManageChannels && !s.isMobile) && !query;
  const drag = useChannelDrag(channels);
  const canManage = useStore((s) => s.canManageChannels);
  // Channels in no category (or one that's gone) stand in the plain sections; with categories about, an empty plain
  // section is left out.
  const known = new Set(categories.map((c) => c.id));
  const loose = visible.filter((c) => !c.categoryId || !known.has(c.categoryId));
  const plain = (kind: Channel['kind']) => categories.length === 0 || loose.some((c) => c.kind === kind);

  return (
    <aside className="flex min-h-0 min-w-0 flex-1 flex-col">
      <ListHead
        title={serverName}
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
            {plain('text') && (
              <Section title={t('shell.sidebar.textChannels')} kind="text">
                {loose
                  .filter((c) => c.kind === 'text')
                  .map((c) => (
                    <Draggable key={c.id} channel={c} drag={canDrag ? drag : null}>
                      <TextItem channel={c} />
                    </Draggable>
                  ))}
              </Section>
            )}
            {plain('voice') && (
              <Section title={t('shell.sidebar.voiceRooms')} kind="voice">
                {loose
                  .filter((c) => c.kind === 'voice')
                  .map((c) => (
                    <Draggable key={c.id} channel={c} drag={canDrag ? drag : null}>
                      <VoiceItem channel={c} />
                    </Draggable>
                  ))}
              </Section>
            )}
            {categories.map((category) => {
              const inside = visible.filter((c) => c.categoryId === category.id);
              // A search hides the categories it finds nothing in; so does having none of its channels to see.
              if ((query || !canManage) && inside.length === 0) return null;
              return (
                <CategorySection key={category.id} category={category}>
                  {[...inside.filter((c) => c.kind === 'text'), ...inside.filter((c) => c.kind === 'voice')].map((c) => (
                    <Draggable key={c.id} channel={c} drag={canDrag ? drag : null}>
                      {c.kind === 'text' ? <TextItem channel={c} /> : <VoiceItem channel={c} />}
                    </Draggable>
                  ))}
                </CategorySection>
              );
            })}
            {canManage && !query && <NewCategory />}
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
    // One kind within one category (or none): the list the server reorders.
    const group = (c: Channel) => c.kind === dragged.kind && (c.categoryId ?? null) === (dragged.categoryId ?? null);
    const same = channels.filter((c) => group(c) && c.id !== dragged.id);
    const at = same.findIndex((c) => c.id === target.id) + (target.after ? 1 : 0);
    same.splice(at, 0, dragged);
    const moved = same.values();
    const next = channels.map((c) => (group(c) ? moved.next().value! : c)).map((c, position) => ({ ...c, position }));
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
  const accepts = dragged?.kind === channel.kind && (dragged?.categoryId ?? null) === (channel.categoryId ?? null);
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

function useNameSubmission(fallback: string) {
  const submitting = useRef(false);
  const [busy, setBusy] = useState(false);

  async function save(action: () => Promise<void>) {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    try {
      await action();
    } catch (error) {
      showError(error instanceof Error ? error.message : fallback);
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  return { busy, save };
}

function Section({ title, kind, children }: { title: string; kind: Channel['kind']; children: ReactNode }) {
  const { t } = useT();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const canManage = useStore((s) => s.canManageChannels);
  const { busy, save } = useNameSubmission(t('shell.sidebar.createFailed'));

  function submit(e: FormEvent) {
    e.preventDefault();
    const value = name.trim();
    if (!value) return setAdding(false);
    void save(async () => {
      setChannels(await api.createChannel(value, kind));
      setName('');
      setAdding(false);
    });
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
            isDisabled={busy}
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
        <form onSubmit={submit} aria-busy={busy || undefined} className="pb-2">
          <input
            autoFocus
            value={name}
            readOnly={busy}
            maxLength={32}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => !name && setAdding(false)}
            onKeyDown={(e) => e.key === 'Escape' && !busy && setAdding(false)}
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

/** Which categories are folded, on this device. */
const FOLDED = 'atrium.folded';
function readFolded(): string[] {
  try {
    return JSON.parse(localStorage.getItem(FOLDED) ?? '[]');
  } catch {
    return [];
  }
}

/**
 * A category: its name folds it (the open channel and a room with people in it still show, as in Discord); the
 * admin adds a text channel or a voice room to it with "+", renames and deletes it from "…" (its channels stay).
 */
function CategorySection({ category, children }: { category: Category; children: ReactNode }) {
  const { t } = useT();
  const canManage = useStore((s) => s.canManageChannels);
  const [folded, setFolded] = useState(() => readFolded().includes(category.id));
  const [adding, setAdding] = useState<Channel['kind'] | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState('');
  const { busy, save } = useNameSubmission(t('shell.sidebar.createFailed'));

  function fold() {
    const next = !folded;
    setFolded(next);
    try {
      const rest = readFolded().filter((id) => id !== category.id);
      localStorage.setItem(FOLDED, JSON.stringify(next ? [...rest, category.id] : rest));
    } catch {
      // Private mode: folding just isn't remembered.
    }
  }

  function closeForm() {
    setName('');
    setAdding(null);
    setRenaming(false);
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    const value = name.trim();
    if (!value) return closeForm();
    void save(async () => {
      if (renaming) useStore.setState({ categories: await api.renameCategory(category.id, value) });
      else if (adding) setChannels(await api.createChannel(value, adding, category.id));
      closeForm();
    });
  }

  async function remove() {
    try {
      useStore.setState({ categories: await api.deleteCategory(category.id) });
    } catch (err) {
      showError(err instanceof Error ? err.message : t('shell.menu.failed'));
    }
  }

  const items = Array.isArray(children) ? children : [children];
  return (
    <section className="pt-4">
      <div className="group/cat flex items-center justify-between pb-1 pl-3">
        <button type="button" onClick={fold} aria-expanded={!folded} className="flex min-w-0 items-center gap-1 text-[14px] font-medium text-muted hover:text-foreground max-md:text-[17px] max-md:font-semibold max-md:text-foreground">
          <span className="truncate">{category.name}</span>
          <ChevronDownIcon size={14} className={`shrink-0 transition-transform ${folded ? '-rotate-90' : ''}`} />
        </button>
        {canManage ? (
          <Dropdown>
            <Dropdown.Trigger isDisabled={busy} aria-label={t('shell.category.actions', { name: category.name })} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted outline-none hover:bg-white/[0.06] hover:text-foreground data-[focus-visible=true]:ring-2 data-[focus-visible=true]:ring-focus">
              <DotsIcon size={16} />
            </Dropdown.Trigger>
            <Dropdown.Popover placement="bottom end" className="min-w-56">
              <Dropdown.Menu
                aria-label={t('shell.category.actions', { name: category.name })}
                onAction={(key) => {
                  if (key === 'text' || key === 'voice') {
                    setAdding(key);
                    setRenaming(false);
                    setName('');
                    setFolded(false);
                  }
                  if (key === 'rename') {
                    setRenaming(true);
                    setAdding(null);
                    setName(category.name);
                  }
                  if (key === 'delete') void remove();
                }}
              >
                <Dropdown.Item id="text" textValue={t('shell.sidebar.createText')}>
                  <Label>{t('shell.sidebar.createText')}</Label>
                  <HashIcon size={16} className="ml-auto text-muted" />
                </Dropdown.Item>
                <Dropdown.Item id="voice" textValue={t('shell.sidebar.createVoice')}>
                  <Label>{t('shell.sidebar.createVoice')}</Label>
                  <SpeakerIcon size={16} className="ml-auto text-muted" />
                </Dropdown.Item>
                <Dropdown.Item id="rename" textValue={t('shell.menu.rename')}>
                  <Label>{t('shell.menu.rename')}</Label>
                  <PencilIcon size={16} className="ml-auto text-muted" />
                </Dropdown.Item>
                <Dropdown.Item id="delete" textValue={t('shell.category.delete')} variant="danger">
                  <Label>{t('shell.category.delete')}</Label>
                  <TrashIcon size={16} className="ml-auto text-danger" />
                </Dropdown.Item>
              </Dropdown.Menu>
            </Dropdown.Popover>
          </Dropdown>
        ) : (
          <span className="h-7" />
        )}
      </div>
      {(adding || renaming) && (
        <form onSubmit={submit} aria-busy={busy || undefined} className="pb-2">
          <input
            autoFocus
            value={name}
            readOnly={busy}
            maxLength={32}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => !name && closeForm()}
            onKeyDown={(e) => e.key === 'Escape' && !busy && closeForm()}
            placeholder={renaming ? t('shell.category.name') : adding === 'text' ? t('shell.sidebar.nameChannel') : t('shell.sidebar.nameRoom')}
            aria-label={renaming ? t('shell.category.name') : adding === 'text' ? t('shell.sidebar.nameTextChannel') : t('shell.sidebar.nameVoiceRoom')}
            className="h-10 w-full rounded-full bg-default px-4 text-[15px] outline-none placeholder:text-faint focus:ring-2 focus:ring-focus"
          />
        </form>
      )}
      {!folded && <div className="space-y-0.5">{items}</div>}
    </section>
  );
}

/** The admin's "New category" at the foot of the list. */
function NewCategory() {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const { busy, save } = useNameSubmission(t('shell.menu.failed'));

  function closeForm() {
    setOpen(false);
    setName('');
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    const value = name.trim();
    if (!value) return closeForm();
    void save(async () => {
      useStore.setState({ categories: await api.createCategory(value) });
      closeForm();
    });
  }

  return open ? (
    <form onSubmit={submit} aria-busy={busy || undefined} className="pt-4">
      <input
        autoFocus
        value={name}
        readOnly={busy}
        maxLength={32}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => !name && closeForm()}
        onKeyDown={(e) => e.key === 'Escape' && !busy && closeForm()}
        placeholder={t('shell.category.name')}
        aria-label={t('shell.category.name')}
        className="h-10 w-full rounded-full bg-default px-4 text-[15px] outline-none placeholder:text-faint focus:ring-2 focus:ring-focus"
      />
    </form>
  ) : (
    <button
      type="button"
      onClick={() => setOpen(true)}
      className="mt-4 flex h-9 items-center gap-2 rounded-full px-3 text-[14px] font-medium text-muted transition-colors hover:bg-white/[0.04] hover:text-foreground"
    >
      <PlusIcon size={16} />
      {t('shell.category.new')}
    </button>
  );
}

/** A pill row: 40px, plain 18px icon, 16px label; the open one gets the graphite fill, a new one is bold. */
function itemClass(active: boolean, strong = false) {
  return `flex h-10 w-full items-center gap-2.5 rounded-full px-4 text-left text-[16px] md:rounded-compact transition-colors max-md:h-11 ${
    active ? 'bg-default font-medium text-foreground' : strong ? 'font-semibold text-foreground hover:bg-white/[0.04]' : 'font-medium text-muted hover:bg-white/[0.04] hover:text-foreground'
  }`;
}

/**
 * A row's "…" (ChannelMenu), Discord's gear: shown on hover on a computer; on a phone it's in the channel's
 * header. Rows that have one make room for it while hovered. It sits on the middle of the row's first line: 20px down
 * a one-line row, 18px when people are listed under the name.
 */
function RowMenu({ channelId, top = 'top-5' }: { channelId: string; top?: string }) {
  return (
    <ChannelMenu
      channelId={channelId}
      className={`absolute right-2 ${top} h-7 w-7 -translate-y-1/2 text-muted opacity-0 hover:text-foreground group-hover:opacity-100 aria-expanded:opacity-100 data-[focus-visible=true]:opacity-100 max-md:hidden [&_svg]:size-4`}
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
        {channel.private ? <HashLockIcon size={18} className="shrink-0 opacity-60" /> : <HashIcon size={18} className="shrink-0 opacity-60" />}
        <span className="min-w-0 flex-1 truncate">{channel.name}</span>
        {channel.private && <PrivateText />}
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
  const { t } = useT();
  const active = useStore((s) => s.selectedChannelId === channel.id);
  const connectedHere = useStore((s) => s.voiceChannelId === channel.id && s.voiceStatus === 'connected');
  const voiceState = useStore((s) => s.voiceState);
  const users = useStore((s) => s.users);
  const isMobile = useStore((s) => s.isMobile);
  const members = voiceMembers(voiceState, channel.id);
  const lit = active && !isMobile;
  const names = members.map((m) => users[m.userId]?.name ?? '…').join(', ');
  const chatOpen = useStore((s) => s.mode === 'server' && active && s.voiceChatOpen);
  const mentioned = useStore((s) => (s.mentions[channel.id] ?? 0) > 0);
  const unread = useStore((s) => (s.unread[channel.id] ?? 0) > 0 && !s.mutedChannels.includes(channel.id));
  const chatLabel = t(!chatOpen && (mentioned || unread) ? 'shell.sidebar.roomChatUnread' : 'shell.sidebar.roomChat', { name: channel.name });
  const twoLines = members.length > 0 && !connectedHere;
  const top = twoLines ? 'top-[18px]' : 'top-5';
  const [inviting, setInviting] = useState(false);
  // Invite and the chat are buttons of their own; the menu is left with rename, access and delete, for admins only.
  const hasMenu = useStore((s) => s.canManageChannels);

  return (
    <div>
      <div className="group group/voice-row relative">
        {/* A click joins on a computer; on a phone it opens the room first, with a Join button, like Discord's app. */}
        <button
          onClick={() => (isMobile ? selectChannel(channel.id) : joinVoice(channel.id))}
          className={`flex w-full items-center gap-2.5 rounded-compact px-4 text-left transition-colors ${twoLines ? 'py-2' : 'h-10 max-md:h-11'} pr-4 ${hasMenu ? 'group-hover:pr-[104px] [@media(hover:none)]:pr-[104px]' : 'group-hover:pr-[72px] [@media(hover:none)]:pr-[72px]'} ${
            lit || connectedHere ? 'bg-default text-foreground' : members.length ? 'text-foreground hover:bg-white/[0.04]' : 'text-muted hover:bg-white/[0.04] hover:text-foreground'
          }`}
        >
          {channel.private
            ? <SpeakerLockIcon size={18} className={`shrink-0 ${connectedHere ? 'text-success' : 'opacity-60'}`} />
            : <SpeakerIcon size={18} className={`shrink-0 ${connectedHere ? 'text-success' : 'opacity-60'}`} />}
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5">
              <span className="min-w-0 truncate text-[16px] font-medium leading-5">{channel.name}</span>
              {channel.private && <PrivateText />}
            </span>
            {members.length > 0 && !connectedHere && (
              <span className="mt-1.5 flex items-center gap-2">
                <FaceStack users={members.map((m) => users[m.userId])} ringBg={lit || connectedHere ? 'var(--default)' : 'var(--app-side)'} />
                <span className="min-w-0 truncate text-[13px] text-muted">
                  {names}
                </span>
              </span>
            )}
          </span>
          {!chatOpen && (mentioned || unread) && <span aria-hidden className={`size-2 shrink-0 rounded-full ${mentioned ? 'bg-danger' : 'bg-foreground'}`} />}
          {/* Discord's right edge: the running time in green (no pill) when you're in the room, the headcount otherwise.
              Both give way to the row's buttons on hover. */}
          {connectedHere ? (
            <span className="ml-auto shrink-0 text-[13px] font-medium tabular-nums text-success group-hover:hidden [@media(hover:none)]:hidden">
              <CallDuration />
            </span>
          ) : (
            members.length > 0 && (
              <span className="ml-auto shrink-0 group-hover:hidden [@media(hover:none)]:hidden">
                <CallPill>{members.length}</CallPill>
              </span>
            )
          )}
        </button>
        {/* Discord's floating row buttons, in place of the time or headcount: invite, the room's chat, then the menu. */}
        <button
            type="button"
            aria-label={t('shell.menu.inviteToRoom')}
            title={t('shell.menu.inviteToRoom')}
            onClick={() => setInviting(true)}
            className={`absolute ${hasMenu ? 'right-[68px]' : 'right-10'} z-10 ${top} flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-muted outline-none opacity-0 transition-[opacity,background-color,color] group-hover/voice-row:opacity-100 motion-reduce:transition-none focus-visible:opacity-100 hover:bg-white/10 hover:text-foreground focus-visible:ring-2 focus-visible:ring-focus [@media(hover:none)]:opacity-100`}
          >
            <UserPlusIcon className="size-4" aria-hidden="true" />
          </button>
        <button
            type="button"
            aria-label={chatLabel}
            title={chatLabel}
            onClick={() => {
              if (active && chatOpen) {
                setVoiceChat(false);
                return;
              }
              selectChannel(channel.id);
              setVoiceChat(true);
            }}
            className={`absolute ${hasMenu ? 'right-10' : 'right-2'} z-10 ${top} flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full outline-none opacity-0 transition-[opacity,background-color,color] group-hover/voice-row:opacity-100 motion-reduce:transition-none focus-visible:opacity-100 hover:bg-white/10 hover:text-foreground focus-visible:ring-2 focus-visible:ring-focus [@media(hover:none)]:opacity-100 ${chatOpen ? 'bg-white/10 text-foreground' : 'text-muted'}`}
          >
            <ChatBubbleLeftIcon className="size-4" aria-hidden="true" />
          </button>
        {hasMenu && <RowMenu channelId={channel.id} top={top} />}
      </div>
      {connectedHere && (
        <ul className="pb-1 pl-8 pt-1">
          {members.map((m) => (
            <VoiceMember key={m.userId} entry={m} />
          ))}
          <li>
            <button
              type="button"
              onClick={() => setInviting(true)}
              className="flex h-8 w-full items-center gap-2 rounded-full px-1.5 text-left text-muted outline-none transition-colors hover:bg-default/50 hover:text-foreground focus-visible:ring-2 focus-visible:ring-focus"
            >
              <span className="flex size-[22px] shrink-0 items-center justify-center rounded-full border border-dashed border-white/25">
                <UserPlusIcon size={13} />
              </span>
              <span className="min-w-0 flex-1 truncate text-[15px]">{t('shell.menu.inviteToRoom')}</span>
            </button>
          </li>
        </ul>
      )}
      {inviting && <InviteToRoom channel={channel} onClose={() => setInviting(false)} />}
    </div>
  );
}

/** A private channel says so to screen readers; the lock itself sits on the channel's glyph. */
function PrivateText() {
  const { t } = useT();
  return <span className="sr-only">{t('shell.private')}</span>;
}

/** Person under a voice room, Discord-style. Click someone else in your room to set their volume. */
function VoiceMember({ entry }: { entry: VoiceEntry }) {
  const { t } = useT();
  const user = useStore((s) => s.users[entry.userId]);
  const color = useNameColor(entry.userId);
  const isMe = useStore((s) => s.me?.id === entry.userId);
  const inSameRoom = useStore((s) => s.voiceChannelId === entry.channelId && s.voiceStatus === 'connected');
  const speaking = useStore((s) => inSameRoom && s.speaking.includes(entry.userId));

  const content = (
    <>
      <Avatar user={user} size={22} speaking={speaking} ringBg="var(--app-side)" />
      <span className={`min-w-0 flex-1 truncate text-left text-[15px] ${speaking ? 'text-foreground' : 'text-muted'}`} style={color ? { color } : undefined}>
        {user?.name ?? '…'}
      </span>
      <SoundPlayedMark userId={entry.userId} size={15} className="text-muted" />
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
