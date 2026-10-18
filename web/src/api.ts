import type { Bootstrap, Channel, DeletedChannel, Dm, Friend, InboxItem, Message, MyInvite, MyStatus, Session, Upload, User } from './types';

type ServerInfo = { serverName: string; serverIcon: string | null };

const TOKEN_KEY = 'hangout_token';

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Storage unavailable (private mode): the session just won't survive a reload.
  }
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });
  if (!res.ok) {
    let detail = `Ошибка ${res.status}`;
    try {
      const body = await res.json();
      if (typeof body.detail === 'string') detail = body.detail;
      else if (Array.isArray(body.detail)) detail = 'Некоторые поля слишком короткие или длинные';
    } catch {
      // Non-JSON error body, keep the generic message.
    }
    throw new ApiError(res.status, detail);
  }
  return res.json() as Promise<T>;
}

const post = (body?: unknown): RequestInit => ({ method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });

export const api = {
  register: (invite: string, name: string, password: string) => request<Session>('/api/register', post({ invite, name, password })),
  login: (name: string, password: string) => request<Session>('/api/login', post({ name, password })),
  updateMe: (bio: string) => request<User>('/api/me', { method: 'PATCH', body: JSON.stringify({ bio }) }),
  uploadAvatar: (file: File) =>
    request<User>('/api/me/avatar', { method: 'POST', body: file, headers: { 'Content-Type': file.type || 'application/octet-stream' } }),
  deleteAvatar: () => request<User>('/api/me/avatar', { method: 'DELETE' }),
  /** Pictures come back resized; any other file is kept as is and offered as a download. */
  upload: (file: File) =>
    request<Upload>(`/api/uploads?name=${encodeURIComponent(file.name)}`, {
      method: 'POST',
      body: file,
      headers: { 'Content-Type': file.type || 'application/octet-stream' },
    }),
  friends: () => request<Friend[]>('/api/friends'),
  addFriend: (name: string) => request<Friend[]>('/api/friends', post({ name })),
  acceptFriend: (userId: string) => request<Friend[]>(`/api/friends/${userId}/accept`, post()),
  removeFriend: (userId: string) => request<Friend[]>(`/api/friends/${userId}`, { method: 'DELETE' }),
  logout: () => request<{ ok: boolean }>('/api/logout', post()),
  /** Ends every token of this account, on all devices (tokens can't be revoked one by one). */
  logoutAll: () => request<{ ok: boolean }>('/api/logout-all', post()),
  myInvite: () => request<MyInvite>('/api/invite'),
  resetInvite: () => request<MyInvite>('/api/invite/reset', post()),
  checkInvite: (code: string) => request<{ inviter: string; left: number | null }>(`/api/invite/check/${encodeURIComponent(code)}`),
  dms: () => request<Dm[]>('/api/dms'),
  openDm: (userId: string) => request<Dm>('/api/dms', post({ userId })),
  createGroup: (userIds: string[]) => request<Dm>('/api/groups', post({ userIds })),
  addGroupMembers: (groupId: string, userIds: string[]) => request<Dm>(`/api/groups/${groupId}/members`, post({ userIds })),
  renameGroup: (groupId: string, name: string) => request<Dm>(`/api/groups/${groupId}`, { method: 'PATCH', body: JSON.stringify({ name }) }),
  leaveGroup: (groupId: string) => request<{ ok: boolean }>(`/api/groups/${groupId}/members/me`, { method: 'DELETE' }),
  dmMessages: (dmId: string, before?: number) =>
    request<Message[]>(`/api/dms/${dmId}/messages${before ? `?before=${before}` : ''}`),
  bootstrap: () => request<Bootstrap>('/api/bootstrap'),
  messages: (channelId: string, before?: number) =>
    request<Message[]>(`/api/channels/${channelId}/messages${before ? `?before=${before}` : ''}`),
  createChannel: (name: string, kind: Channel['kind']) => request<Channel[]>('/api/channels', post({ name, kind })),
  renameChannel: (id: string, name: string) =>
    request<Channel[]>(`/api/channels/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) }),
  reorderChannels: (ids: string[]) => request<Channel[]>('/api/channels/order', { method: 'PUT', body: JSON.stringify({ ids }) }),
  muteChannel: (id: string, muted: boolean) =>
    request<string[]>(`/api/channels/${id}/mute`, { method: 'PUT', body: JSON.stringify({ muted }) }),
  deletedChannels: () => request<DeletedChannel[]>('/api/channels/deleted'),
  restoreChannel: (id: string) => request<Channel[]>(`/api/channels/${id}/restore`, { method: 'POST' }),
  deleteChannel: (id: string) => request<Channel[]>(`/api/channels/${id}`, { method: 'DELETE' }),
  setStatus: (status: MyStatus, text: string, minutes?: number) =>
    request<{ status: MyStatus; text: string; until: number | null }>('/api/me/status', {
      method: 'PATCH',
      body: JSON.stringify({ status, text, minutes }),
    }),
  changeName: (name: string, password: string) => request<User>('/api/me/name', { method: 'PATCH', body: JSON.stringify({ name, password }) }),
  changePassword: (current: string, next: string) => request<{ token: string }>('/api/me/password', post({ current, new: next })),
  makeRecoveryKey: (password: string) => request<{ key: string }>('/api/me/recovery-key', post({ password })),
  recover: (name: string, key: string, password: string) => request<Session>('/api/recover', post({ name, key, password })),
  /** Admin only: a one-time token for a new password for this person. A newer one replaces it. */
  makeResetLink: (userId: string) => request<{ token: string; expiresAt: number }>(`/api/users/${userId}/reset-link`, post()),
  checkReset: (token: string) => request<{ name: string }>('/api/reset/check', post({ token })),
  reset: (token: string, password: string) => request<Session>('/api/reset', post({ token, password })),
  block: (userId: string) => request<string[]>(`/api/blocks/${userId}`, { method: 'PUT' }),
  unblock: (userId: string) => request<string[]>(`/api/blocks/${userId}`, { method: 'DELETE' }),
  setupStatus: () => request<{ needed: boolean; serverName: string; serverIcon: string | null }>('/api/setup'),
  setupCheck: (code: string) => request<{ ok: boolean }>('/api/setup/check', post({ code })),
  setup: (code: string, serverName: string, name: string, password: string) =>
    request<{ token: string; user: User }>('/api/setup', post({ code, serverName, name, password })),
  /** The server's icon and name, for its admin: raw image bytes, as for avatars. */
  uploadServerIcon: (image: Blob) =>
    request<ServerInfo>('/api/server/icon', { method: 'POST', body: image, headers: { 'Content-Type': image.type || 'application/octet-stream' } }),
  deleteServerIcon: () => request<ServerInfo>('/api/server/icon', { method: 'DELETE' }),
  renameServer: (name: string) => request<ServerInfo>('/api/server', { method: 'PATCH', body: JSON.stringify({ name }) }),
  checkToken: () => request<{ token: string; url: string }>('/api/check-token', post()),
  markRead: (conversationId: string, at: number) => request<{ ok: boolean }>('/api/read', post({ conversationId, at })),
  inbox: (before?: number) => request<InboxItem[]>(`/api/inbox${before ? `?before=${before}` : ''}`),
  callQuality: (report: Record<string, unknown>) => request<{ ok: boolean }>('/api/call-quality', post(report)),
  voiceToken: (channelId: string) => request<{ token: string; url: string }>('/api/voice-token', post({ channelId })),
};
