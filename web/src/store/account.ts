import type { Bootstrap, MyStatus, User } from '../types';
import { get, set } from './core';

/** You: who you're signed in as and your status. */
export type AccountSlice = {
  me: User | null;
  myStatus: MyStatus;
  myStatusText: string;
  /** When a timed "do not disturb" / "invisible" runs out (ms); null = until changed. */
  myStatusUntil: number | null;
  hasRecoveryKey: boolean;
  isAdmin: boolean;
};

export function accountSlice(): AccountSlice {
  return {
    me: null,
    myStatus: 'online',
    myStatusText: '',
    myStatusUntil: null,
    hasRecoveryKey: false,
    isAdmin: false,
  };
}

export function initStore(data: Bootstrap) {
  const firstText = data.channels.find((c) => c.kind === 'text');
  set({
    serverName: data.serverName,
    serverIcon: data.serverIcon ?? null,
    me: data.me,
    users: Object.fromEntries(data.users.map((u) => [u.id, u])),
    channels: data.channels,
    canManageChannels: data.canManageChannels,
    mutedChannels: data.mutedChannels,
    unread: data.unread ?? {},
    mentions: data.mentions ?? {},
    blocked: data.blocked ?? [],
    myStatus: data.myStatus ?? 'online',
    myStatusText: data.myStatusText ?? '',
    myStatusUntil: data.myStatusUntil ?? null,
    hasRecoveryKey: !!data.hasRecoveryKey,
    isAdmin: !!data.isAdmin,
    serverRelayOnly: !!data.relayOnly,
    selectedChannelId: get().selectedChannelId ?? firstText?.id ?? data.channels[0]?.id ?? null,
  });
}
