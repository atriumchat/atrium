import { localeOf, t } from './i18n';
import { useStore } from './store';
import type { User } from './protocol';

export const sameDay = (a: number, b: number) => new Date(a).toDateString() === new Date(b).toDateString();
export const timeOf = (ts: number) => new Date(ts).toLocaleTimeString(localeOf(), { hour: '2-digit', minute: '2-digit' });

/** A list's short stamp: "now", "12 min", "3 h" within the day, "yesterday", then "15.10" / "10/15". */
export function shortStamp(ts: number) {
  const now = Date.now();
  const minutes = Math.floor((now - ts) / 60_000);
  if (minutes < 1) return t('m.justNow');
  if (minutes < 60) return t('m.minutesAgo', { n: minutes });
  if (sameDay(ts, now)) return t('m.hoursAgo', { n: Math.floor(minutes / 60) });
  if (sameDay(ts, now - 86_400_000)) return t('format.yesterday');
  return new Date(ts).toLocaleDateString(localeOf(), { day: '2-digit', month: '2-digit' });
}
/** When a status ends: "until 14:30" today, "until 21 Oct, 14:30" later. */
export function statusUntil(until: number) {
  const d = new Date(until);
  const time = d.toLocaleTimeString(localeOf(), { hour: '2-digit', minute: '2-digit' });
  if (sameDay(until, Date.now())) return t('shell.status.until', { time });
  return t('shell.status.untilDate', { date: d.toLocaleDateString(localeOf(), { day: 'numeric', month: 'short' }), time });
}
export const dayDivider = (ts: number) => new Date(ts).toLocaleDateString(localeOf(), { day: 'numeric', month: 'long', year: 'numeric' });
export const dateOnly = (ts: number, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long' }) => new Date(ts).toLocaleDateString(localeOf(), opts);

const MENTION = /<@([0-9a-f]{32}|all)>/g;
const ROOM = /<#([0-9a-f]{32})>/g;
/** The room a message invites to, when the message is just the room. */
export const invitedRoom = (text: string): string | null => /^<#([0-9a-f]{32})>$/.exec(text.trim())?.[1] ?? null;
const roomName = (id: string) => useStore.getState().data?.channels.find((c) => c.id === id)?.name ?? t('common.md.deletedRoom');
export const mentionsToNames = (text: string, users: Record<string, User>) =>
  text.replace(MENTION, (_, id: string) => (id === 'all' ? `@${t('common.md.everyone')}` : `@${users[id]?.name ?? t('common.md.someone')}`));

/** One line of plain text for previews: names instead of ids, no formatting marks. */
export function plainText(text: string, users: Record<string, User>) {
  const room = invitedRoom(text);
  if (room) return t('common.md.roomInvite', { name: roomName(room) });
  return mentionsToNames(text, users)
    .replace(ROOM, (_, id: string) => roomName(id))
    .replace(/```[\w-]*\n?/g, '')
    .replace(/(\*\*|__|~~|\|\||`)/g, '')
    .replace(/^> /gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** One entry per person in a room (or a DM call). */
export function voiceMembers<T extends { channelId: string; userId: string }>(entries: T[], channelId: string): T[] {
  const seen = new Map<string, T>();
  for (const e of entries) if (e.channelId === channelId && !seen.has(e.userId)) seen.set(e.userId, e);
  return [...seen.values()];
}

export function fileSize(bytes = 0) {
  if (bytes < 1024) return t('chat.size.b', { n: bytes });
  if (bytes < 1024 * 1024) return t('chat.size.kb', { n: (bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0) });
  return t('chat.size.mb', { n: (bytes / 1024 / 1024).toFixed(1) });
}

/** "@Name" typed in the composer becomes <@id> on the wire; longest names first, so "@Ann Lee" wins over "@Ann". */
export function namesToMentions(text: string, users: Record<string, User>) {
  let out = text.replace(/@(все|everyone)(?![\p{L}\p{N}_])/giu, '<@all>');
  const list = Object.values(users).sort((a, b) => b.name.length - a.name.length);
  for (const u of list) {
    const escaped = u.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(`@${escaped}(?![\\p{L}\\p{N}_])`, 'gu'), `<@${u.id}>`);
  }
  return out;
}
