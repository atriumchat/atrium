import { AppState } from 'react-native';
import { haptic } from './haptics';
import { Image } from 'expo-image';
import { create } from 'zustand';
import { io, type Socket } from 'socket.io-client';
import { api, ApiError, getCredentials, loadCredentials, saveCredentials } from './api';
import { mergeMessages, type Bootstrap, type CallState, type Category, type Channel, type Dm, type Friend, type Message, type User, type VoiceEntry } from './protocol';
import { t } from './i18n';

type State = {
  ready: boolean; authenticated: boolean; connected: boolean; error: string | null; recoveryKey: string | null;
  data: Bootstrap | null; users: Record<string, User>; dms: Dm[]; friends: Friend[];
  online: string[]; voice: VoiceEntry[]; calls: Record<string, CallState>;
  messages: Record<string, Message[]>; hasMore: Record<string, boolean>; active: string | null;
  /** Who is typing where: conversation -> user -> when we heard it. */
  typing: Record<string, Record<string, number>>;
};
const initial: State = { ready: false, authenticated: false, connected: false, error: null, recoveryKey: null, data: null, users: {}, dms: [], friends: [], online: [], voice: [], calls: {}, messages: {}, hasMore: {}, active: null, typing: {} };
export const useStore = create<State>(() => initial);
let socket: Socket | null = null;
let epoch = 0;
let started = false;
let ending: Promise<void> | null = null;
let cleanupVoice: (() => Promise<void>) | null = null;
export const registerVoiceCleanup = (fn: () => Promise<void>) => { cleanupVoice = fn; };
const pendingHistory = new Map<string, Promise<void>>();
let lastRead = 0;
let readTimer: ReturnType<typeof setTimeout> | undefined;
let refreshTimer: ReturnType<typeof setTimeout> | undefined;

export function showError(e: unknown) { haptic.error(); useStore.setState({ error: e instanceof Error ? e.message : t('error') }); }
export const getSocket = () => socket;

export async function refresh() {
  const generation = epoch;
  const [data, dms, friends] = await Promise.all([api.bootstrap(), api.dms(), api.friends()]);
  if (generation !== epoch) return;
  useStore.setState({ data, users: Object.fromEntries(data.users.map((u) => [u.id, u])), dms, friends, authenticated: true });
}

export async function startSession() {
  if (started) return;
  started = true;
  try {
    if (await loadCredentials()) { useStore.setState({ authenticated: true }); await restoreSession(); }
  } catch (e) { showError(e); }
  finally { useStore.setState({ ready: true }); }
}
export async function restoreSession() {
  try { await refresh(); connect(); }
  catch (e) {
    if (e instanceof ApiError && e.status === 401) await endSession(false);
    else throw e;
  }
}
export async function signIn(server: string, name: string, password: string, invite?: string, key?: string) {
  const session = await api.authenticate(server, name.trim(), password, invite, key);
  await enter(server, session.token, session.recoveryKey ?? null);
  return session;
}
/** In with a session made elsewhere: the first admin of a server set up from the phone, with their new recovery key. */
export async function enter(server: string, token: string, recoveryKey: string | null) {
  epoch++;
  await saveCredentials({ server, token });
  useStore.setState({ ...initial, ready: true, authenticated: true, recoveryKey });
  await restoreSession();
}
export function endSession(revoke = true): Promise<void> {
  if (ending) return ending;
  ending = (async () => {
    epoch++;
    clearTimeout(readTimer); clearTimeout(refreshTimer);
    await cleanupVoice?.().catch(() => {});
    socket?.disconnect(); socket = null;
    const target = getCredentials();
    await saveCredentials(null);
    await Image.clearMemoryCache().catch(() => {});
    pendingHistory.clear();
    useStore.setState({ ...initial, ready: true });
    try { if (revoke && target) await api.logout(target); } catch { /* Local sign-out still completes offline. */ }
  })().finally(() => { ending = null; });
  return ending;
}

function scheduleRefresh() {
  clearTimeout(refreshTimer);
  const generation = epoch;
  refreshTimer = setTimeout(() => {
    if (generation === epoch) void refresh().catch(showError);
  }, 250);
}

