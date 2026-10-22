/**
 * Atrium's design tokens: the one place for colours, type, spacing and radii (DESIGN.md). The web turns them into CSS
 * variables (tokenCss, css.ts) for its own styles and the HeroUI theme to read; the phone app uses them as they are.
 * Change a value here and every client follows.
 *
 * The page and its text differ by screen: an OLED phone shows true black (the pixels go dark, the screen melts into
 * its frame); a monitor's backlight shows #000 as a grey with glow at the corners, and white on it halates over a long
 * read, so a wide window gets near-black and a softer white.
 */

export const color = {
  page: { phone: '#000000', wide: '#0c0c0e' },
  text: { phone: '#ffffff', wide: '#ededef' },
  muted: '#a1a1aa',
  faint: '#71717a',
  danger: '#ff453a',
  success: '#30d158',
  // Under white text (Join, Answer): the bright green is too light to read white on.
  successFill: '#248a3d',
  warning: '#ffd60a',

  // The few surfaces there are: popovers and menus, fields and grey buttons, their hover.
  surface: '#0b0b0d',
  overlay: '#18181b',
  graphite: '#1e1e22',
  hover: '#28282d',
  tertiary: '#27272a',
  separator: '#1c1c20',
  edge: '#1f1f24',
  border: 'rgba(255,255,255,0.1)',

  // The flow look: hairlines between rows, a field's line at rest, the ticks.
  hairline: 'rgba(255,255,255,0.12)',
  fieldLine: 'rgba(255,255,255,0.32)',
  placeholder: 'rgba(255,255,255,0.3)',
  outline: 'rgba(255,255,255,0.3)',
  // A radio's or a tick box's ring when off.
  control: 'rgba(255,255,255,0.4)',
  tick: 'rgba(255,255,255,0.13)',
  tickOn: '#f2f2f4',

  // The one main button: a white pill with dark text.
  button: '#f2f2f4',
  buttonHover: '#ffffff',
  buttonInk: '#0c0c0e',

  // The install's game: the city far off, the dirt under the ground line, the line itself.
  gameCity: 'rgba(255,255,255,0.12)',
  gameDirt: 'rgba(255,255,255,0.3)',
  gameGround: 'rgba(255,255,255,0.5)',

  // Rooms on the home screen: green is where you are, pink is somewhere to go.
  here: '#93e06b',
  hereInk: '#0b2a00',
  others: '#e4a0ea',
  othersInk: '#1a0a1c',
} as const;

/** Onest throughout: the variable font on the web, its weight files on a phone (@atrium/ui-native picks them). */
export const font = {
  web: '"Onest Variable", "Onest", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
} as const;

/** Sizes and line heights in points (px on the web); tracking in points. */
export const type = {
  stage: { size: 15, line: 20 },
  title: { size: 34, line: 40, tracking: -0.8 },
  sub: { size: 17, line: 23 },
  field: { size: 22, line: 28 },
  choice: { size: 20, line: 26 },
  big: { size: 64, line: 64, tracking: -3 },
  key: { size: 24, line: 32, tracking: 1 },
  kept: { size: 18, line: 24 },
  drum: { size: 19, line: 24, tracking: -0.2 },
  label: { size: 14, line: 18 },
  note: { size: 15, line: 20 },
  button: { size: 17, line: 22 },
} as const;

export const space = {
  inBlock: 8,
  between: 32,
  // Between a step's parts (the heading, the content, the buttons) in a wide window, more than between two fields so
  // the parts read apart; a phone keeps `between`, its screens mustn't scroll.
  section: 48,
  // A flow's side margin is the screen's corner radius less the button's (concentric), never under this.
  edgeMin: 32,
  // How far in from the screen's edge the edge ticks reach.
  ring: 14,
  // The column of a flow in a wide window.
  column: 480,
} as const;

export const radius = {
  button: 24,
  field: 12,
  popover: 24,
  panel: 36,
} as const;

/** Wider than this is a wide window: near-black page, the ticks as a ruler. */
export const wideFrom = 821;
