import { io, type Socket } from 'socket.io-client';
import type { CallState, Channel, Message, MyStatus, Reaction, User, VoiceEntry } from './types';
import { api, setToken } from './api';
import { desktop } from './desktop';
import {
  addUser,
  dmTitle,
  isDmId,
  markTyping,
  openConversationId,
  pageActive,
  patchMessage,
  receiveMessage,
  removeMessage,
  refreshDms,
  refreshFriends,
  selfEntry,
  setChannels,
  showError,
  useStore,
  voiceMembers,
} from './store';
import { playSound } from './voice/sounds';
import { leaveVoice } from './voice/voice';
import { checkSiteUpdate } from './updates';
import { plainText } from './ui/Markdown';
import { invalidateHistory, refreshNewest } from './chat/history';

let socket: Socket | null = null;

/*
 * Read marks. Whenever a conversation's unread count drops to zero (it was opened or marked read) or a message
 * lands in the one on screen, the server hears how far we've read, so every device shows the same counts.
 * Only while the person can see the page (pageActive): a hidden or unfocused window reads nothing, and the
 * mark goes out once it's back in front. They go over the socket, at most one per conversation every 2.5 s
 * (the last one always follows), so a busy chat doesn't turn into a request per message.
 */
const READ_GAP = 2500;
/** The furthest mark sent (or on its way) per conversation; also raised by read:state from other devices. */
const sentRead: Record<string, number> = {};
const queuedRead: Record<string, number> = {};
const lastReadSend: Record<string, number> = {};
const readTimers: Record<string, ReturnType<typeof setTimeout>> = {};

function latestAt(conversationId: string) {
  return useStore.getState().messages[conversationId]?.at(-1)?.createdAt ?? Date.now();
}

function sendRead(conversationId: string, at: number) {
  if ((sentRead[conversationId] ?? 0) >= at) return;
  queuedRead[conversationId] = Math.max(queuedRead[conversationId] ?? 0, at);
  if (readTimers[conversationId]) return;
  const wait = (lastReadSend[conversationId] ?? 0) + READ_GAP - Date.now();
  if (wait <= 0) flushRead(conversationId);
  else readTimers[conversationId] = setTimeout(() => flushRead(conversationId), wait);
}

function flushRead(conversationId: string) {
  delete readTimers[conversationId];
  const at = queuedRead[conversationId];
  delete queuedRead[conversationId];
  if (at === undefined || (sentRead[conversationId] ?? 0) >= at) return;
  sentRead[conversationId] = at;
  lastReadSend[conversationId] = Date.now();
  // Failed: forget it, so the next chance to send tries again.
  const failed = () => {
    if (sentRead[conversationId] === at) delete sentRead[conversationId];
  };
  if (socket?.connected) {
    socket
      .timeout(10_000)
      .emitWithAck('read', { conversationId, at })
      .then((res: { ok?: boolean } | undefined) => !res?.ok && failed(), failed);
  } else {
    api.markRead(conversationId, at).catch(failed);
  }
}

// Counts straight from the server (after a reconnect) aren't something we read here: nothing to send back.
let serverCounts = false;

useStore.subscribe((s, prev) => {
  if (!serverCounts) for (const [id, n] of Object.entries(prev.unread)) if (n > 0 && !s.unread[id]) sendRead(id, latestAt(id));
  const open = openConversationId(s);
  if (open && open !== openConversationId(prev) && pageActive()) sendRead(open, latestAt(open));
  // Mentions are part of the unread messages: read the conversation and its red badge goes too.
  const stale = Object.keys(s.mentions).filter((id) => s.mentions[id] > 0 && !s.unread[id]);
  if (stale.length) useStore.setState({ mentions: { ...s.mentions, ...Object.fromEntries(stale.map((id) => [id, 0])) } });
});

