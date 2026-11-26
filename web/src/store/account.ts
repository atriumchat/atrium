import type { Bootstrap, MyStatus, Permission, Role, User } from '../types';
import { get, resetStore, set, useStore } from './core';

/** You: who you're signed in as and your status. */
export type AccountSlice = {
  me: User | null;
  myStatus: MyStatus;
  myStatusText: string;
  /** When a timed "do not disturb" / "invisible" runs out (ms); null = until changed. */
  myStatusUntil: number | null;
  hasRecoveryKey: boolean;
  isAdmin: boolean;
  isGuest: boolean;
  /** The server's roles, highest first, and what you may do through yours (everything, for the admin). */
  roles: Role[];
  permissions: Permission[];
};

export function accountSlice(): AccountSlice {
  return {
    me: null,
    myStatus: 'online',
    myStatusText: '',
    myStatusUntil: null,
    hasRecoveryKey: false,
    isAdmin: false,
    isGuest: false,
    roles: [],
    permissions: [],
  };
}

/** The colour of someone's nick: that of their highest role that has one; none keeps the usual white. */
export function nameColor(user: User | undefined, roles: Role[]): string | undefined {
  if (!user?.roles?.length) return undefined;
  for (const id of user.roles) {
    const color = roles.find((r) => r.id === id)?.color;
    if (color) return color;
  }
  return undefined;
}

export function useNameColor(userId: string | undefined): string | undefined {
  return useStore((s) => nameColor(userId ? s.users[userId] : undefined, s.roles));
}

export function useCan(permission: Permission): boolean {
  return useStore((s) => s.permissions.includes(permission));
}

export function initStore(data: Bootstrap) {
  const fresh = get().me?.id !== data.me.id;
  if (fresh) resetStore();
  // A demo's guest starts on the server, in its first channel, not on an empty Chats page.
  if (fresh && data.isGuest) set({ mode: 'server', mobileTab: 'server' });
  const firstText = data.channels.find((c) => c.kind === 'text');
  set({
    serverName: data.serverName,
    serverIcon: data.serverIcon ?? null,
    giphyKey: data.giphyKey ?? '',
    klipyKey: data.klipyKey ?? '',
    stickers: data.stickers ?? [],
    customEmoji: data.customEmoji ?? {},
    me: data.me,
    users: Object.fromEntries(data.users.map((u) => [u.id, u])),
    channels: data.channels,
    categories: data.categories ?? [],
    canManageChannels: data.canManageChannels,
    mutedChannels: data.mutedChannels,
    firstUnread: data.firstUnread ?? {},
    manualUnread: data.manualUnread ?? {},
    unread: data.unread ?? {},
    mentions: data.mentions ?? {},
    blocked: data.blocked ?? [],
    myStatus: data.myStatus ?? 'online',
    myStatusText: data.myStatusText ?? '',
    myStatusUntil: data.myStatusUntil ?? null,
    hasRecoveryKey: !!data.hasRecoveryKey,
    isAdmin: !!data.isAdmin,
    isGuest: !!data.isGuest,
    roles: data.roles ?? [],
    // A server from before roles: its admin may do everything there is.
    permissions: data.permissions ?? (data.isAdmin ? ['manageChannels', 'manageRoles', 'removeMembers', 'manageMessages', 'seeAllChannels'] : []),
    serverRelayOnly: !!data.relayOnly,
    selectedChannelId: data.channels.some((c) => c.id === get().selectedChannelId) ? get().selectedChannelId : firstText?.id ?? data.channels[0]?.id ?? null,
  });
}
