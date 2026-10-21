import * as SecureStore from 'expo-secure-store';
import { t } from './i18n';
import { historyPath, normalizeServer, parseMediaCookie, type Bootstrap, type Channel, type Dm, type Friend, type InboxItem, type Message, type MyInvite, type MyStatus, type Session, type User } from './protocol';

export type Credentials = { server: string; token: string };
let credentials: Credentials | null = null;
let mediaCookie: { server: string; token: string; value: string } | null = null;
export class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }
export const getCredentials = () => credentials;
export async function loadCredentials() {
  const raw = await SecureStore.getItemAsync('gomex.session');
  if (raw) {
    try { const saved = JSON.parse(raw); credentials = { server: normalizeServer(saved.server), token: String(saved.token) }; }
    catch { await SecureStore.deleteItemAsync('gomex.session'); }
  }
  return credentials;
}
export async function saveCredentials(value: Credentials | null) {
  if (value) await SecureStore.setItemAsync('gomex.session', JSON.stringify(value), { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
  else await SecureStore.deleteItemAsync('gomex.session');
  credentials = value;
  if (!value || mediaCookie?.server !== value.server || mediaCookie?.token !== value.token) mediaCookie = null;
}

export async function request<T>(path: string, init: RequestInit = {}, target = credentials): Promise<T> {
  if (!target) throw new Error(t('sessionExpired'));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(`${target.server}${path}`, {
      ...init, signal: controller.signal,
      headers: { 'Content-Type': 'application/json', ...(target.token ? { Authorization: `Bearer ${target.token}` } : {}), ...init.headers },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new ApiError(res.status, typeof body.detail === 'string' ? body.detail : t('error'));
    }
    const cookie = parseMediaCookie(res.headers.get('set-cookie'));
    if (path === '/api/bootstrap' && cookie && credentials?.server === target.server && credentials.token === target.token) {
      mediaCookie = { server: target.server, token: target.token, value: cookie };
    }
    return await res.json() as T;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new Error(t('noConnection'));
  } finally { clearTimeout(timer); }
}
const post = (body?: unknown): RequestInit => ({ method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });
export const api = {
  authenticate: (server: string, name: string, password: string, invite?: string, key?: string) => request<Session>(key !== undefined ? '/api/recover' : invite === undefined ? '/api/login' : '/api/register', post(key !== undefined ? { name, key, password } : { name, password, invite }), { server, token: '' }),
  checkInvite: (server: string, code: string) => request<{ inviter: string; left: number | null }>(`/api/invite/check/${encodeURIComponent(code)}`, {}, { server, token: '' }),
  bootstrap: () => request<Bootstrap>('/api/bootstrap'),
  dms: () => request<Dm[]>('/api/dms'),
  friends: () => request<Friend[]>('/api/friends'),
  history: (id: string, dm: boolean, oldest?: Message) => request<Message[]>(historyPath(id, dm, oldest)),
  openDm: (userId: string) => request<Dm>('/api/dms', post({ userId })),
  createGroup: (userIds: string[]) => request<Dm>('/api/groups', post({ userIds })),
  addGroupMembers: (groupId: string, userIds: string[]) => request<Dm>(`/api/groups/${groupId}/members`, post({ userIds })),
  renameGroup: (groupId: string, name: string) => request<Dm>(`/api/groups/${groupId}`, { method: 'PATCH', body: JSON.stringify({ name }) }),
  leaveGroup: (groupId: string) => request<{ ok: boolean }>(`/api/groups/${groupId}/members/me`, { method: 'DELETE' }),
  removeFriend: (userId: string) => request<Friend[]>(`/api/friends/${userId}`, { method: 'DELETE' }),
  block: (userId: string) => request<string[]>(`/api/blocks/${userId}`, { method: 'PUT' }),
  unblock: (userId: string) => request<string[]>(`/api/blocks/${userId}`, { method: 'DELETE' }),
  addFriend: (name: string) => request<Friend[]>('/api/friends', post({ name })),
  acceptFriend: (id: string) => request<Friend[]>(`/api/friends/${id}/accept`, post()),
  updateMe: (bio: string) => request<User>('/api/me', { method: 'PATCH', body: JSON.stringify({ bio }) }),
  status: (status: MyStatus, text = '', minutes?: number) => request<{ status: MyStatus; text: string; until: number | null }>('/api/me/status', { method: 'PATCH', body: JSON.stringify({ status, text, minutes }) }),
  createChannel: (name: string, kind: 'text' | 'voice') => request<Channel[]>('/api/channels', post({ name, kind })),
  invite: (target = getCredentials()) => request<MyInvite>('/api/invite', {}, target),
  logout: (target = getCredentials()) => request('/api/logout-all', post(), target),
  inbox: () => request<InboxItem[]>('/api/inbox'),
  markRead: (conversationId: string, at: number) => request<{ ok: boolean }>('/api/read', post({ conversationId, at })),
  voiceToken: (channelId: string) => request<{ token: string; url: string }>('/api/voice-token', post({ channelId })),
  // A server's first run, set up from the phone ("Your own server"): the code from the installer makes the admin, whose
  // session then names the server, gives it an icon and a recovery key before the app signs in with it.
  setupStatus: (server: string) => request<{ needed: boolean; serverName: string }>('/api/setup', {}, { server, token: '' }),
  setup: (server: string, code: string, serverName: string, name: string, password: string) => request<Session>('/api/setup', post({ code, serverName, name, password }), { server, token: '' }),
  renameServer: (name: string, target: Credentials) => request('/api/server', { method: 'PATCH', body: JSON.stringify({ name }) }, target),
  uploadServerIcon: async (uri: string, target: Credentials) => {
    const image = await (await fetch(uri)).blob();
    return request('/api/server/icon', { method: 'POST', body: image, headers: { 'Content-Type': image.type || 'image/jpeg' } }, target);
  },
  makeRecoveryKey: (password: string, target: Credentials) => request<{ key: string }>('/api/me/recovery-key', post({ password }), target),
};

// The backend issues a separate, media-scoped HttpOnly cookie on login/bootstrap.
// Native networking can forward it explicitly across expo-image and file downloads.
export function mediaSource(path: string) {
  const current = credentials;
  if (!current) return undefined;
  const url = new URL(path, current.server);
  if (url.origin !== current.server || !['https:', 'http:'].includes(url.protocol)) return undefined;
  if (mediaCookie?.server !== current.server || mediaCookie?.token !== current.token) return undefined;
  return { uri: url.href, headers: { Cookie: mediaCookie.value } };
}