function connect() {
  const credentials = getCredentials();
  if (!credentials || socket) return;
  const generation = epoch;
  // Native WebSockets carry no browser Origin. The server keeps its same-origin browser policy.
  const live = io(credentials.server, { path: '/socket.io', transports: ['websocket'], auth: { token: credentials.token }, reconnectionDelay: 1000, reconnectionDelayMax: 15_000 });
  socket = live;
  let connectedBefore = false;
  live.on('connect', () => {
    useStore.setState({ connected: true });
    if (connectedBefore) void catchUp(generation);
    connectedBefore = true;
  });
  live.on('disconnect', () => useStore.setState({ connected: false, calls: {}, online: [] }));
  live.on('connect_error', (error) => {
    if (error.message === 'unauthorized') void endSession(false);
  });
  live.on('session:ended', () => void endSession(false));
  live.on('presence', (online: string[]) => useStore.setState({ online }));
  live.on('voice:state', (voice: VoiceEntry[]) => useStore.setState({ voice }));
  live.on('call:state', (call: CallState) => useStore.setState((s) => {
    const calls = { ...s.calls };
    if (call.participants.length) calls[call.dmId] = call; else delete calls[call.dmId];
    return { calls };
  }));
  live.on('voice:moved', () => void cleanupVoice?.());
  live.on('voice:ended', ({ channelId }: { channelId: string }) => {
    // An ended DM call may be unrelated to the room this device is using.
    const calls = useStore.getState().calls;
    if (calls[channelId]?.participants.some((p) => p.userId === useStore.getState().data?.me.id)) void cleanupVoice?.();
  });
  live.on('categories', (categories: Category[]) => useStore.setState((s) => ({ data: s.data ? { ...s.data, categories } : null })));
  live.on('channels', (channels: Channel[]) => {
    useStore.setState((s) => ({ data: s.data ? { ...s.data, channels } : null }));
  });
  live.on('server:updated', (patch: { serverName: string; serverIcon: string | null }) => useStore.setState((s) => ({ data: s.data ? { ...s.data, ...patch } : null })));
  for (const event of ['user:new', 'user:updated']) live.on(event, (user: User) => useStore.setState((s) => ({
    users: { ...s.users, [user.id]: user }, data: s.data?.me.id === user.id ? { ...s.data, me: user } : s.data,
  })));
  live.on('typing', ({ channelId, userId }: { channelId: string; userId: string }) => useStore.setState((s) => ({ typing: { ...s.typing, [channelId]: { ...s.typing[channelId], [userId]: Date.now() } } })));
  live.on('friends:changed', scheduleRefresh);
  live.on('dms:changed', scheduleRefresh);
  live.on('message:new', receiveMessage);
  live.on('message:updated', (m: Message) => patchMessage(m.channelId, m.id, m));
  live.on('message:deleted', ({ id, channelId }: { id: string; channelId: string }) => useStore.setState((s) => ({ messages: { ...s.messages, [channelId]: (s.messages[channelId] ?? []).filter((m) => m.id !== id) } })));
  live.on('message:reactions', ({ id, channelId, reactions }: { id: string; channelId: string; reactions: Message['reactions'] }) => patchMessage(channelId, id, { reactions }));
  live.on('read:state', ({ conversationId }: { conversationId: string; at: number }) => useStore.setState((s) => ({ data: s.data ? { ...s.data, unread: { ...s.data.unread, [conversationId]: 0 }, mentions: { ...s.data.mentions, [conversationId]: 0 } } : null })));
  live.on('me:status', ({ status, text }: { status: Bootstrap['myStatus']; text: string }) => useStore.setState((s) => ({ data: s.data ? { ...s.data, myStatus: status, myStatusText: text } : null })));
}

async function catchUp(generation: number) {
  try {
    await refresh();
    if (generation !== epoch) return;
    const active = useStore.getState().active;
    useStore.setState((s) => ({ messages: active && s.messages[active] ? { [active]: s.messages[active] } : {}, hasMore: {} }));
    if (active) await loadHistory(active, false, true);
  } catch (e) {
    if (generation !== epoch) return;
    if (e instanceof ApiError && e.status === 401) void endSession(false); else showError(e);
  }
}

export function receiveMessage(message: Message) {
  useStore.setState((s) => {
    const open = s.active === message.channelId && AppState.currentState === 'active';
    const data = s.data;
    const duplicate = s.messages[message.channelId]?.some((m) => m.id === message.id);
    return {
      messages: s.messages[message.channelId] ? { ...s.messages, [message.channelId]: mergeMessages(s.messages[message.channelId]!, [message], s.active === message.channelId ? Number.MAX_SAFE_INTEGER : 500) } : s.messages,
      data: data && !duplicate && !open && message.userId !== data.me.id ? { ...data, unread: { ...data.unread, [message.channelId]: (data.unread[message.channelId] ?? 0) + 1 } } : data,
      dms: message.dm ? s.dms.map((d) => d.id === message.channelId ? { ...d, lastMessageAt: message.createdAt, preview: { userId: message.userId, text: message.content, images: message.attachments.length } } : d).sort((a, b) => b.lastMessageAt - a.lastMessageAt) : s.dms,
    };
  });
  if (useStore.getState().active === message.channelId) scheduleRead();
}
function patchMessage(channel: string, id: string, patch: Partial<Message>) {
  useStore.setState((s) => ({ messages: { ...s.messages, [channel]: (s.messages[channel] ?? []).map((m) => m.id === id ? { ...m, ...patch } : m) } }));
}

