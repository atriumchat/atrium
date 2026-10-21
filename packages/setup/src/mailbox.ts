/** The big mail services by their domains, so "Open the letter" goes straight to the person's inbox. */
const MAILBOXES = [
  { id: 'gmail', domains: /^(gmail|googlemail)\.com$/, url: 'https://mail.google.com/' },
  { id: 'yandex', domains: /^(yandex\.(ru|com|by|kz)|ya\.ru)$/, url: 'https://mail.yandex.ru/' },
  { id: 'mailru', domains: /^(mail|bk|list|inbox|internet)\.ru$/, url: 'https://e.mail.ru/' },
  { id: 'outlook', domains: /^(outlook|hotmail|live)\.com$/, url: 'https://outlook.live.com/mail/' },
  { id: 'icloud', domains: /^(icloud|me|mac)\.com$/, url: 'https://www.icloud.com/mail' },
  { id: 'proton', domains: /^(proton\.me|protonmail\.com)$/, url: 'https://mail.proton.me/' },
] as const;

export type Mailbox = { id: (typeof MAILBOXES)[number]['id']; url: string };

/** The inbox for an address, or null for a service not on the list. */
export function mailboxOf(email: string): Mailbox | null {
  const domain = email.trim().toLowerCase().split('@')[1] ?? '';
  const box = MAILBOXES.find((m) => m.domains.test(domain));
  return box ? { id: box.id, url: box.url } : null;
}
