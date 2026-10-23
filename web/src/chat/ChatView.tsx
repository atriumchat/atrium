import { Fragment, memo, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type DragEvent, type Ref } from 'react';
import { Button, Dropdown, Input, Label, TextField } from '@heroui/react';
import { api } from '../api';
import { addDm, getSessionEpoch, mergeMessages, openFriends, openPicker, PAGE_SIZE, refreshDms, setEditing, setHasMore, setReplyingTo, showError, useStore, voiceMembers } from '../store';
import { deleteMessage, editMessage, sendMessage, sendTyping, toggleReaction } from '../socket';
import { joinVoice, leaveVoice } from '../voice/voice';
import { dayDivider, fullStamp, sameDay, timeOf } from './format';
import { localeOf, useT } from '../i18n';
import { useIsMobile } from '../hooks';
import type { Dm, Message, Upload, User } from '../types';
import { Avatar } from '../ui/Avatar';
import { DmAvatar } from '../ui/DmAvatar';
import { ChannelHeader, HeaderIcon } from '../shell/ChannelHeader';
import { ChannelMenu } from '../shell/ChannelMenu';
import { CallDuration } from '../voice/CallDuration';
import { CallButtons, DmCallPanel } from '../voice/CallPanel';
import { ConfirmDialog, Dialog } from '../ui/Dialog';
import { UserProfile } from '../people/UserProfile';
import { GroupInfo } from '../people/GroupInfo';
import { fileSize, MessageAttachments } from './Attachments';
import { EmojiPicker } from '../ui/EmojiPicker';
import { ensureHistory } from './history';
import { invitedRoom, Markdown, mentionsToNames, namesToMentions, plainText } from '../ui/Markdown';
import { RoomCard } from '../voice/RoomCard';
import { RoundButton } from '../ui/ui';
import { EmptyState } from '../ui/Illustrations';
import { ArrowUpIcon, AtIcon, DotsIcon, HashIcon, LogoutIcon, PaperclipIcon, PencilIcon, PlusIcon, ReplyIcon, SmileIcon, TrashIcon, UserPlusIcon, XIcon } from '../ui/icons';

const GROUP_GAP = 7 * 60_000;
const TYPING_TTL = 4500;
const MAX_ATTACHMENTS = 10;

const hasFiles = (e: DragEvent) => e.dataTransfer.types.includes('Files');

const EMOJI_ONLY = /^(?:\p{Extended_Pictographic}|\p{Emoji_Modifier}|\p{Regional_Indicator}|‍|️|\s)+$/u;
const HAS_PICTO = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u;

function isEmojiOnly(text: string) {
  const t = text.trim();
  return t.length > 0 && t.length <= 16 && EMOJI_ONLY.test(t) && HAS_PICTO.test(t);
}

/** A text channel or a direct-message conversation; both render with the same chat. */
export type Conversation = { id: string; kind: 'channel' | 'dm'; title: string; userId?: string };

const fetchHistory = (c: Conversation, before: Message) => (c.kind === 'dm' ? api.dmMessages(c.id, before.createdAt, before.id) : api.messages(c.id, before.createdAt, before.id));

