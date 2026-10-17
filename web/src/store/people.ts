import { api } from '../api';
import type { Dm, Friend, User } from '../types';
import { get, set, showError } from './core';
import { isHomePage, openDm } from './shell';

/** Everyone else: users, friends, DMs and groups, who's online. */
export type PeopleSlice = {
  users: Record<string, User>;
  friends: Friend[];
  dms: Dm[];
  blocked: string[];
  /** Bumped when someone signs up with your invite link, so an open invite window refreshes. */
  inviteVersion: number;
  online: string[];
};

export function peopleSlice(): PeopleSlice {
  return {
    users: {},
    friends: [],
    dms: [],
    blocked: [],
    inviteVersion: 0,
    online: [],
  };
}

/** Open (creating if needed) the DM with a user and switch to it. */
export async function messageUser(userId: string) {
  try {
    const dm = await api.openDm(userId);
    set((s) => ({ dms: [dm, ...s.dms.filter((d) => d.id !== dm.id)] }));
    openDm(dm.id);
  } catch (e) {
    showError(e instanceof Error ? e.message : 'Не удалось открыть переписку');
  }
}

export function addDm(dm: Dm) {
  set((s) => ({ dms: [dm, ...s.dms.filter((d) => d.id !== dm.id)].sort((a, b) => b.lastMessageAt - a.lastMessageAt) }));
}

export async function refreshFriends() {
  try {
    set({ friends: await api.friends() });
  } catch {
    // Keep the old list; the next change event retries.
  }
}

export async function refreshDms() {
  try {
    const dms = await api.dms();
    const ids = new Set(dms.map((d) => d.id));
    set((s) => ({
      dms,
      // Left a group (or it was deleted): forget its call, and close it if it was open.
      calls: Object.fromEntries(Object.entries(s.calls).filter(([id]) => ids.has(id))),
      ...(!isHomePage(s.homeView) && !ids.has(s.homeView) ? { homeView: 'friends', mobileDetail: s.mode === 'home' ? false : s.mobileDetail } : {}),
    }));
  } catch {
    // Keep the old list; the next message retries.
  }
}

export function addUser(user: User) {
  set((s) => ({ users: { ...s.users, [user.id]: user } }));
}

/** How a DM or group is called in lists and headers: the person, the group name, or its members. */
export function dmTitle(dm: Dm, users: Record<string, User>, meId: string | undefined): string {
  if (dm.kind === 'dm') return users[dm.userId ?? '']?.name ?? '…';
  if (dm.name) return dm.name;
  const others = dm.members.filter((id) => id !== meId).map((id) => users[id]?.name ?? '…');
  return others.length ? others.join(', ') : 'Пустая группа';
}

export const isDmId = (id: string | null) => !!id && get().dms.some((d) => d.id === id);