/** The window is back in front: what's on screen has now been read. */
function readOpenConversation() {
  const open = openConversationId();
  if (!open || !pageActive()) return;
  // Clearing the count sends the mark (above); with nothing counted, just catch the mark up.
  if (useStore.getState().unread[open]) useStore.setState((s) => ({ unread: { ...s.unread, [open]: 0 } }));
  else sendRead(open, latestAt(open));
}

if (typeof window !== 'undefined') {
  window.addEventListener('focus', readOpenConversation);
  document.addEventListener('visibilitychange', readOpenConversation);
}

/*
 * Catching up after a reconnect: messages sent while we were away never reached us. The open conversation gets
 * its newest page again, the other loaded ones are dropped and load fresh when opened, and the unread counts
 * come from the server. Everyone reconnects together after a server restart, so each client waits 0–3 s first.
 */
let everConnected = false;
let catchUpTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleCatchUp() {
  if (catchUpTimer) clearTimeout(catchUpTimer);
  catchUpTimer = setTimeout(() => {
    catchUpTimer = null;
    void catchUp();
  }, Math.random() * 3000);
}

async function catchUp() {
  const open = openConversationId();
  const { hasMore } = useStore.getState();
  for (const id of Object.keys(hasMore)) if (id !== open) invalidateHistory(id);
  if (open && hasMore[open] !== undefined) {
    await refreshNewest(open, isDmId(open) ? 'dm' : 'channel').catch(() => {
      // Still offline or the server is busy: the next reconnect tries again.
    });
  }
  try {
    const { unread, mentions } = await api.bootstrap();
    serverCounts = true;
    useStore.setState({ unread: unread ?? {}, mentions: mentions ?? {} });
  } catch {
    // Keep the counts we have.
  } finally {
    serverCounts = false;
  }
  readOpenConversation();
}

export function getSocket() {
  return socket;
}

let unauthorized: () => void = () => {};
// While a password change is on its way the server drops our socket (the old token just died); that refusal
// mustn't sign us out, the new token is coming.
let ignoreAuthErrorsUntil = 0;

/** Call before changing the password. */
export function expectNewToken() {
  ignoreAuthErrorsUntil = Date.now() + 15_000;
}

/** The fresh token after a password change: keep it and reconnect with it. */
export function switchToken(token: string) {
  setToken(token);
  ignoreAuthErrorsUntil = 0;
  connectSocket(token, unauthorized);
}