/** `room`: a voice room's own chat, shown beside the call without a header of its own. */
export function ChatView({ conversation, room = false }: { conversation: Conversation; room?: boolean }) {
  const { t } = useT();
  const channel = conversation;
  const isDm = conversation.kind === 'dm';
  const messages = useStore((s) => s.messages[channel.id]);
  const loaded = useStore((s) => s.hasMore[channel.id] !== undefined);
  const hasMore = useStore((s) => s.hasMore[channel.id] ?? false);
  const peer = useStore((s) => (conversation.userId ? s.users[conversation.userId] : undefined));
  const dm = useStore((s) => (isDm ? s.dms.find((d) => d.id === conversation.id) : undefined));
  const isGroup = dm?.kind === 'group';

  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const restoreFromBottom = useRef<number | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const composer = useRef<ComposerHandle>(null);
  const [dragging, setDragging] = useState(false);
  // dragenter/dragleave fire for every child crossed; count them to know when the pointer really left.
  const dragDepth = useRef(0);

  useEffect(() => {
    if (!loaded) void ensureHistory(channel.id, conversation.kind);
    // `conversation` is stable per mounted chat (the view is keyed by id).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel.id, loaded]);

  const keepPinned = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (restoreFromBottom.current !== null) {
      el.scrollTop = el.scrollHeight - restoreFromBottom.current;
      restoreFromBottom.current = null;
    } else if (stickToBottom.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, []);

  useLayoutEffect(keepPinned, [messages, loaded, keepPinned]);

  // Opened from the inbox: scroll to that message and flash it once it's in the list.
  const jumpTo = useStore((s) => s.jumpTo);
  useEffect(() => {
    if (!jumpTo || !messages?.some((m) => m.id === jumpTo)) return;
    const el = document.getElementById(`msg-${jumpTo}`);
    if (!el) return;
    stickToBottom.current = false;
    el.scrollIntoView({ block: 'center' });
    el.animate([{ backgroundColor: 'rgba(255,255,255,0.12)' }, { backgroundColor: 'transparent' }], { duration: 1600 });
    useStore.setState({ jumpTo: null });
  }, [jumpTo, messages]);

  async function loadOlder() {
    const oldest = messages?.[0];
    if (!oldest || loadingOlder) return;
    const epoch = getSessionEpoch();
    setLoadingOlder(true);
    try {
      const list = await fetchHistory(conversation, oldest);
      if (epoch !== getSessionEpoch()) return;
      const el = scrollRef.current;
      restoreFromBottom.current = el ? el.scrollHeight - el.scrollTop : null;
      mergeMessages(channel.id, list);
      setHasMore(channel.id, list.length === PAGE_SIZE);
    } catch (e) {
      if (epoch === getSessionEpoch()) showError(t('chat.loadFailed', { error: e instanceof Error ? e.message : String(e) }));
    } finally {
      setLoadingOlder(false);
    }
  }

  const list = messages ?? [];
  const placeholder = t(isGroup ? 'chat.placeholder.group' : isDm ? 'chat.placeholder.dm' : room ? 'chat.placeholder.room' : 'chat.placeholder.channel', { title: channel.title });

  return (
    <div
      className="relative flex min-h-0 flex-1 flex-col"
      onDragEnter={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        dragDepth.current += 1;
        setDragging(true);
      }}
      onDragOver={(e) => {
        if (hasFiles(e)) e.preventDefault();
      }}
      onDragLeave={(e) => {
        if (!hasFiles(e)) return;
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (dragDepth.current === 0) setDragging(false);
      }}
      onDrop={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        dragDepth.current = 0;
        setDragging(false);
        composer.current?.addFiles(Array.from(e.dataTransfer.files));
      }}
    >
      {dragging && (
        <div className="pointer-events-none absolute inset-3 z-20 flex flex-col items-center justify-center gap-1 rounded-[24px] border-2 border-dashed border-accent bg-window/90 text-center">
          <div className="text-[20px] font-medium">{t('chat.drop.title')}</div>
          <div className="text-[15px] text-muted">
            {t(isGroup ? 'chat.drop.group' : isDm ? 'chat.drop.dm' : room ? 'chat.drop.room' : 'chat.drop.channel', { title: channel.title })}
          </div>
        </div>
      )}
      {room ? null : dm ? (
        <>
          <DmHeader dm={dm} title={channel.title} />
          <DmCallPanel dm={dm} />
        </>
      ) : (
        <>
          <ChannelHeader
            leading={
              <HeaderIcon>
                <HashIcon />
              </HeaderIcon>
            }
            title={channel.title}
            actions={<ChannelMenu channelId={channel.id} />}
          />
          <OngoingCall />
        </>
      )}

      <div
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          if (el.scrollTop < 120 && hasMore) loadOlder();
        }}
        className="flex flex-1 flex-col overflow-y-auto px-2 pb-2"
      >
        {/* Nothing written yet: the conversation's drawing in the middle instead of the header at the top. */}
        {loaded && !hasMore && list.length === 0 ? (
          <EmptyState
            art={isGroup ? 'group' : isDm ? 'chat' : 'channel'}
            title={isDm || room ? channel.title : `#${channel.title}`}
            text={t(isGroup ? 'chat.start.group' : isDm ? 'chat.start.dm' : room ? 'chat.start.room' : 'chat.start.channel')}
          />
        ) : (
          <div className="flex-1" />
        )}
        {loaded && !hasMore && list.length > 0 && (
          <div className="px-4 pb-2 pt-6">
            {isGroup && dm ? (
              <>
                <DmAvatar dm={dm} size={72} />
                <h2 className="mt-3 truncate text-[28px] font-light leading-9 tracking-[-0.6px]">{channel.title}</h2>
                <p className="text-[15px] text-muted">{t('chat.intro.group', { title: channel.title })}</p>
              </>
            ) : isDm ? (
              <>
                <Avatar user={peer} size={72} />
                <h2 className="mt-3 truncate text-[28px] font-light leading-9 tracking-[-0.6px]">{channel.title}</h2>
                <p className="text-[15px] text-muted">{t('chat.intro.dm', { title: channel.title })}</p>
              </>
            ) : room ? (
              <>
                <h2 className="truncate text-[22px] font-light leading-8 tracking-[-0.4px]">{channel.title}</h2>
                <p className="text-[15px] text-muted">{t('chat.start.room')}</p>
              </>
            ) : (
              <>
                <span className="flex h-16 w-16 items-center justify-center rounded-full bg-default text-foreground">
                  <HashIcon size={32} />
                </span>
                <h2 className="mt-3 truncate text-[28px] font-light leading-9 tracking-[-0.6px]">{t('chat.intro.welcome', { title: channel.title })}</h2>
                <p className="text-[15px] text-muted">{t('chat.intro.channel')}</p>
              </>
            )}
          </div>
        )}
        {hasMore && <div className="py-3 text-center text-[13px] text-muted">{loadingOlder ? t('chat.loadingOlder') : ''}</div>}

        {list.map((m, i) => {
          const prev = list[i - 1];
          const newDay = !prev || !sameDay(prev.createdAt, m.createdAt);
          const startsGroup = newDay || prev.userId !== m.userId || m.createdAt - prev.createdAt > GROUP_GAP;
          return (
            <Fragment key={m.id}>
              {newDay && (
                <div className="flex justify-center pb-1 pt-5" role="separator">
                  <span className="rounded-full bg-default px-3 py-1 text-[12px] font-medium text-muted">{dayDivider(m.createdAt)}</span>
                </div>
              )}
              <MessageRow message={m} startsGroup={startsGroup} />
            </Fragment>
          );
        })}
      </div>

      <TypingLine channelId={channel.id} onVisibilityChange={keepPinned} />
      <Composer
        ref={composer}
        id={channel.id}
        placeholder={placeholder}
        onResize={keepPinned}
        onSend={() => {
          // Your own message always brings you down to it, even if you were reading history.
          stickToBottom.current = true;
        }}
      />
    </div>
  );
}

