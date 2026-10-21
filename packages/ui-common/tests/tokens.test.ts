import assert from 'node:assert/strict';
import { test } from 'node:test';
import { color, tokenCss, wideFrom } from '../src/index';

test('tokenCss is the CSS the web and the desktop pages load', (t) => {
  t.assert.snapshot(tokenCss());
});

test('every colour token becomes a variable', () => {
  const css = tokenCss();
  const flat = Object.values(color).flatMap((v) => (typeof v === 'string' ? [v] : Object.values(v)));
  for (const value of flat) assert.ok(css.includes(`: ${value};`), value);
});

test('the page and its text switch to the wide ones at wideFrom', () => {
  const css = tokenCss();
  assert.match(css, new RegExp(`@media \\(min-width: ${wideFrom}px\\)[^]*--gx-page: var\\(--gx-page-wide\\)`));
  assert.match(css, /:root \{[^}]*--gx-page: var\(--gx-page-phone\)/);
});
