import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import Animated, { Easing, interpolate, Extrapolation, useAnimatedStyle, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';
import { useT, type Key } from '../i18n';
import { Text } from '../text';
import { colors } from '../theme';
import { CheckIcon, XIcon } from '../icons';
import type { StepState } from './setup';

/**
 * The installer's steps on a drum, as in the desktop's "Your own server" (desktop/onboarding.js TASKS): the running
 * one in the middle, the done ones fading above it, the coming ones below.
 */

export const TASKS = ['check', 'address', 'docker', 'firewall', 'ssh', 'files', 'config', 'backups', 'pull', 'up', 'https'] as const;
const ROW = 46;

function Row({ i, at, label, state }: { i: number; at: SharedValue<number>; label: string; state?: StepState }) {
  const style = useAnimatedStyle(() => {
    const d = i - at.value;
    const away = Math.abs(d);
    return {
      opacity: interpolate(away, [0, 1, 2, 2.6], [1, 0.5, 0.2, 0], Extrapolation.CLAMP),
      transform: [{ scale: interpolate(away, [0, 2], [1, 0.9], Extrapolation.CLAMP) }],
    };
  });
  return (
    // Shrinking from the left edge, the rows stay lined up under each other.
    <Animated.View style={[{ height: ROW, flexDirection: 'row', alignItems: 'center', gap: 12, transformOrigin: 'left center' }, style]}>
      <Text numberOfLines={1} style={{ flex: 1, fontSize: 19, fontWeight: '500', letterSpacing: -0.2 }}>{label}</Text>
      {state?.state === 'run' ? <ActivityIndicator color="#fff" /> : null}
      {state?.state === 'done' ? <CheckIcon size={18} color="#fff" strokeWidth={2.5} /> : null}
      {state?.state === 'fail' ? <XIcon size={18} color={colors.danger} strokeWidth={2.5} /> : null}
    </Animated.View>
  );
}

/** `shown`: how many rows are in sight (odd, the running one in the middle). */
export function Drum({ steps, current, shown = 5 }: { steps: Record<string, StepState>; current: string | null; shown?: number }) {
  const { t } = useT();
  // The running step, else the last one done (or the first, before anything has run).
  const doneUpTo = TASKS.reduce((last, id, i) => (steps[id]?.state === 'done' ? i : last), -1);
  const index = current && TASKS.includes(current as (typeof TASKS)[number]) && steps[current]?.state !== 'done' ? TASKS.indexOf(current as (typeof TASKS)[number]) : Math.min(doneUpTo + 1, TASKS.length - 1);
  const at = useSharedValue(index);
  useEffect(() => {
    at.value = withTiming(index, { duration: 520, easing: Easing.out(Easing.cubic) });
  }, [index, at]);
  const strip = useAnimatedStyle(() => ({ transform: [{ translateY: (Math.floor(shown / 2) - at.value) * ROW }] }));
  return (
    <View style={{ height: ROW * shown, overflow: 'hidden' }}>
      <Animated.View style={strip}>
        {TASKS.map((id, i) => (
          <Row key={id} i={i} at={at} label={t(`own.task.${id}` as Key)} state={steps[id]} />
        ))}
      </Animated.View>
    </View>
  );
}
