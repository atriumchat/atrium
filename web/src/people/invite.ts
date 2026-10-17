/** Invite links look like https://app.example.com/?invite=CODE. */
export const inviteLink = (code: string) => `${window.location.origin}/?invite=${encodeURIComponent(code)}`;

/** The 8-character code as people read it: 7K2Q-9ABC. */
export const prettyCode = (code: string) => (code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code);

/** The invite code from the address bar, if the page was opened from an invite link. */
export function inviteFromUrl(): string | null {
  return new URLSearchParams(window.location.search).get('invite');
}

/** Drop ?invite= from the address bar once it's been used (or isn't needed). */
export function clearInviteFromUrl() {
  if (inviteFromUrl() !== null) window.history.replaceState(null, '', window.location.pathname);
}

/** Accept either a pasted link or a bare code. */
export function parseInvite(text: string): string {
  const value = text.trim();
  try {
    return new URL(value).searchParams.get('invite') ?? value;
  } catch {
    return value;
  }
}
