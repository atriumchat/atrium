/** Reset links look like https://app.example.com/?reset=TOKEN; an admin makes one for a person who lost their password. */
export const resetLink = (token: string) => `${window.location.origin}/?reset=${encodeURIComponent(token)}`;

/** The token from the address bar, if the page was opened from a reset link. */
export function resetFromUrl(): string | null {
  return new URLSearchParams(window.location.search).get('reset');
}

/** Drop ?reset= from the address bar once the link is used (or turned out dead). */
export function clearResetFromUrl() {
  if (resetFromUrl() !== null) window.history.replaceState(null, '', window.location.pathname);
}
