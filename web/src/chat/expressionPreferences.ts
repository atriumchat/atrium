import { useSyncExternalStore } from 'react';

const volatile = new Map<string, string>();
const change = 'atrium:expression-preferences';
function subscribe(listener: () => void) {
  window.addEventListener(change, listener);
  window.addEventListener('storage', listener);
  return () => { window.removeEventListener(change, listener); window.removeEventListener('storage', listener); };
}

export function usePersonalItems(kind: 'favorite-gifs' | 'recent-stickers' | 'recent-emoji', user: string | undefined): [string[], (ids: string[]) => void] {
  const key = `atrium:${kind}:${user ?? ''}`;
  const serialized = useSyncExternalStore(subscribe, () => {
    if (!user) return '[]';
    try { return localStorage.getItem(key) ?? '[]'; }
    catch { return volatile.get(key) ?? '[]'; }
  });
  let items: string[] = [];
  try {
    const data: unknown = JSON.parse(serialized);
    if (Array.isArray(data)) items = data.filter((item): item is string => typeof item === 'string');
  } catch { /* An old or invalid preference is treated as empty. */ }
  return [items, (ids) => {
    if (!user) return;
    const next = JSON.stringify(ids);
    try { localStorage.setItem(key, next); }
    catch { volatile.set(key, next); }
    window.dispatchEvent(new Event(change));
  }];
}
