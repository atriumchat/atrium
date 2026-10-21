import { color, radius, space, type } from '@gomex/ui-common';

/**
 * The app's colours, from the design tokens shared with the web (@gomex/ui-common, DESIGN.md). `window` is the
 * near-black of the main screens, `page` the true black of the flows (sign-in, "Your own server") on an OLED screen.
 */
export const colors = {
  window: color.page.wide,
  page: color.page.phone,
  black: color.page.phone,
  surface: color.surface,
  graphite: color.graphite,
  hover: color.hover,
  tertiary: color.tertiary,
  overlay: color.overlay,
  separator: color.separator,
  edge: color.edge,
  border: color.border,
  text: color.text.phone,
  muted: color.muted,
  faint: color.faint,
  success: color.success,
  successFill: color.successFill,
  danger: color.danger,
  warning: color.warning,
  here: color.here,
  hereInk: color.hereInk,
  others: color.others,
  othersInk: color.othersInk,
} as const;

export { color, radius, space, type };

export const fonts = { 400: 'Onest_400Regular', 500: 'Onest_500Medium', 600: 'Onest_600SemiBold', 700: 'Onest_700Bold' } as const;
