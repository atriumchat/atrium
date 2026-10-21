// Tokens from web/src/theme.css and index.css (dark theme).
export const colors = {
  window: '#0c0c0e',
  black: '#000000',
  surface: '#0b0b0d',
  graphite: '#1e1e22',
  hover: '#28282d',
  tertiary: '#27272a',
  overlay: '#18181b',
  separator: '#1c1c20',
  edge: '#1f1f24',
  border: 'rgba(255,255,255,0.1)',
  text: '#ffffff',
  muted: '#a1a1aa',
  faint: '#71717a',
  success: '#30d158',
  // Under white text (Join, Answer): the bright green is too light to read white on.
  successFill: '#248a3d',
  danger: '#ff453a',
  warning: '#ffd60a',
  here: '#93e06b',
  hereInk: '#0b2a00',
  others: '#e4a0ea',
  othersInk: '#1a0a1c',
} as const;

export const fonts = { 400: 'Onest_400Regular', 500: 'Onest_500Medium', 600: 'Onest_600SemiBold', 700: 'Onest_700Bold' } as const;