export function connectSocket(token: string, onUnauthorized: () => void) {
  unauthorized = onUnauthorized;
  socket?.disconnect();
  socket = io({ path: '/socket.io', auth: { token } });

  socket.on('connect', () => {
    if (everConnected) scheduleCatchUp();
    everConnected = true;
    // A reconnect usually means the server restarted for a deploy: maybe there's a newer site.
    checkSiteUpdate();
    // Anything private may have changed while we were offline.
    refreshFriends();
    refreshDms();
    // The server forgets voice presence when a socket drops; re-announce it after a reconnect.
    const { voiceChannelId, voiceStatus, muted, deafened, screenSharing, cameraOn } = useStore.getState();
    if (voiceChannelId && voiceStatus === 'connected') {
      socket?.emit('voice:join', { channelId: voiceChannelId, muted, deafened });
      socket?.emit('voice:update', { screen: screenSharing, video: cameraOn });
    }
  });

  // Calls may end while we're offline; the server resends the live ones on reconnect.
  socket.on('disconnect', () => useStore.setState({ calls: {} }));

  socket.on('connect_error', (err) => {
    if (err.message === 'unauthorized' && Date.now() > ignoreAuthErrorsUntil) onUnauthorized();
  });

  socket.on('presence', (online: string[]) => useStore.setState({ online }));
  socket.on('channels', (channels: Channel[]) => {
    setChannels(channels);
    // The voice room you're in was deleted: hang up.
    const { voiceChannelId } = useStore.getState();
    if (voiceChannelId && !isDmId(voiceChannelId) && !channels.some((c) => c.id === voiceChannelId)) leaveVoice();
  });
  // An admin renamed the server or changed its icon.
  socket.on('server:updated', ({ serverName, serverIcon }: { serverName: string; serverIcon: string | null }) =>
    useStore.setState({ serverName, serverIcon }),
  );
  socket.on('channels:muted', (mutedChannels: string[]) => useStore.setState({ mutedChannels }));
  socket.on('user:new', (user: User) => addUser(user));
  socket.on('user:updated', (user: User) => {
    addUser(user);
    if (useStore.getState().me?.id === user.id) useStore.setState({ me: user });
  });
  socket.on('friends:changed', () => refreshFriends());
  socket.on('dms:changed', () => refreshDms());
  socket.on('invite:used', () => useStore.setState((s) => ({ inviteVersion: s.inviteVersion + 1 })));

  socket.on('call:state', (call: CallState) => {
    const { me, voiceChannelId, voiceStatus, calls, dms } = useStore.getState();
    // Join/leave cues for the call we're in, like in voice rooms.
    if (me && voiceChannelId === call.dmId && voiceStatus === 'connected') {
      const others = (c?: CallState) => new Set((c?.participants ?? []).map((p) => p.userId).filter((id) => id !== me.id));
      const before = others(calls[call.dmId]);
      const after = others(call);
      if ([...after].some((id) => !before.has(id))) playSound('join');
      else if ([...before].some((id) => !after.has(id))) playSound('leave');
    }
    useStore.setState((s) => {
      const next = { ...s.calls };
      if (call.participants.length > 0) next[call.dmId] = call;
      else delete next[call.dmId];
      return { calls: next };
    });
    // A call from a group we haven't loaded yet (just added to it).
    if (!dms.some((d) => d.id === call.dmId)) refreshDms();
  });
  socket.on('typing', ({ channelId, userId }: { channelId: string; userId: string }) => markTyping(channelId, userId));

  socket.on('message:new', (message: Message) => {
    const { me } = useStore.getState();
    const isOpen = message.channelId === openConversationId();
    receiveMessage(message);
    if (isOpen && message.userId !== me?.id && pageActive()) sendRead(message.channelId, message.createdAt);
    const quiet = useStore.getState().myStatus === 'dnd';
    if (!quiet && message.userId !== me?.id && (document.hidden || !isOpen)) {
      const mentioned = message.mentionsAll || (!!me && !!message.mentions?.includes(me.id));
      playSound(mentioned ? 'mention' : 'message');
    }
    // Desktop app, window in the background: a system notification for personal messages (not channel chatter).
    if (!quiet && desktop && message.dm && message.userId !== me?.id && (document.hidden || !document.hasFocus())) {
      const s = useStore.getState();
      const dm = s.dms.find((d) => d.id === message.channelId);
      const author = s.users[message.userId]?.name ?? 'Кто-то';
      const title = dm?.kind === 'group' ? `${author} · ${dmTitle(dm, s.users, me?.id)}` : author;
      const images = message.attachments.length;
      desktop.notify(title, plainText(message.content, s.users) || (images > 1 ? `${images} вложения` : 'Вложение'), message.channelId);
    }
  });

  // Read on another tab or device.
  socket.on('read:state', ({ conversationId, at }: { conversationId: string; at: number }) => {
    sentRead[conversationId] = Math.max(sentRead[conversationId] ?? 0, at);
    useStore.setState((s) => ({ unread: { ...s.unread, [conversationId]: 0 }, mentions: { ...s.mentions, [conversationId]: 0 } }));
  });
  socket.on('blocks', (blocked: string[]) => useStore.setState({ blocked }));
  socket.on('me:status', ({ status, text, until }: { status: MyStatus; text: string; until?: number | null }) =>
    useStore.setState({ myStatus: status, myStatusText: text, myStatusUntil: until ?? null }),
  );
  socket.on('message:updated', (message: Message) => patchMessage(message.channelId, message.id, message));
  socket.on('message:deleted', ({ id, channelId }: { id: string; channelId: string }) => removeMessage(channelId, id));
  socket.on('message:reactions', ({ id, channelId, reactions }: { id: string; channelId: string; reactions: Reaction[] }) =>
    patchMessage(channelId, id, { reactions }),
  );

  socket.on('voice:state', (entries: VoiceEntry[]) => {
    const { me, voiceChannelId, voiceStatus, voiceState } = useStore.getState();
    if (me && voiceChannelId && voiceStatus === 'connected') {
      const others = (list: VoiceEntry[]) =>
        new Set(voiceMembers(list, voiceChannelId).filter((e) => e.userId !== me.id).map((e) => e.userId));
      const before = others(voiceState);
      const after = others(entries);
      if ([...after].some((id) => !before.has(id))) playSound('join');
      else if ([...before].some((id) => !after.has(id))) playSound('leave');
    }
    // Still connecting: keep showing yourself in the room until the server's list has you.
    const self = voiceChannelId && voiceStatus === 'connecting' ? selfEntry(voiceChannelId) : null;
    const mine = self && !entries.some((e) => e.userId === self.userId && e.channelId === self.channelId);
    useStore.setState({ voiceState: mine ? [...entries, self] : entries });
  });

  // You joined from another tab or device: the server moved you there, this one hangs up.
  socket.on('voice:moved', () => {
    if (!useStore.getState().voiceChannelId) return;
    void leaveVoice({ silent: true });
    showError(MOVED);
  });
}