/** Header of a DM or group: who it is, call buttons, and a menu to add people (and rename or leave a group). */
function DmHeader({ dm, title }: { dm: Dm; title: string }) {
  const { t } = useT();
  const peer = useStore((s) => s.users[dm.userId ?? '']);
  const online = useStore((s) => dm.kind === 'dm' && s.online.includes(dm.userId ?? ''));
  const [renaming, setRenaming] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const group = dm.kind === 'group';

  async function leave() {
    if (useStore.getState().voiceChannelId === dm.id) await leaveVoice();
    await api.leaveGroup(dm.id);
    openFriends();
    await refreshDms();
  }

  return (
    <>
      <ChannelHeader
        showOnline={false}
        leading={
          dm.userId && !group ? (
            <UserProfile userId={dm.userId} placement="bottom" className="cursor-pointer rounded-full">
              <Avatar user={peer} size={36} online={online} />
            </UserProfile>
          ) : (
            <GroupInfo dm={dm} onRename={() => setRenaming(true)} onLeave={() => setLeaving(true)}>
              <DmAvatar dm={dm} size={36} />
            </GroupInfo>
          )
        }
        title={title}
        subtitle={group ? t('chat.members', { n: dm.members.length }) : online ? t('chat.online') : t('chat.offline')}
        actions={
          <>
            <CallButtons dm={dm} />
            <ConversationMenu dm={dm} onRename={() => setRenaming(true)} onLeave={() => setLeaving(true)} />
          </>
        }
      />
      {renaming && <RenameGroup dm={dm} onClose={() => setRenaming(false)} />}
      {leaving && <ConfirmDialog title={t('chat.leaveTitle')} text={t('chat.leaveText')} confirmLabel={t('chat.leave')} onConfirm={leave} onClose={() => setLeaving(false)} />}
    </>
  );
}

function ConversationMenu({ dm, onRename, onLeave }: { dm: Dm; onRename: () => void; onLeave: () => void }) {
  const { t } = useT();
  const group = dm.kind === 'group';

  return (
    <>
      <Dropdown>
        <Dropdown.Trigger
          aria-label={t('chat.more')}
          className="flex h-10 w-10 items-center justify-center rounded-full text-foreground outline-none transition-colors hover:bg-white/10 data-[focus-visible=true]:ring-2 data-[focus-visible=true]:ring-focus"
        >
          <DotsIcon size={20} />
        </Dropdown.Trigger>
        <Dropdown.Popover placement="bottom end" className="min-w-56">
          <Dropdown.Menu
            aria-label={t('chat.actions')}
            onAction={(key) => {
              if (key === 'add') openPicker({ mode: 'add', dmId: dm.id });
              if (key === 'rename') onRename();
              if (key === 'leave') onLeave();
            }}
          >
            <Dropdown.Item id="add" textValue={t('chat.addPeople')}>
              <Label>{group ? t('chat.addPeople') : t('chat.createGroup')}</Label>
              <UserPlusIcon size={16} className="ml-auto" />
            </Dropdown.Item>
            {group ? (
              <Dropdown.Item id="rename" textValue={t('chat.rename')}>
                <Label>{t('chat.rename')}</Label>
                <PencilIcon size={16} className="ml-auto" />
              </Dropdown.Item>
            ) : null}
            {group ? (
              <Dropdown.Item id="leave" textValue={t('chat.leaveGroup')} variant="danger">
                <Label>{t('chat.leaveGroup')}</Label>
                <LogoutIcon size={16} className="ml-auto text-danger" />
              </Dropdown.Item>
            ) : null}
          </Dropdown.Menu>
        </Dropdown.Popover>
      </Dropdown>
    </>
  );
}

