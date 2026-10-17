import type { Message } from '../types';
import { get, set, type State } from './core';
import { openConversationId, pageActive } from './shell';
import { refreshDms } from './people';

export const PAGE_SIZE = 50;

/** Messages: loaded history, unread counts, typing, the composer's reply and edit. */
export type ChatSlice = {
  messages: Record<string, Message[]>;
  hasMore: Record<string, boolean>; // key present = history for the channel was loaded
  unread: Record<string, number>;
  /** Unread mentions of you (or of everyone) per conversation; they get the red badge. */
  mentions: Record<string, number>;
  typing: Record<string, Record<string, number>>; // channelId -> userId -> last typing timestamp
  /** The message the composer is answering, per conversation. */
  replyingTo: Record<string, string>;
  /** Your message being edited in place, if any. */
  editingId: string | null;
  /** A message to scroll to and flash once its conversation is open (from the inbox). */
  jumpTo: string | null;
};

export function chatSlice(): ChatSlice {
  return {
    messages: {},
    hasMore: {},
    unread: {},
    mentions: {},
    typing: {},
    replyingTo: {},
    editingId: null,
    jumpTo: null,
  };
}

export function markRead(channelId: string) {
  set((s) => ({ unread: { ...s.unread, [channelId]: 0 } }));
}

/** `list` with `incoming` merged in, de-duplicated by id and kept in time order. Untouched messages keep their objects. */
function merged(list: Message[] | undefined, incoming: Message[]): Message[] {
  const last = list?.at(-1);
  // The usual case, a new message at the end: no need to rebuild and sort the whole list.
  if (list && last && incoming.length === 1 && incoming[0].createdAt >= last.createdAt && !list.some((m) => m.id === incoming[0].id)) {
    return [...list, incoming[0]];
  }
  const byId = new Map((list ?? []).map((m) => [m.id, m]));
  for (const m of incoming) byId.set(m.id, m);
  return [...byId.values()].sort((a, b) => a.createdAt - b.createdAt);
}

/** Merge messages into a channel, de-duplicated by id and kept in time order. */
export function mergeMessages(channelId: string, incoming: Message[]) {
  set((s) => ({ messages: { ...s.messages, [channelId]: merged(s.messages[channelId], incoming) } }));
}

/** Replace a message in place (after an edit or a reaction), keeping its position. */
export function patchMessage(channelId: string, id: string, patch: Partial<Message>) {
  set((s) => {
    const list = s.messages[channelId];
    if (!list?.some((m) => m.id === id)) return {};
    return { messages: { ...s.messages, [channelId]: list.map((m) => (m.id === id ? { ...m, ...patch } : m)) } };
  });
}

/** A deleted message disappears, and replies to it say so. */
export function removeMessage(channelId: string, id: string) {
  set((s) => {
    const list = s.messages[channelId];
    if (!list) return {};
    const next = list
      .filter((m) => m.id !== id)
      .map((m) => (m.replyTo?.id === id ? { ...m, replyTo: { id, deleted: true as const } } : m));
    const replyingTo = { ...s.replyingTo };
    if (replyingTo[channelId] === id) delete replyingTo[channelId];
    return { messages: { ...s.messages, [channelId]: next }, replyingTo, editingId: s.editingId === id ? null : s.editingId };
  });
}

export function setReplyingTo(channelId: string, id: string | null) {
  set((s) => {
    const replyingTo = { ...s.replyingTo };
    if (id) replyingTo[channelId] = id;
    else delete replyingTo[channelId];
    return { replyingTo };
  });
}

export function setEditing(id: string | null) {
  set({ editingId: id });
}

export function setHasMore(channelId: string, value: boolean) {
  set((s) => ({ hasMore: { ...s.hasMore, [channelId]: value } }));
}

export function receiveMessage(message: Message) {
  const { me, dms } = get();
  const id = message.channelId;
  const known = dms.some((d) => d.id === id);
  // A conversation on screen in a hidden or unfocused window isn't being read: it counts like any other.
  const counts = message.userId !== me?.id && (id !== openConversationId() || !pageActive());
  const mentioned = counts && (message.mentionsAll || (!!me && !!message.mentions?.includes(me.id)));
  // One update for everything a message touches, so the UI re-renders once per message, not three times.
  set((s) => {
    const next: Partial<State> = {
      // Merge even before history is loaded: the history fetch de-duplicates, and this avoids losing
      // a message that lands while that fetch is in flight.
      messages: { ...s.messages, [id]: merged(s.messages[id], [message]) },
    };
    if (message.dm && known) {
      // Keep the DM list ordered by latest activity.
      const preview = { userId: message.userId, text: message.content.slice(0, 140), images: message.attachments.length };
      next.dms = s.dms.map((d) => (d.id === id ? { ...d, lastMessageAt: message.createdAt, preview } : d)).sort((a, b) => b.lastMessageAt - a.lastMessageAt);
    }
    if (counts) {
      next.unread = { ...s.unread, [id]: (s.unread[id] ?? 0) + 1 };
      if (mentioned) next.mentions = { ...s.mentions, [id]: (s.mentions[id] ?? 0) + 1 };
    }
    // They sent it, so they've stopped typing; an emptied conversation drops out of the map entirely.
    if (s.typing[id]?.[message.userId] !== undefined) {
      const { [message.userId]: _done, ...rest } = s.typing[id];
      const typing = { ...s.typing };
      if (Object.keys(rest).length) typing[id] = rest;
      else delete typing[id];
      next.typing = typing;
    }
    return next;
  });
  // A brand-new conversation needs a refetch.
  if (message.dm && !known) refreshDms();
}

export function markTyping(channelId: string, userId: string) {
  set((s) => ({ typing: { ...s.typing, [channelId]: { ...(s.typing[channelId] ?? {}), [userId]: Date.now() } } }));
}

/*
 * Memory: a conversation you've left keeps only its newest page; scrolling back through a long history
 * shouldn't stay in memory for the rest of the session. A little later, not at once, so the screen sliding
 * away doesn't jump and flipping straight back costs nothing.
 */
const trimTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** Store listener (subscribed in core.ts). */
export function trimLeftConversation(s: State, prev: State) {
  const open = openConversationId(s);
  const left = openConversationId(prev);
  if (open) {
    clearTimeout(trimTimers.get(open));
    trimTimers.delete(open);
  }
  if (!left || left === open || trimTimers.has(left)) return;
  trimTimers.set(
    left,
    setTimeout(() => {
      trimTimers.delete(left);
      const { messages } = get();
      const list = messages[left];
      if (openConversationId() === left || !list || list.length <= PAGE_SIZE) return;
      // Older pages are gone again: the chat fetches them when scrolled up to.
      set((st) => ({ messages: { ...st.messages, [left]: list.slice(-PAGE_SIZE) }, hasMore: { ...st.hasMore, [left]: true } }));
    }, 5000),
  );
}
