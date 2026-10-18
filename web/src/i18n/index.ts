import { useCallback, useSyncExternalStore } from 'react';
import { desktop } from '../desktop';
import { en } from './en';
import { ru } from './ru';

export type Lang = 'ru' | 'en';
export type Key = keyof typeof ru;
export type Params = Record<string, string | number>;
/** A plain string, or one string per plural category (picked by the `n` param through Intl.PluralRules). */
export type Entry = string | ({ other: string } & Partial<Record<Intl.LDMLPluralRule, string>>);

export const LANGS: { id: Lang; label: string }[] = [
  { id: 'ru', label: 'Русский' },
  { id: 'en', label: 'English' },
];

const dictionaries: Record<Lang, Record<Key, Entry>> = { ru, en };
const KEY = 'gomex_lang';

/** Russian for Russian systems, English for everything else. */
function detect(): Lang {
  const langs = typeof navigator === 'undefined' ? [] : (navigator.languages?.length ? navigator.languages : [navigator.language]);
  return langs[0]?.toLowerCase().startsWith('ru') ? 'ru' : 'en';
}

/** What the person picked on this device; null = follow the system. */
function load(): Lang | null {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'ru' || saved === 'en') return saved;
  } catch {
    // Storage unavailable: follow the system.
  }
  return null;
}

let choice: Lang | null = load();
let current: Lang = choice ?? detect();
const listeners = new Set<() => void>();
/** Bumped on every change, so a switch from "system" to the same language still re-renders the settings. */
let version = 0;
const getVersion = () => version;
if (typeof document !== 'undefined') document.documentElement.lang = current;

export const getLang = () => current;
export const getChoice = () => choice;

function apply(next: Lang | null) {
  choice = next;
  try {
    if (next) localStorage.setItem(KEY, next);
    else localStorage.removeItem(KEY);
  } catch {
    // Not remembered; still applied for this session.
  }
  current = next ?? detect();
  document.documentElement.lang = current;
  version++;
  listeners.forEach((l) => l());
}

/** The person's pick in the settings (null = as in the system): per device, applied at once, and told to the desktop app. */
export function setLang(next: Lang | null) {
  apply(next);
  desktop?.language?.set(next).catch(() => undefined);
}

// In the desktop app the choice is shared with its tray menu: the app's value wins on start, and its changes
// (the tray, or another window) arrive as a callback and as a DOM event. None of it exists in a browser.
const fromDesktop = (lang: unknown) => apply(lang === 'ru' || lang === 'en' ? lang : null);
desktop?.language?.get().then((lang) => lang && fromDesktop(lang), () => undefined);
desktop?.onLanguage?.(fromDesktop);
if (typeof window !== 'undefined') window.addEventListener('gomex-language', (e) => fromDesktop((e as CustomEvent).detail));

const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};

/** The BCP 47 tag for Intl formatters. */
export const localeOf = (lang: Lang = current) => (lang === 'ru' ? 'ru-RU' : 'en-US');

const plurals: Record<Lang, Intl.PluralRules> = { ru: new Intl.PluralRules('ru'), en: new Intl.PluralRules('en') };

/** Translate outside React (stores, socket handlers); components use useT() so they re-render on a language change. */
export function t(key: Key, params?: Params): string {
  return translate(current, key, params);
}

function translate(lang: Lang, key: Key, params?: Params): string {
  const entry = dictionaries[lang][key] ?? dictionaries.ru[key] ?? key;
  let text: string;
  if (typeof entry === 'string') text = entry;
  else {
    const n = Number(params?.n ?? 0);
    text = entry[plurals[lang].select(n)] ?? entry.other;
  }
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (m, name: string) => (name in params ? String(params[name]) : m));
}

export type TFn = typeof t;

/** Subscribes the component to the language and hands back a t bound to it. */
export function useT() {
  useSyncExternalStore(subscribe, getVersion);
  const lang = getLang();
  const bound = useCallback<TFn>((key, params) => translate(lang, key, params), [lang]);
  return { t: bound, lang, choice: getChoice(), setLang };
}

/** The server sends a stable `code` next to its Russian text; show our own translation when we know the code. */
export function errorText(code: string | undefined, fallback: string, params?: Params): string {
  const key = code ? (`err.${code}` as Key) : undefined;
  return key && key in ru ? t(key, params) : fallback;
}
