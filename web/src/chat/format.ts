import { getLang, localeOf, t } from '../i18n';

export const sameDay = (a: number, b: number) => new Date(a).toDateString() === new Date(b).toDateString();

export const timeOf = (ts: number) => new Date(ts).toLocaleTimeString(localeOf(), { hour: '2-digit', minute: '2-digit' });

/** A list's short stamp: "21:02" today, "yesterday", then "15.10" / "10/15". */
export function shortStamp(ts: number) {
  const now = Date.now();
  if (sameDay(ts, now)) return timeOf(ts);
  if (sameDay(ts, now - 86_400_000)) return t('format.yesterday');
  return new Date(ts).toLocaleDateString(localeOf(), { day: '2-digit', month: '2-digit' });
}

/** A conversation list's stamp: "now", "12m", "3h" within the day, then as shortStamp. Fresh ones need a re-render a minute (useMinute). */
export function relativeStamp(ts: number) {
  const minutes = Math.floor((Date.now() - ts) / 60_000);
  if (minutes < 1) return t('shell.time.now');
  if (minutes < 60) return t('shell.time.minutes', { n: minutes });
  if (sameDay(ts, Date.now())) return t('shell.time.hours', { n: Math.floor(minutes / 60) });
  return shortStamp(ts);
}


/** Day divider label: "15 October 2026" / "October 15, 2026". */
export const dayDivider = (ts: number) =>
  new Date(ts).toLocaleDateString(localeOf(), { day: 'numeric', month: 'long', year: 'numeric' });

/** Full date and time for a tooltip. */
export const fullStamp = (ts: number) => new Date(ts).toLocaleString(localeOf());

/** Date only, e.g. "15 October" / "October 15"; the year is added on request. */
export const dateOnly = (ts: number, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long' }) =>
  new Date(ts).toLocaleDateString(localeOf(getLang()), opts);
