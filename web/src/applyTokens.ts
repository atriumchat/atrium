import { tokenCss } from '@atrium/ui-common';

/**
 * The design tokens (@atrium/ui-common) as CSS variables on :root, `--gx-…`, for the web's own styles and the HeroUI theme
 * (theme.css, index.css) to read. Set once at start-up, before the first paint.
 */
export function applyTokens() {
  const style = document.createElement('style');
  style.id = 'gx-tokens';
  style.textContent = tokenCss();
  document.head.prepend(style);
}
