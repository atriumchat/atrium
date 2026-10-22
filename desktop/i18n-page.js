// The language of one of the app's own pages. The main process puts it in the page's address (?lang=ru|en); opened as
// a plain page (a browser, for design work) #lang=en or the browser's own language decides. Fills what the HTML marks:
//   data-i18n="key"                      the element's text
//   data-i18n-attr="aria-label:key;..."  attributes
// and gives the page's scripts t(key, vars).
(function () {
  const { pick, setLang, t } = globalThis.atriumI18n;
  const asked = new URLSearchParams(location.search).get('lang') || location.hash.match(/lang=(\w+)/)?.[1];
  const lang = setLang(asked ?? pick(navigator.language));
  document.documentElement.lang = lang;
  for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of document.querySelectorAll('[data-i18n-attr]')) {
    for (const pair of el.dataset.i18nAttr.split(';')) {
      const [name, key] = pair.split(':');
      el.setAttribute(name, t(key));
    }
  }
  globalThis.t = t;
})();