export async function loadHistory(id: string, older = false, fresh = false) {
  const key = `${epoch}:${id}:${older}`;
  const existing = pendingHistory.get(key);
  if (existing) return existing;
  const generation = epoch;
  const job = (async () => {
    const s = useStore.getState();
    if (!older && !fresh && s.messages[id] && s.hasMore[id] !== undefined) return;
    const before = older ? s.messages[id]?.at(-1) : undefined;
    const dm = s.dms.some((d) => d.id === id);
    const page = await api.history(id, dm, before);
    if (generation !== epoch) return;
    useStore.setState((current) => {
      const cache = { ...current.messages, [id]: mergeMessages(current.messages[id] ?? [], page, current.active === id ? Number.MAX_SAFE_INTEGER : 500) };
      // Keep only a small number of conversations in memory.
      for (const cachedId of Object.keys(cache)) if (Object.keys(cache).length > 8 && cachedId !== id && cachedId !== current.active) delete cache[cachedId];
      return { messages: cache, hasMore: { ...current.hasMore, [id]: page.length === 50 } };
    });
    if (useStore.getState().active === id) scheduleRead();
  })().finally(() => pendingHistory.delete(key));
  pendingHistory.set(key, job);
  return job;
}

export function setActive(active: string | null) {
  useStore.setState((s) => {
    const messages = { ...s.messages };
    const hasMore = { ...s.hasMore };
    if (s.active && s.active !== active && (messages[s.active]?.length ?? 0) > 500) {
      messages[s.active] = messages[s.active]!.slice(0, 500);
      hasMore[s.active] = true;
    }
    if (active && !messages[active]) messages[active] = [];
    return { active, messages, hasMore };
  });
  if (active) scheduleRead();
}
export function scheduleRead() {
  clearTimeout(readTimer);
  readTimer = setTimeout(() => {
    const { active, messages } = useStore.getState();
    const newest = active ? messages[active]?.[0] : null;
    if (!active || !newest || AppState.currentState !== 'active' || !socket?.connected) return;
    lastRead = Date.now();
    void ask('read', { conversationId: active, at: newest.createdAt }).catch(() => {});
  }, Math.max(100, 2500 - (Date.now() - lastRead)));
}
let lastTypingSent = 0;
export function sendTyping(channelId: string) {
  const now = Date.now();
  if (now - lastTypingSent < 2500) return;
  lastTypingSent = now;
  socket?.emit('typing', { channelId });
}
export async function ask<T = unknown>(event: string, payload: unknown): Promise<T> {
  if (!socket?.connected) throw new Error(t('noConnection'));
  const generation = epoch;
  let response;
  try { response = await socket.timeout(10_000).emitWithAck(event, payload); }
  catch { throw new Error(t('timeout')); }
  if (generation !== epoch) throw new Error(t('sessionExpired'));
  if (!response?.ok) throw new Error(response?.error ?? t('error'));
  return response as T;
}

AppState.addEventListener('change', (state) => {
  if (!getCredentials()) return;
  if (state === 'active') {
    if (!socket?.connected) socket?.connect(); else void catchUp(epoch);
    scheduleRead();
  }
  // LiveKit needs signalling while a call is active; the OS suspends idle apps itself.
});

export function dmTitle(dm: Dm, users: Record<string, User>, me?: string) {
  return dm.name || dm.members.filter((id) => id !== me).map((id) => users[id]?.name ?? '…').join(', ');
}

export function addDm(dm: Dm) {
  useStore.setState((s) => ({ dms: [dm, ...s.dms.filter((d) => d.id !== dm.id)].sort((a, b) => b.lastMessageAt - a.lastMessageAt) }));
}
export async function messageUser(userId: string): Promise<Dm | undefined> {
  try { const dm = await api.openDm(userId); addDm(dm); return dm; }
  catch (e) { showError(e instanceof Error ? e.message : t('common.openDmFailed')); }
}
