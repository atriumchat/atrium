import '../../i18n.js';

/**
 * The desktop app's words (desktop/i18n.js, shared with the main process) for a window here. The main process puts
 * the language in the page's address (?lang=ru|en); opened in a browser for design work, #lang= or the browser's own.
 */
type I18n = {
  pick: (locale: string) => 'ru' | 'en';
  setLang: (lang: string) => 'ru' | 'en';
  t: (key: string, vars?: Record<string, string | number>) => string;
};
const i18n = (globalThis as unknown as { atriumI18n: I18n }).atriumI18n;

const asked = new URLSearchParams(location.search).get('lang') ?? location.hash.match(/lang=(\w+)/)?.[1];
export const lang = i18n.setLang(asked ?? i18n.pick(navigator.language));
document.documentElement.lang = lang;

/** Switches the words in place (`t` reads the current language), for a window that keeps its state across a switch. */
export function switchLang(next: 'ru' | 'en') {
  document.documentElement.lang = i18n.setLang(next);
}

export const t = i18n.t;