function RenameGroup({ dm, onClose }: { dm: Dm; onClose: () => void }) {
  const { t } = useT();
  const [name, setName] = useState(dm.name);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      addDm(await api.renameGroup(dm.id, name));
      onClose();
    } catch (e) {
      showError(e instanceof Error ? e.message : t('common.failed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      title={t('chat.groupName')}
      subtitle={t('chat.groupNameHint')}
      onClose={onClose}
      footer={
        <>
          <Button variant="tertiary" onPress={onClose} className="rounded-full">
            {t('common.cancel')}
          </Button>
          <Button onPress={save} isPending={busy} className="rounded-full">
            {t('common.save')}
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <TextField fullWidth value={name} onChange={setName} maxLength={48} autoFocus aria-label={t('chat.groupName')}>
          <Input className="h-11 bg-default text-[16px]" placeholder={t('chat.groupNameExample')} />
        </TextField>
      </form>
    </Dialog>
  );
}

/** Banner like the reference's call header: who's talking right now, and a way in. */
function OngoingCall() {
  const { t } = useT();
  const voiceState = useStore((s) => s.voiceState);
  const channels = useStore((s) => s.channels);
  const users = useStore((s) => s.users);
  const myRoom = useStore((s) => (s.voiceStatus === 'connected' ? s.voiceChannelId : null));
  const speaking = useStore((s) => s.speaking);

  const rooms = channels
    .filter((c) => c.kind === 'voice')
    .map((c) => ({ channel: c, members: voiceMembers(voiceState, c.id) }))
    .filter((r) => r.members.length > 0)
    .sort((a, b) => (a.channel.id === myRoom ? -1 : b.channel.id === myRoom ? 1 : b.members.length - a.members.length));
  const room = rooms[0];
  if (!room) return null;
  const inside = room.channel.id === myRoom;

  return (
    <div className="mx-2 mt-2 flex shrink-0 items-center gap-4 rounded-full bg-default py-2 pl-2 pr-2 max-md:gap-3 md:mx-6 md:mt-1">
      {/* On a phone only the first three faces, so the room name and the button still fit. */}
      <div className="flex shrink-0 items-center gap-1 max-md:[&>*:nth-child(n+4)]:hidden">
        {room.members.slice(0, 5).map((m) => (
          <Avatar key={m.userId} user={users[m.userId]} size={40} speaking={inside && speaking.includes(m.userId)} ringBg="var(--default)" />
        ))}
        {room.members.length > 5 && <span className="pl-1 text-[13px] text-muted">+{room.members.length - 5}</span>}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[15px] font-medium">{room.channel.name}</div>
        <div className="truncate text-[13px] tabular-nums text-muted">
          {inside ? (
            <>
              {t('chat.call.ongoing')} · <CallDuration />
            </>
          ) : (
            room.members.map((m) => users[m.userId]?.name ?? '…').join(', ')
          )}
        </div>
      </div>
      {!inside && (
        <Button onPress={() => joinVoice(room.channel.id)} className="h-10 shrink-0 whitespace-nowrap rounded-full px-5 font-medium max-md:px-4 [--button-bg-hover:#ffffff] [--button-bg:#f2f2f4] [--button-fg:#0c0c0e]">
          <span className="max-md:hidden">{t('chat.call.join')}</span>
          <span className="md:hidden">{t('chat.call.joinShort')}</span>
        </Button>
      )}
    </div>
  );
}

const QUICK_REACTIONS = ['👍', '❤️', '😂', '🔥'];

/**
 * Messages from someone you blocked stay folded into one quiet line, unless you open them. Memoised: a new
 * message, edit or reaction only re-renders its own row (message objects stay the same unless they change).
 */
const MessageRow = memo(function MessageRow(props: { message: Message; startsGroup: boolean }) {
  const { t } = useT();
  const blocked = useStore((s) => s.blocked.includes(props.message.userId));
  const [shown, setShown] = useState(false);
  if (blocked && !shown) {
    return (
      <div className="py-1 pl-[68px] pr-4 text-[13px] text-faint">
        {t('chat.blocked.label')} ·{' '}
        <button onClick={() => setShown(true)} className="text-muted hover:text-foreground hover:underline">
          {t('chat.blocked.show')}
        </button>
      </div>
    );
  }
  return <MessageBody {...props} />;
});

function MessageBody({ message, startsGroup }: { message: Message; startsGroup: boolean }) {
  const { t } = useT();
  const user = useStore((s) => s.users[message.userId]);
  const meId = useStore((s) => s.me?.id);
  const isAdmin = useStore((s) => s.canManageChannels);
  const editing = useStore((s) => s.editingId === message.id);
  const [confirming, setConfirming] = useState(false);
  const mine = message.userId === meId;
  const canDelete = mine || (!message.dm && isAdmin);
  // A reply always shows who wrote it, like Discord, even in the middle of someone's run of messages.
  const showHeader = startsGroup || !!message.replyTo;
  const big = !message.replyTo && isEmojiOnly(message.content);

  function remove(e?: { shiftKey?: boolean }) {
    // Shift skips the question, as in Discord.
    if (e?.shiftKey) void deleteMessage(message.id);
    else setConfirming(true);
  }

  return (
    <div
      id={`msg-${message.id}`}
      className={`group relative rounded-[16px] pl-[68px] pr-4 transition-colors ${showHeader ? 'mt-4 pb-0.5 pt-0.5' : 'py-0.5'} ${
        'hover:bg-white/[0.03]'
      } ${editing ? 'bg-white/[0.03]' : ''}`}
    >
      {message.replyTo && <ReplyLine reply={message.replyTo} />}
      {showHeader ? (
        <>
          <UserProfile userId={message.userId} className={`absolute left-4 cursor-pointer rounded-full ${message.replyTo ? 'top-7' : 'top-1'}`}>
            <Avatar user={user} size={40} />
          </UserProfile>
          <div className="flex items-baseline gap-2">
            <UserProfile userId={message.userId} className="cursor-pointer text-[16px] font-medium leading-[22px] hover:underline">
              <span>{user?.name ?? t('chat.someone')}</span>
            </UserProfile>
            {/* Just the time: the day is on the divider above; the full date is on hover. */}
            <span className="text-[12px] text-faint tabular-nums max-md:text-[13px]" title={fullStamp(message.createdAt)}>
              {timeOf(message.createdAt)}
            </span>
          </div>
        </>
      ) : (
        <span className="absolute left-0 w-[60px] select-none text-right text-[11px] leading-[22px] text-faint opacity-0 group-hover:opacity-100">
          {timeOf(message.createdAt)}
        </span>
      )}
      {editing ? (
        <EditBox message={message} />
      ) : (
        message.content &&
        (invitedRoom(message.content) ? (
          <RoomCard channelId={invitedRoom(message.content)!} />
        ) : (
          <Markdown
            text={message.content}
            big={big}
            after={
              message.editedAt && (
                <span className="text-[11px] text-faint" title={t('chat.editedAt', { time: fullStamp(message.editedAt) })}>
                  {' '}({t('chat.edited')})
                </span>
              )
            }
          />
        ))
      )}
      <MessageAttachments attachments={message.attachments} />
      <Reactions message={message} meId={meId} />
      {!editing && (
        <MessageActions
          onReact={(emoji) => toggleReaction(message.id, emoji)}
          onReply={() => setReplyingTo(message.channelId, message.id)}
          onEdit={mine && message.content !== undefined && !invitedRoom(message.content) ? () => setEditing(message.id) : undefined}
          onDelete={canDelete ? remove : undefined}
        />
      )}
      {confirming && (
        <ConfirmDialog
          title={t('chat.deleteTitle')}
          text={t('chat.deleteText')}
          confirmLabel={t('chat.delete')}
          onConfirm={async () => {
            await deleteMessage(message.id);
          }}
          onClose={() => setConfirming(false)}
        />
      )}
    </div>
  );
}

/** The answered message above a reply: who and what, in one faint line; a click jumps to it. */
function ReplyLine({ reply }: { reply: NonNullable<Message['replyTo']> }) {
  const { t } = useT();
  const users = useStore((s) => s.users);
  const author = reply.deleted ? undefined : users[reply.userId];
  const text = reply.deleted ? t('chat.messageDeleted') : plainText(reply.content, users) || (reply.attachments ? t('chat.attachment') : '');

  function jump() {
    const el = document.getElementById(`msg-${reply.id}`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.animate([{ backgroundColor: 'rgba(255,255,255,0.12)' }, { backgroundColor: 'transparent' }], { duration: 1400 });
  }

  return (
    <button onClick={jump} disabled={reply.deleted} className="relative mb-0.5 flex max-w-full items-center gap-1.5 text-left text-[14px] text-muted enabled:hover:text-foreground">
      {/* The little spine from the avatar up to the line, as in Discord. */}
      <span className="absolute -left-[46px] top-[9px] h-3 w-[34px] rounded-tl-[8px] border-l-2 border-t-2 border-white/15" />
      {author && <Avatar user={author} size={16} />}
      {author && <span className="shrink-0 font-medium text-foreground/80">{author.name}</span>}
      <span className={`truncate ${reply.deleted ? 'italic' : ''}`}>{text}</span>
    </button>
  );
}

function Reactions({ message, meId }: { message: Message; meId: string | undefined }) {
  const { t } = useT();
  const users = useStore((s) => s.users);
  const reactions = message.reactions ?? [];
  if (reactions.length === 0) return null;
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1">
      {reactions.map((r) => {
        const mine = !!meId && r.users.includes(meId);
        const who = r.users.map((id) => users[id]?.name ?? '…').join(', ');
        return (
          <button
            key={r.emoji}
            onClick={() => toggleReaction(message.id, r.emoji)}
            title={who}
            aria-label={`${r.emoji} ${r.users.length}: ${who}`}
            aria-pressed={mine}
            className={`flex h-7 items-center gap-1 rounded-full px-2 text-[13px] tabular-nums transition-colors ${
              mine ? 'bg-white font-medium text-black hover:bg-[#e7e7ea]' : 'bg-white/[0.16] text-foreground hover:bg-white/[0.22]'
            }`}
          >
            <span className="text-[15px] leading-none">{r.emoji}</span>
            {r.users.length}
          </button>
        );
      })}
      <EmojiPicker
        label={t('chat.addReaction')}
        onPick={(emoji) => toggleReaction(message.id, emoji)}
        className="flex h-7 w-7 items-center justify-center rounded-full bg-default text-muted opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100 data-[focus-visible=true]:opacity-100"
      >
        <SmileIcon size={15} />
      </EmojiPicker>
    </div>
  );
}

/** Hover bar at the message's top right: quick reactions, any emoji, reply, edit, delete. */
function MessageActions(props: { onReact: (emoji: string) => void; onReply: () => void; onEdit?: () => void; onDelete?: (e?: { shiftKey?: boolean }) => void }) {
  const { t } = useT();
  const btn = 'flex h-8 w-8 items-center justify-center rounded-full text-muted transition-colors hover:bg-white/10 hover:text-foreground';
  return (
    <div className="absolute -top-4 right-3 z-10 hidden items-center gap-0.5 rounded-full border-[0.5px] border-white/10 bg-default p-0.5 shadow-[0_6px_20px_rgba(0,0,0,.45)] group-hover:flex group-focus-within:flex has-[[aria-expanded=true]]:flex">
      {QUICK_REACTIONS.map((e) => (
        <button key={e} onClick={() => props.onReact(e)} aria-label={t('chat.reaction', { emoji: e })} className={`${btn} text-[17px]`}>
          {e}
        </button>
      ))}
      <EmojiPicker label={t('chat.moreReactions')} onPick={props.onReact} className={btn}>
        <SmileIcon size={18} />
      </EmojiPicker>
      <span className="mx-0.5 h-5 w-px bg-white/10" />
      <button onClick={props.onReply} aria-label={t('chat.reply')} title={t('chat.reply')} className={btn}>
        <ReplyIcon size={18} />
      </button>
      {props.onEdit && (
        <button onClick={props.onEdit} aria-label={t('chat.edit')} title={t('chat.edit')} className={btn}>
          <PencilIcon size={17} />
        </button>
      )}
      {props.onDelete && (
        <button onClick={(e) => props.onDelete!(e)} aria-label={t('chat.delete')} title={t('chat.deleteHint')} className={`${btn} hover:text-danger`}>
          <TrashIcon size={17} />
        </button>
      )}
    </div>
  );
}

/** Editing your message in place: Enter saves, Esc cancels, an empty text asks to delete instead. */
function EditBox({ message }: { message: Message }) {
  const { t } = useT();
  const users = useStore((s) => s.users);
  const [text, setText] = useState(() => mentionsToNames(message.content, users));
  const ref = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${Math.min(el.scrollHeight, 320)}px`;
  }, [text]);

  useEffect(() => {
    const el = ref.current;
    el?.focus();
    el?.setSelectionRange(el.value.length, el.value.length);
  }, []);

  async function save() {
    const content = namesToMentions(text.trim(), users);
    if (content === message.content) return setEditing(null);
    if (!content && message.attachments.length === 0) return showError(t('chat.emptyEdit'));
    if (await editMessage(message.id, content)) setEditing(null);
  }

  return (
    <div className="py-1">
      <textarea
        ref={ref}
        value={text}
        rows={1}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setEditing(null);
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            void save();
          }
        }}
        aria-label={t('chat.editMessage')}
        className="w-full resize-none rounded-[20px] bg-default px-4 py-2.5 text-[16px] leading-6 text-foreground outline-none"
      />
      <div className="px-1 pt-1 text-[12px] text-faint">
        Esc — <button onClick={() => setEditing(null)} className="text-[#64a8ff] hover:underline">{t('chat.editCancel')}</button> · Enter —{' '}
        <button onClick={() => void save()} className="text-[#64a8ff] hover:underline">{t('chat.editSave')}</button>
      </div>
    </div>
  );
}

function TypingLine({ channelId, onVisibilityChange }: { channelId: string; onVisibilityChange: () => void }) {
  const { t } = useT();
  const typing = useStore((s) => s.typing[channelId]);
  const users = useStore((s) => s.users);
  const meId = useStore((s) => s.me?.id);
  const [now, setNow] = useState(() => Date.now());

  // Wake up once, when the first name shown runs out, instead of ticking every second.
  useEffect(() => {
    let next = Infinity;
    for (const [id, ts] of Object.entries(typing ?? {})) if (id !== meId && now - ts < TYPING_TTL) next = Math.min(next, ts + TYPING_TTL);
    if (next === Infinity) return;
    const timer = setTimeout(() => setNow(Date.now()), Math.max(0, next - Date.now()));
    return () => clearTimeout(timer);
  }, [typing, now, meId]);

  const names = Object.entries(typing ?? {})
    .filter(([id, ts]) => id !== meId && now - ts < TYPING_TTL)
    .map(([id]) => users[id]?.name)
    .filter(Boolean);
  const visible = names.length > 0;

  useLayoutEffect(onVisibilityChange, [visible, onVisibilityChange]);

  return (
    <div className="flex h-6 shrink-0 items-center gap-1.5 px-8 text-[13px] text-muted">
      {visible && (
        <>
          <span className="flex gap-[3px]">
            {[0, 1, 2].map((i) => (
              <span key={i} className="h-1.5 w-1.5 rounded-full bg-muted" style={{ animation: `typing-dot 1.2s ${i * 0.15}s infinite` }} />
            ))}
          </span>
          <span className="truncate">
            <span className="font-medium text-foreground">{names.join(', ')}</span> {names.length > 1 ? t('chat.typing.many') : t('chat.typing.one')}
          </span>
        </>
      )}
    </div>
  );
}

type ComposerHandle = { addFiles: (files: File[]) => void };

/** An attached picture or file: shown at once, sendable once the upload has finished. */
type PendingFile = { key: string; name: string; size: number; preview?: string; upload?: Upload };

type MentionOption = { id: string; label: string; user?: User };

function Composer(props: { ref: Ref<ComposerHandle>; id: string; placeholder: string; onResize: () => void; onSend: () => void }) {
  const { t } = useT();
  const { id, placeholder, onResize, onSend } = props;
  const [text, setText] = useState('');
  const [pending, setPending] = useState<PendingFile[]>([]);
  const [caret, setCaret] = useState(0);
  const [pick, setPick] = useState(0);
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const isMobile = useIsMobile();
  const users = useStore((s) => s.users);
  const replyId = useStore((s) => s.replyingTo[id]);
  const replyTo = useStore((s) => (replyId ? s.messages[id]?.find((m) => m.id === replyId) : undefined));
  const uploading = pending.some((p) => !p.upload);
  const hasPending = pending.length > 0;
  const canSend = !uploading && (text.trim().length > 0 || hasPending);

  // "@" right before the caret opens a list of people to mention.
  const mentionQuery = /(?:^|\s)@([^\s@]{0,32})$/.exec(text.slice(0, caret))?.[1];
  const options: MentionOption[] =
    mentionQuery === undefined
      ? []
      : [
          ...Object.values(users)
            .filter((u) => u.name.toLowerCase().startsWith(mentionQuery.toLowerCase()))
            .sort((a, b) => a.name.localeCompare(b.name, localeOf()))
            .slice(0, 6)
            .map((u) => ({ id: u.id, label: u.name, user: u })),
          ...(t('common.md.everyone').startsWith(mentionQuery.toLowerCase()) ? [{ id: 'all', label: t('common.md.everyone') }] : []),
        ];
  const showMentions = options.length > 0;

  useImperativeHandle(props.ref, () => ({ addFiles }));

  // Leaving the chat with pictures still attached: let the browser drop their local copies.
  const pendingNow = useRef(pending);
  pendingNow.current = pending;
  useEffect(() => () => pendingNow.current.forEach((p) => p.preview && URL.revokeObjectURL(p.preview)), []);

  // On a phone, focusing would pop the keyboard over the chat the moment it opens.
  useEffect(() => {
    if (!isMobile) ref.current?.focus();
  }, [id, isMobile]);

  // Answering someone puts you straight back in the text field.
  useEffect(() => {
    if (replyId) ref.current?.focus();
  }, [replyId]);

  useEffect(() => setPick(0), [mentionQuery]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, [text]);

  // The preview strip and the reply line change the composer's height; keep the chat pinned to the newest message.
  useLayoutEffect(onResize, [hasPending, !!replyTo, onResize]);

  function addFiles(files: File[]) {
    const accepted = files.slice(0, Math.max(0, MAX_ATTACHMENTS - pending.length));
    if (accepted.length < files.length) showError(t('chat.maxAttachments', { n: MAX_ATTACHMENTS }));
    for (const file of accepted) {
      const key = crypto.randomUUID();
      const preview = file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined;
      setPending((list) => [...list, { key, name: file.name, size: file.size, preview }]);
      api.upload(file).then(
        (upload) => setPending((list) => list.map((p) => (p.key === key ? { ...p, upload } : p))),
        (e) => {
          showError(t('chat.uploadFailed', { name: file.name, error: e instanceof Error ? e.message : String(e) }));
          if (preview) URL.revokeObjectURL(preview);
          setPending((list) => list.filter((p) => p.key !== key));
        },
      );
    }
    ref.current?.focus();
  }

  function remove(file: PendingFile) {
    if (file.preview) URL.revokeObjectURL(file.preview);
    setPending((list) => list.filter((p) => p.key !== file.key));
  }

  function insertMention(option: MentionOption) {
    const before = text.slice(0, caret).replace(/@[^\s@]*$/, `@${option.label} `);
    const next = before + text.slice(caret);
    setText(next);
    setCaret(before.length);
    requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.setSelectionRange(before.length, before.length);
    });
  }

  async function send() {
    if (!canSend) return;
    const content = namesToMentions(text.trim(), users);
    const files = pending;
    const answering = replyId;
    setText('');
    setPending([]);
    setReplyingTo(id, null);
    onSend();
    const ok = await sendMessage(id, content, files.map((p) => p.upload!.id), answering);
    if (ok) {
      files.forEach((p) => p.preview && URL.revokeObjectURL(p.preview));
    } else {
      setText((current) => current || mentionsToNames(content, users));
      setPending((current) => (current.length ? current : files));
      if (answering) setReplyingTo(id, answering);
    }
  }

  function editLast() {
    const { me, messages } = useStore.getState();
    const last = [...(messages[id] ?? [])].reverse().find((m) => m.userId === me?.id);
    if (last) setEditing(last.id);
  }

  return (
    <div className="relative flex items-end gap-3 px-6 pb-5 max-md:gap-2 max-md:px-2 max-md:pb-[max(8px,env(safe-area-inset-bottom))]">
      {showMentions && (
        <div role="listbox" aria-label={t('chat.mention')} className="absolute bottom-[calc(100%-8px)] left-[88px] right-[88px] z-20 rounded-[20px] border-[0.5px] border-white/10 bg-default p-1.5 shadow-[0_12px_32px_rgba(0,0,0,.5)] max-md:left-2 max-md:right-2">
          {options.map((o, i) => (
            <button
              key={o.id}
              role="option"
              aria-selected={i === pick}
              onMouseDown={(e) => {
                e.preventDefault();
                insertMention(o);
              }}
              onMouseEnter={() => setPick(i)}
              className={`flex h-10 w-full items-center gap-2.5 rounded-full px-2 text-left text-[15px] ${i === pick ? 'bg-white/10' : ''}`}
            >
              {o.user ? (
                <Avatar user={o.user} size={26} ringBg="var(--default)" />
              ) : (
                <span className="flex h-[26px] w-[26px] items-center justify-center rounded-full bg-white text-black">
                  <AtIcon size={15} />
                </span>
              )}
              <span className="truncate">{o.label}</span>
              {!o.user && <span className="text-[13px] text-faint">{t('chat.mentionAll')}</span>}
            </button>
          ))}
        </div>
      )}
      <RoundButton size={isMobile ? 'md' : 'lg'} label={t('chat.attachFile')} onPress={() => fileInput.current?.click()} className="max-md:mb-1">
        <PlusIcon strokeWidth={2.5} />
      </RoundButton>
      <input
        ref={fileInput}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          addFiles(Array.from(e.target.files ?? []));
          e.target.value = '';
        }}
      />
      <div className="flex min-h-12 min-w-0 flex-1 flex-col justify-center rounded-[24px] bg-default px-5">
        {replyTo && (
          <div className="-mx-2 mt-2 flex items-center gap-2 rounded-full bg-white/[0.06] py-1.5 pl-3 pr-1.5 text-[13px] text-muted">
            <ReplyIcon size={15} className="shrink-0" />
            <span className="min-w-0 flex-1 truncate">
              {t('chat.replyTo')} <span className="font-medium text-foreground">{users[replyTo.userId]?.name ?? '…'}</span>:{' '}
              {plainText(replyTo.content, users) || t('chat.attachmentLower')}
            </span>
            <button onClick={() => setReplyingTo(id, null)} aria-label={t('chat.cancelReply')} className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full hover:bg-white/10 hover:text-foreground">
              <XIcon size={14} strokeWidth={2.5} />
            </button>
          </div>
        )}
        {hasPending && (
          <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 pt-4">
            {pending.map((p) => (
              <div key={p.key} className={`relative shrink-0 overflow-hidden bg-window ${p.preview ? 'h-24 w-24 rounded-[14px]' : 'flex h-24 w-44 flex-col justify-center gap-1 rounded-[18px] px-3'}`}>
                {p.preview ? (
                  <img src={p.preview} alt="" className={`h-full w-full object-cover transition-opacity ${p.upload ? '' : 'opacity-50'}`} />
                ) : (
                  <>
                    <PaperclipIcon size={18} className="text-muted" />
                    <span className="truncate text-[13px] text-foreground">{p.name}</span>
                    <span className="text-[12px] text-faint">{fileSize(p.size)}</span>
                  </>
                )}
                {!p.upload && (
                  <span className="absolute inset-0 flex items-center justify-center bg-black/30">
                    <span className="h-6 w-6 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                  </span>
                )}
                <button
                  type="button"
                  aria-label={t('chat.removeFile', { name: p.name })}
                  onClick={() => remove(p)}
                  className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80"
                >
                  <XIcon size={14} strokeWidth={3} />
                </button>
              </div>
            ))}
          </div>
        )}
        <textarea
          ref={ref}
          rows={1}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setCaret(e.target.selectionStart ?? e.target.value.length);
            sendTyping(id);
          }}
          onSelect={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
          onKeyDown={(e) => {
            if (showMentions && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
              e.preventDefault();
              setPick((i) => (i + (e.key === 'ArrowDown' ? 1 : options.length - 1)) % options.length);
              return;
            }
            if (showMentions && (e.key === 'Enter' || e.key === 'Tab') && !e.shiftKey) {
              e.preventDefault();
              insertMention(options[pick]);
              return;
            }
            if (e.key === 'Escape' && replyId) {
              setReplyingTo(id, null);
              return;
            }
            if (e.key === 'ArrowUp' && !text && !hasPending) {
              e.preventDefault();
              editLast();
              return;
            }
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send();
            }
          }}
          onPaste={(e) => {
            const files = Array.from(e.clipboardData.files);
            if (files.length === 0) return;
            e.preventDefault();
            addFiles(files);
          }}
          placeholder={placeholder}
          aria-label={placeholder}
          className="max-h-[220px] w-full resize-none bg-transparent py-3 text-[16px] leading-6 text-foreground outline-none placeholder:text-faint placeholder-shown:overflow-hidden placeholder-shown:text-ellipsis placeholder-shown:whitespace-nowrap"
        />
      </div>
      <RoundButton size={isMobile ? 'md' : 'lg'} tone={canSend ? 'accent' : 'plain'} label={t('chat.send')} isDisabled={!canSend} onPress={send} className="max-md:mb-1">
        <ArrowUpIcon strokeWidth={2.5} />
      </RoundButton>
    </div>
  );
}
