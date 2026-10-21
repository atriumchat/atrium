import type { Message } from '../../web/src/types';
export type { Attachment, Bootstrap, CallState, Channel, Dm, Friend, InboxItem, Message, MyInvite, MyStatus, Session, Upload, User, VoiceEntry } from '../../web/src/types';

export function parseMediaCookie(header: string | null): string | null {
  const value = header?.match(/(?:^|,\s*)gx_media=([^;,\s]+)/)?.[1];
  return value && /^[A-Za-z0-9_.-]+$/.test(value) ? `gx_media=${value}` : null;
}

export function normalizeServer(raw: string): string {
  const url = new URL(raw.includes('://') ? raw.trim() : `https://${raw.trim()}`);
  const local = ['localhost', '127.0.0.1', '10.0.2.2', '[::1]'].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('server');
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) throw new Error('https');
  return url.origin;
}

export function mergeMessages(current: Message[], incoming: Message[], limit = 500): Message[] {
  const byId = new Map(current.map((m) => [m.id, m]));
  for (const m of incoming) byId.set(m.id, m);
  return [...byId.values()].sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id)).slice(0, limit);
}

export function historyPath(id: string, dm: boolean, oldest?: Message): string {
  const path = `/api/${dm ? 'dms' : 'channels'}/${encodeURIComponent(id)}/messages`;
  if (!oldest) return path;
  return `${path}?before=${oldest.createdAt}&beforeId=${encodeURIComponent(oldest.id)}`;
}
