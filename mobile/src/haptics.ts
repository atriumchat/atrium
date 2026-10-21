import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';

const run = (p: Promise<void>) => void p.catch(() => undefined);
const impact = (style: Haptics.ImpactFeedbackStyle) => () => run(Haptics.impactAsync(style));

/**
 * Every buzz the app makes, by what it means rather than how strong it is, so the same kind of moment always feels
 * the same:
 * - `tap`: a button press. `select`: a choice between options (tabs, toggles, pickers, a tick in a list).
 * - `soft`: something comes up (a sheet, a menu). `firm`: a long press took. `rigid`: the mic goes off — a click.
 * - `heavy`: hanging up. `success` / `warning` / `error`: how an action ended.
 * - `knock`: someone came into your call; `ring`: one beat of an incoming call (see useRing).
 */
export const haptic = {
  tap: impact(Haptics.ImpactFeedbackStyle.Light),
  select: () => run(Haptics.selectionAsync()),
  soft: impact(Haptics.ImpactFeedbackStyle.Soft),
  firm: impact(Haptics.ImpactFeedbackStyle.Medium),
  rigid: impact(Haptics.ImpactFeedbackStyle.Rigid),
  heavy: impact(Haptics.ImpactFeedbackStyle.Heavy),
  success: () => run(Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)),
  warning: () => run(Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)),
  error: () => run(Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)),
  /** Two soft taps close together: a door knock. */
  knock: () => { haptic.soft(); setTimeout(haptic.soft, 110); },
  /** A phone's ring as a feel: heavy-light-heavy, like a bell's strike and its echo. */
  ring: () => {
    haptic.heavy();
    setTimeout(haptic.tap, 120);
    setTimeout(haptic.heavy, 240);
  },
};

/** Rings (`haptic.ring`) every 1.6 s while `active`: an incoming call you can feel in your hand. */
export function startRinging() {
  if (Platform.OS === 'web') return () => undefined;
  haptic.ring();
  const timer = setInterval(haptic.ring, 1600);
  return () => clearInterval(timer);
}
