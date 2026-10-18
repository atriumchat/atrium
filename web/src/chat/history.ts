import { t } from '../i18n';
import { api } from '../api';
import { mergeMessages, PAGE_SIZE, setHasMore, showError, useStore } from '../store';

const inFlight = new Map<string, Promise<void>>();

/**
 * Load a conversation's latest messages once, sharing the request between whoever asks first — the open
 * chat, a hover over its row, or the background warm-up — so opening a chat shows it right away.
 */
export function ensureHistory(id: string, kind: 'channel' | 'dm', { quiet = false } = {}): Promise<void> {
  if (useStore.getState().hasMore[id] !== undefined) return Promise.resolve();
  const running = inFlight.get(id);
  if (running) return running;
  const job = (kind === 'dm' ? api.dmMessages(id) : api.messages(id))
    .then((list) => {
      mergeMessages(id, list);
      setHasMore(id, list.length === PAGE_SIZE);
    })
    .catch((e) => {
      if (!quiet) showError(t('chat.loadFailed', { error: e instanceof Error ? e.message : String(e) }));
    })
    .finally(() => inFlight.delete(id));
  inFlight.set(id, job);
  return job;
}

/** After start-up, quietly fetch the newest conversations and the text channels, one at a time. */
export async function warmUpHistory() {
  const { dms, channels } = useStore.getState();
  const queue: [string, 'channel' | 'dm'][] = [
    ...dms.slice(0, 6).map((d) => [d.id, 'dm'] as [string, 'dm']),
    ...channels.filter((c) => c.kind === 'text').map((c) => [c.id, 'channel'] as [string, 'channel']),
  ];
  for (const [id, kind] of queue) await ensureHistory(id, kind, { quiet: true });
}

/**
 * After a reconnect: the newest page of a loaded conversation again, for whatever was sent, edited or deleted
 * while we were offline. Older pages already loaded stay, unless more than a page was missed, in which case
 * the list restarts from the newest page so it never has a hole in the middle.
 */
export async function refreshNewest(id: string, kind: 'channel' | 'dm') {
  const known = new Set((useStore.getState().messages[id] ?? []).map((m) => m.id));
  const page = await (kind === 'dm' ? api.dmMessages(id) : api.messages(id));
  const first = page[0], last = page.at(-1);
  useStore.setState((s) => {
    const have = s.messages[id] ?? [];
    // Nothing left on the server: keep only what arrived over the socket while we were asking.
    if (!first || !last) return { messages: { ...s.messages, [id]: have.filter((m) => !known.has(m.id)) }, hasMore: { ...s.hasMore, [id]: false } };
    if (page.length === PAGE_SIZE && !have.some((m) => m.id === first.id)) {
      return { messages: { ...s.messages, [id]: page }, hasMore: { ...s.hasMore, [id]: true } };
    }
    // Inside the page's time span the server's copy wins: gone means deleted. Anything newer came over the socket.
    const inPage = new Set(page.map((m) => m.id));
    const kept = have.filter((m) => !inPage.has(m.id) && (m.createdAt < first.createdAt || m.createdAt > last.createdAt));
    return { messages: { ...s.messages, [id]: [...kept, ...page].sort((a, b) => a.createdAt - b.createdAt) } };
  });
}

/** Forget a conversation's messages, so they're fetched fresh the next time it's opened. */
export function invalidateHistory(id: string) {
  useStore.setState((s) => {
    const { [id]: _messages, ...messages } = s.messages;
    const { [id]: _more, ...hasMore } = s.hasMore;
    return { messages, hasMore };
  });
}
