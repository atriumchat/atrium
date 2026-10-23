export type User = {
  id: string;
  name: string;
  color: string;
  bio: string;
  avatarUrl: string | null;
  /** Who sent the invite this person signed up with. */
  invitedBy: string | null;
  createdAt: number;
  /** "dnd" shows a red "do not disturb" mark; invisible people look offline and appear as "online" here. */
  status?: 'online' | 'dnd';
  statusText?: string;
  /** Holds the server's admin flag. */
  admin?: true;
  /** The admin took them off the server until they let them back; their messages stay. */
  removed?: true;
};

export type MyStatus = 'online' | 'dnd' | 'invisible';

/**
 * What signing in returns. Sign-up, recovery with a key and a reset link also hand out a recovery key, shown once on
 * the screen before the app (the old one is spent or replaced), with the server's name for the file it can be saved to.
 */
export type Session = { token: string; user: User; recoveryKey?: string; serverName?: string };

/** Your personal invite link: its code, who signed up with it, and how many may (null = no limit). */
export type MyInvite = {
  code: string;
  invited: string[];
  limit: number | null;
};

/** A channel in the trash: when it was deleted (ms) and how many messages it still holds. */
export type DeletedChannel = Channel & { deletedAt: number; messages: number };
/** A server channel; `categoryId` is the category it's in (none: the plain text/voice sections; older servers send none). */
export type Channel = { id: string; name: string; kind: 'text' | 'voice'; position: number; categoryId?: string | null };

/** A group of channels in the list, as Discord's categories. */
export type Category = { id: string; name: string; position: number };

/** A Discord server template as the server read it: what moving it over would make (keys for leaving things out). */
export type DiscordChannel = { key: string; name: string; kind: 'text' | 'voice' };
export type DiscordPreview = { name: string; categories: { key: string; name: string; channels: DiscordChannel[] }[]; loose: DiscordChannel[]; roles: number };

/**
 * Something attached to a message: a picture (width/height are its stored size, to reserve space before it
 * loads) or, with kind "file", any other file offered as a download. Pictures may carry `previewUrl`, a small
 * WebP (≤960px) for the chat itself; older messages don't have one.
 */
export type Attachment = { url: string; previewUrl?: string; width: number; height: number; kind?: 'file'; name?: string; size?: number };

export type Reaction = { emoji: string; users: string[] };

/** What a reply points at: a short copy of the original, or just its id once it's been deleted. */
export type ReplyRef = { id: string; userId: string; content: string; attachments: number; deleted?: false } | { id: string; deleted: true };

/** A fresh upload, not yet sent; `id` goes into the message's attachments. */
export type Upload = Attachment & { id: string };

export type Message = {
  id: string;
  /** Text channel id, or DM id when `dm` is true. */
  channelId: string;
  userId: string;
  content: string;
  attachments: Attachment[];
  createdAt: number;
  dm?: boolean;
  editedAt?: number | null;
  reactions?: Reaction[];
  /** People mentioned as <@id> in the text, and whether it says <@all>. */
  mentions?: string[];
  mentionsAll?: boolean;
  replyTo?: ReplyRef | null;
};

export type VoiceEntry = {
  /** Voice room id, or DM/group id for a call. */
  channelId: string;
  userId: string;
  muted: boolean;
  deafened: boolean;
  video: boolean;
  screen: boolean;
  kind: 'channel' | 'dm';
};

export type Friend = { userId: string; status: 'friend' | 'incoming' | 'outgoing' };

/** A private conversation: two people ("dm") or a group of up to 10. */
export type Dm = {
  id: string;
  kind: 'dm' | 'group';
  /** Group name; empty means "list the members". */
  name: string;
  ownerId: string | null;
  members: string[];
  /** The other person, for kind "dm". */
  userId?: string;
  lastMessageAt: number;
  preview: { userId: string; text: string; images: number } | null;
};

/** A call going on in a DM or group. */
export type CallState = {
  dmId: string;
  participants: VoiceEntry[];
  /** People being rung right now. */
  ringing: string[];
  startedAt: number | null;
};

export type Bootstrap = {
  me: User;
  users: User[];
  channels: Channel[];
  /** Since categories came in; older servers send none. */
  categories?: Category[];
  livekitUrl: string;
  serverName: string;
  /** The server's own icon (/api/server/icon?v=…), or null for Atrium's mark. */
  serverIcon?: string | null;
  canManageChannels: boolean;
  mutedChannels: string[];
  /** Unread messages and unread mentions of you, per channel and DM, from the server's read marks. */
  unread: Record<string, number>;
  mentions: Record<string, number>;
  /** People you blocked. */
  blocked: string[];
  /** Only you see these: your real status (including invisible) and whether you've made a recovery key. */
  myStatus: MyStatus;
  myStatusText: string;
  /** When a timed status runs out (ms), or null. */
  myStatusUntil?: number | null;
  hasRecoveryKey: boolean;
  /** This account holds the admin flag (canManageChannels is also true while the server has no admin at all). */
  isAdmin: boolean;
  /** Every call goes only through the relay on 443 (RELAY_ONLY on the server). */
  relayOnly?: boolean;
};

/** A message in the inbox: it mentions you or answers you; unread if it's past your read mark there. */
export type InboxItem = Message & { unread: boolean };
