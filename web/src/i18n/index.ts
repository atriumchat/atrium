import { useCallback, useSyncExternalStore } from 'react';
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

function load(): Lang {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'ru' || saved === 'en') return saved;
  } catch {
    // Storage unavailable: fall back to the system language.
  }
  return detect();
}

let current: Lang = load();
const listeners = new Set<() => void>();
if (typeof document !== 'undefined') document.documentElement.lang = current;

export const getLang = () => current;

/** Per device; applied at once, no reload. */
export function setLang(lang: Lang) {
  if (lang === current) return;
  current = lang;
  try {
    localStorage.setItem(KEY, lang);
  } catch {
    // Not remembered; still applied for this session.
  }
  document.documentElement.lang = lang;
  listeners.forEach((l) => l());
}

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
  const lang = useSyncExternalStore(subscribe, getLang);
  const bound = useCallback<TFn>((key, params) => translate(lang, key, params), [lang]);
  return { t: bound, lang, setLang };
}

/** The server sends a stable `code` next to its Russian text; show our own translation when we know the code. */
export function errorText(code: string | undefined, fallback: string, params?: Params): string {
  const key = code ? (`err.${code}` as Key) : undefined;
  return key && key in ru ? t(key, params) : fallback;
}
