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
const i18n = (globalThis as unknown as { gomexI18n: I18n }).gomexI18n;

const asked = new URLSearchParams(location.search).get('lang') ?? location.hash.match(/lang=(\w+)/)?.[1];
export const lang = i18n.setLang(asked ?? i18n.pick(navigator.language));
document.documentElement.lang = lang;

export const t = i18n.t;