export const MOVED = 'Звонок перешёл на другое устройство';

export function disconnectSocket() {
  socket?.disconnect();
  socket = null;
  everConnected = false;
  if (catchUpTimer) clearTimeout(catchUpTimer);
  catchUpTimer = null;
}

/**
 * Send to a text channel or, when `channelId` is a DM id, privately to that conversation.
 * `attachments` are upload ids from api.uploadImage.
 */
/** Emits and waits for the server's answer; shows the error (or "no connection") and returns null on failure. */
async function ask<T = unknown>(event: string, data: unknown, failure: string): Promise<(T & { ok: true }) | null> {
  if (!socket?.connected) {
    showError('Нет связи с сервером');
    return null;
  }
  try {
    const res = await socket.timeout(10_000).emitWithAck(event, data);
    if (!res?.ok) {
      showError(res?.error ?? failure);
      return null;
    }
    return res;
  } catch {
    showError('Сервер не ответил');
    return null;
  }
}

export async function sendMessage(channelId: string, content: string, attachments: string[] = [], replyTo?: string): Promise<boolean> {
  const isDm = useStore.getState().dms.some((d) => d.id === channelId);
  const res = isDm
    ? await ask('dm:send', { dmId: channelId, content, attachments, replyTo }, 'Не удалось отправить сообщение')
    : await ask('message:send', { channelId, content, attachments, replyTo }, 'Не удалось отправить сообщение');
  return res !== null;
}

export async function editMessage(id: string, content: string): Promise<boolean> {
  return (await ask('message:edit', { id, content }, 'Не удалось изменить сообщение')) !== null;
}

export async function deleteMessage(id: string): Promise<boolean> {
  return (await ask('message:delete', { id }, 'Не удалось удалить сообщение')) !== null;
}

export function toggleReaction(messageId: string, emoji: string) {
  void ask('reaction:toggle', { messageId, emoji }, 'Не удалось поставить реакцию');
}

export function declineCall(dmId: string) {
  socket?.emit('call:decline', { dmId });
}

/** From inside a call: ring everyone in the DM/group who isn't in it. */
export function ringAgain(dmId: string) {
  socket?.emit('call:ring', { dmId });
}

let lastTypingSent = 0;

export function sendTyping(channelId: string) {
  const now = Date.now();
  if (now - lastTypingSent < 2500) return;
  lastTypingSent = now;
  socket?.emit('typing', { channelId });
}
