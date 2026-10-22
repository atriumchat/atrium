/**
 * "No server?": the VPS the apps walk a person through renting (BACKLOG, «Какой VPS взять»; checked on the host's site
 * 21.10: Russian cards and SBP, billed by the hour, a first top-up from $5), and reading the host's letter afterwards,
 * so the IP and the root password land in the fields without being looked for.
 */
export const RENT = {
  host: 'HostVDS',
  url: 'https://hostvds.com',
  os: 'Ubuntu 24.04',
} as const;

export type ServerLogin = { host: string; user: string; password: string };

const IP = /\b((?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3})\b/g;
// "Пароль: …", "Password - …", "root password: …"; the value runs to the next blank. Pasted into a one-line field the
// letter loses its line breaks, so labels are found inside one long line as well.
const PASSWORD = /(?:парол[ья]|password|pass(?:wd)?)\s*(?:от\s+root\s*|for\s+root\s*|root\s*)?[:=\-–—]\s*(\S+)/gi;
const USER = /(?:логин|пользователь|login|user(?:name)?)\s*[:=\-–—]\s*([a-z_][a-z0-9_-]*)/i;

/** A public IPv4: not the network's own, private, loopback or a mask. */
function publicIp(ip: string) {
  const [a = 0, b = 0] = ip.split('.').map(Number);
  if (a === 10 || a === 127 || a === 0 || a >= 224 || ip.startsWith('255.')) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  return true;
}

/**
 * The server's address and root login from a host's letter (or its panel's page), pasted whole. A letter often has
 * the panel's own password too; the one after the server's IP is taken, as letters list the server's details together.
 * Null when there's no public IP or no password in it.
 */
export function readServerLetter(text: string): ServerLogin | null {
  const ip = [...text.matchAll(IP)].find((m) => m[1] && publicIp(m[1]));
  if (!ip?.[1]) return null;
  const at = ip.index ?? 0;
  const passwords = [...text.matchAll(PASSWORD)].map((m) => ({ value: (m[1] ?? '').replace(/[.,;]+$/, ''), at: m.index ?? 0 }));
  const password = passwords.find((p) => p.at > at) ?? passwords[0];
  if (!password?.value) return null;
  return { host: ip[1], user: text.match(USER)?.[1] ?? 'root', password: password.value };
}
