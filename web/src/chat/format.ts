/** Russian plural: plural(2, ['участник', 'участника', 'участников']) -> 'участника'. */
export function plural(n: number, forms: [string, string, string]) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1];
  return forms[2];
}

export const sameDay = (a: number, b: number) => new Date(a).toDateString() === new Date(b).toDateString();

export const timeOf = (ts: number) => new Date(ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

/** A list's short stamp: "21:02" today, "вчера", then "15.10". */
export function shortStamp(ts: number) {
  const now = Date.now();
  if (sameDay(ts, now)) return timeOf(ts);
  if (sameDay(ts, now - 86_400_000)) return 'вчера';
  return new Date(ts).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
}

/** Discord-style message header stamp: "Сегодня, в 15:28" / "Вчера, в 15:28" / "15.10.2026 15:28". */
export function messageStamp(ts: number) {
  const now = Date.now();
  if (sameDay(ts, now)) return `Сегодня, в ${timeOf(ts)}`;
  if (sameDay(ts, now - 86_400_000)) return `Вчера, в ${timeOf(ts)}`;
  return `${new Date(ts).toLocaleDateString('ru-RU')} ${timeOf(ts)}`;
}

/** Day divider label: "15 октября 2026 г." */
export const dayDivider = (ts: number) =>
  new Date(ts).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
