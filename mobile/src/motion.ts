import { Easing, FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated';

/**
 * The app's motion, kept quiet on purpose, the way iOS's own apps move: things fade in and out quickly and slide into
 * a new place smoothly. No springs, no bounce, nothing that flies.
 */
export const appear = FadeIn.duration(180);
export const vanish = FadeOut.duration(140);
export const move = LinearTransition.duration(220).easing(Easing.out(Easing.cubic));
/** How a press sinks and comes back. */
export const PRESS_IN = { duration: 90, easing: Easing.out(Easing.quad) };
export const PRESS_OUT = { duration: 160, easing: Easing.out(Easing.quad) };
