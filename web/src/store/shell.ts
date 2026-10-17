import type { Channel } from '../types';
import type { DesktopUpdate } from '../desktop';
import { get, set, type State } from './core';

export type MobileTab = 'home' | 'server' | 'you';

/** The friend picker: start a group, or add people to a DM/group. */
export type Picker = { mode: 'create' } | { mode: 'add'; dmId: string };

/** Where you are in the app: the server's channels, home or a DM, the phone's tabs, update banners. */
export type ShellSlice = {
  serverName: string;
  /** The server's icon, or null: Gomex's mark stands in. */
  serverIcon: string | null;
  channels: Channel[];
  selectedChannelId: string | null;
  canManageChannels: boolean;
  /** Channels this person muted: no counter, nothing on the app badge. */
  mutedChannels: string[];
  /** A newer build of the site is out than the one running in this tab / window (updates.ts). */
  siteUpdate: boolean;
  /** The desktop app's own update, when running in it (desktop/updater.js). */
  desktopUpdate: DesktopUpdate | null;

  /** "home" = friends and direct messages, "server" = channels. */
  mode: 'home' | 'server';
  /** What the home view shows: the friends page (with who's where beside it) or a DM id. */
  homeView: 'friends' | string;

  /** Phone layout: which bottom tab is shown, and whether a conversation is open on top of it. */
  isMobile: boolean;
  mobileTab: MobileTab;
  mobileDetail: boolean;
  picker: Picker | null;
};

export function shellSlice(): ShellSlice {
  return {
    serverName: 'Gomex',
    serverIcon: null,
    channels: [],
    selectedChannelId: null,
    canManageChannels: false,
    mutedChannels: [],
    siteUpdate: false,
    desktopUpdate: null,
    mode: 'home',
    homeView: 'friends',
    isMobile: false,
    mobileTab: 'home',
    mobileDetail: false,
    picker: null,
  };
}

/** A new channel list from the server. If the open channel was deleted, fall back to the first text one. */
export function setChannels(channels: Channel[]) {
  const ids = new Set(channels.map((c) => c.id));
  set((s) => {
    if (!s.selectedChannelId || ids.has(s.selectedChannelId)) return { channels };
    const { [s.selectedChannelId]: _gone, ...unread } = s.unread;
    return {
      channels,
      unread,
      selectedChannelId: channels.find((c) => c.kind === 'text')?.id ?? channels[0]?.id ?? null,
      // On a phone, step back to the channel list rather than drop into a channel nobody picked.
      mobileDetail: s.mode === 'server' ? false : s.mobileDetail,
    };
  });
}

/** Open a channel or room. On the phone it opens over the tab you're on, so back returns there. */
export function selectChannel(channelId: string) {
  set((s) => ({
    mode: 'server',
    selectedChannelId: channelId,
    unread: { ...s.unread, [channelId]: 0 },
    mobileDetail: true,
  }));
}

/** The conversation currently on screen (channel or DM id), used for unread counting. */
export function openConversationId(s: State = get()): string | null {
  if (s.isMobile && !s.mobileDetail) return null;
  if (s.mode === 'server') return s.selectedChannelId;
  return isHomePage(s.homeView) ? null : s.homeView;
}

/** The person can actually see the page: it's visible and the window has focus. Only then is anything read. */
export function pageActive() {
  return !document.hidden && document.hasFocus();
}

/** The home view's own page, as opposed to an open DM. */
export const isHomePage = (view: string) => view === 'friends';

export function openHome() {
  const { homeView } = get();
  set((s) => ({ mode: 'home', mobileTab: 'home', unread: isHomePage(homeView) ? s.unread : { ...s.unread, [homeView]: 0 } }));
}


export function openServer() {
  set({ mode: 'server', mobileTab: 'server' });
}

export function openFriends() {
  set({ mode: 'home', homeView: 'friends', mobileTab: 'home', mobileDetail: true });
}

export function openDm(dmId: string) {
  set((s) => ({ mode: 'home', homeView: dmId, unread: { ...s.unread, [dmId]: 0 }, mobileTab: 'home', mobileDetail: true }));
}

/** Phone: switch bottom tab (back to its list). */
export function openTab(tab: MobileTab) {
  set({ mobileTab: tab, mobileDetail: false, ...(tab === 'server' ? { mode: 'server' as const } : tab === 'home' ? { mode: 'home' as const } : {}) });
}

/** Phone: the back arrow on a conversation. */
export function closeDetail() {
  set({ mobileDetail: false });
}

export function openPicker(picker: Picker) {
  set({ picker });
}

export function closePicker() {
  set({ picker: null });
}
