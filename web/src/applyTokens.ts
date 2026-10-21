import { color, radius, space, type, wideFrom } from './tokens';

/**
 * The design tokens (tokens.ts) as CSS variables on :root, `--gx-…`, for the web's own styles and the HeroUI theme
 * (theme.css, index.css) to read. Set once at start-up, before the first paint. The page and its text switch at
 * `wideFrom`: true black and white on a phone, near-black and a softer white on a monitor.
 */
export function applyTokens() {
  const vars: Record<string, string | number> = {
    'page-phone': color.page.phone,
    'page-wide': color.page.wide,
    'text-phone': color.text.phone,
    'text-wide': color.text.wide,
    muted: color.muted,
    faint: color.faint,
    danger: color.danger,
    success: color.success,
    warning: color.warning,
    surface: color.surface,
    overlay: color.overlay,
    graphite: color.graphite,
    hover: color.hover,
    tertiary: color.tertiary,
    separator: color.separator,
    edge: color.edge,
    border: color.border,
    hairline: color.hairline,
    'field-line': color.fieldLine,
    placeholder: color.placeholder,
    outline: color.outline,
    control: color.control,
    tick: color.tick,
    'tick-on': color.tickOn,
    button: color.button,
    'button-hover': color.buttonHover,
    'button-ink': color.buttonInk,
    here: color.here,
    'here-ink': color.hereInk,
    others: color.others,
    'others-ink': color.othersInk,
    'title-size': `${type.title.size}px`,
    'title-line': `${type.title.line}px`,
    'title-tracking': `${type.title.tracking}px`,
    'sub-size': `${type.sub.size}px`,
    'sub-line': `${type.sub.line}px`,
    'field-size': `${type.field.size}px`,
    'choice-size': `${type.choice.size}px`,
    'choice-line': `${type.choice.line}px`,
    'label-size': `${type.label.size}px`,
    'note-size': `${type.note.size}px`,
    'stage-size': `${type.stage.size}px`,
    'stage-line': `${type.stage.line}px`,
    'key-size': `${type.key.size}px`,
    'key-line': `${type.key.line}px`,
    'button-size': `${type.button.size}px`,
    'in-block': `${space.inBlock}px`,
    between: `${space.between}px`,
    column: `${space.column}px`,
    'radius-button': `${radius.button}px`,
    'radius-field': `${radius.field}px`,
    'radius-popover': `${radius.popover}px`,
  };
  const lines = Object.entries(vars).map(([name, value]) => `  --gx-${name}: ${value};`);
  const css = [
    ':root {',
    ...lines,
    '  --gx-page: var(--gx-page-phone);',
    '  --gx-text: var(--gx-text-phone);',
    '}',
    `@media (min-width: ${wideFrom}px) {`,
    '  :root {',
    '    --gx-page: var(--gx-page-wide);',
    '    --gx-text: var(--gx-text-wide);',
    '  }',
    '}',
  ].join('\n');
  const style = document.createElement('style');
  style.id = 'gx-tokens';
  style.textContent = css;
  document.head.prepend(style);
}
