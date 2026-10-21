import * as Haptics from 'expo-haptics';

/** A choice's light tap, as the app's own (mobile/src/haptics.ts `select`/`tap`); silent where there's no engine. */
export function tap() {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
}
