import type { Category, Channel, CustomEmoji, Sticker } from '../types';
import type { DesktopUpdate } from '../desktop';
import { get, set, type State } from './core';

export type MobileTab = 'home' | 'server' | 'you';

/** The friend picker: start a group, or add people to a DM/group. */
export type Picker = { mode: 'create' } | { mode: 'add'; dmId: string };
export type SwitchTarget = { kind: 'channel' | 'dm'; id: string };

let navigationRevision = 0;
export const getNavigationRevision = () => navigationRevision;

/** Where you are in the app: the server's channels, home or a DM, the phone's tabs, update banners. */
export type ShellSlice = {
  serverName: string;
  /** The server's icon, or null: Atrium's mark stands in. */
  serverIcon: string | null;
  giphyKey: string;
  klipyKey: string;
  stickers: Sticker[];
  customEmoji: CustomEmoji;
  channels: Channel[];
  /** Groups of channels; empty on a server without any (or one from before categories). */
  categories: Category[];
  selectedChannelId: string | null;
  /** A voice room's chat is shown beside the call; only then is it read. */
  voiceChatOpen: boolean;
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
  recentConversations: SwitchTarget[];

  /** Phone layout: which bottom tab is shown, and whether a conversation is open on top of it. */
  isMobile: boolean;
  mobileTab: MobileTab;
  mobileDetail: boolean;
  picker: Picker | null;
};

export function shellSlice(): ShellSlice {
  return {
    serverName: 'Atrium',
    serverIcon: null,
    giphyKey: '',
    klipyKey: '',
    stickers: [],
    customEmoji: {},
    channels: [],
    categories: [],
    selectedChannelId: null,
    voiceChatOpen: false,
    canManageChannels: false,
    mutedChannels: [],
    siteUpdate: false,
    desktopUpdate: null,
    mode: 'home',
    homeView: 'friends',
    recentConversations: [],
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
    // A channel deleted, or private and no longer yours to see: its counters go too, or they'd stay on the badge.
    const gone = new Set(s.channels.filter((c) => !ids.has(c.id)).map((c) => c.id));
    if (s.selectedChannelId && !ids.has(s.selectedChannelId)) gone.add(s.selectedChannelId);
    const keep = (counts: Record<string, number>) => Object.fromEntries(Object.entries(counts).filter(([id]) => !gone.has(id)));
    const unread = gone.size ? keep(s.unread) : s.unread;
    const mentions = gone.size ? keep(s.mentions) : s.mentions;
    if (s.selectedChannelId && ids.has(s.selectedChannelId)) return { channels, unread, mentions };
    return {
      channels,
      unread,
      mentions,
      selectedChannelId: channels.find((c) => c.kind === 'text')?.id ?? channels[0]?.id ?? null,
      // On a phone, step back to the channel list rather than drop into a channel nobody picked.
      mobileDetail: s.selectedChannelId && s.mode === 'server' ? false : s.mobileDetail,
    };
  });
}

/** Open a channel or room. On the phone it opens over the tab you're on, so back returns there. */
export function selectChannel(channelId: string) {
  navigationRevision++;
  set((s) => {
    // A voice room's chat waits for its panel: opening the room isn't reading it.
    const read = pageActive() && (!isVoiceRoom(s, channelId) || s.voiceChatOpen);
    return {
      mode: 'server',
      selectedChannelId: channelId,
      unread: read ? { ...s.unread, [channelId]: 0 } : s.unread,
      mobileDetail: true,
      recentConversations: rememberConversation(s, { kind: 'channel', id: channelId }),
    };
  });
}

const isVoiceRoom = (s: State, channelId: string | null) => s.channels.find((c) => c.id === channelId)?.kind === 'voice';

function rememberConversation(s: State, target: SwitchTarget) {
  const list = target.kind === 'channel' ? s.channels : s.dms;
  if (!list.some(({ id }) => id === target.id)) return s.recentConversations;
  return [
    target,
    ...s.recentConversations.filter(({ kind, id }) => kind !== target.kind || id !== target.id),
  ].slice(0, 20);
}

/** Show or hide the open voice room's chat beside the call. */
export function setVoiceChat(open: boolean) {
  set((s) => ({
    voiceChatOpen: open,
    unread: open && s.mode === 'server' && s.selectedChannelId && pageActive() ? { ...s.unread, [s.selectedChannelId]: 0 } : s.unread,
  }));
}

/** The conversation currently on screen (channel or DM id), used for unread counting. */
export function openConversationId(s: State = get()): string | null {
  if (s.isMobile && !s.mobileDetail) return null;
  if (s.mode === 'server') return isVoiceRoom(s, s.selectedChannelId) && !s.voiceChatOpen ? null : s.selectedChannelId;
  return isHomePage(s.homeView) ? null : s.homeView;
}

/** The person can actually see the page: it's visible and the window has focus. Only then is anything read. */
export function pageActive() {
  return !document.hidden && document.hasFocus();
}

/** The home view's own page, as opposed to an open DM. */
export const isHomePage = (view: string) => view === 'friends';

export function openHome() {
  navigationRevision++;
  const { homeView } = get();
  set((s) => ({
    mode: 'home',
    mobileTab: 'home',
    unread: !isHomePage(homeView) && pageActive() ? { ...s.unread, [homeView]: 0 } : s.unread,
    recentConversations: !s.isMobile && !isHomePage(homeView) ? rememberConversation(s, { kind: 'dm', id: homeView }) : s.recentConversations,
  }));
}


export function openServer() {
  navigationRevision++;
  set((s) => {
    const id = s.selectedChannelId;
    return {
      mode: 'server',
      mobileTab: 'server',
      unread: id && pageActive() && (!isVoiceRoom(s, id) || s.voiceChatOpen) ? { ...s.unread, [id]: 0 } : s.unread,
      recentConversations: !s.isMobile && id ? rememberConversation(s, { kind: 'channel', id }) : s.recentConversations,
    };
  });
}

export function openFriends() {
  navigationRevision++;
  set({ mode: 'home', homeView: 'friends', mobileTab: 'home', mobileDetail: true });
}

export function openDm(dmId: string) {
  navigationRevision++;
  set((s) => ({
    mode: 'home',
    homeView: dmId,
    unread: pageActive() ? { ...s.unread, [dmId]: 0 } : s.unread,
    mobileTab: 'home',
    mobileDetail: true,
    recentConversations: rememberConversation(s, { kind: 'dm', id: dmId }),
  }));
}

/** Phone: switch bottom tab (back to its list). */
export function openTab(tab: MobileTab) {
  navigationRevision++;
  set({ mobileTab: tab, mobileDetail: false, ...(tab === 'server' ? { mode: 'server' as const } : tab === 'home' ? { mode: 'home' as const } : {}) });
}

/** Phone: the back arrow on a conversation. */
export function closeDetail() {
  navigationRevision++;
  set({ mobileDetail: false });
}

export function openPicker(picker: Picker) {
  set({ picker });
}

export function closePicker() {
  set({ picker: null });
}
