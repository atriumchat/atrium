import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Pressable, type GestureResponderEvent, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withTiming } from 'react-native-reanimated';
import { PRESS_IN, PRESS_OUT } from '../motion';
import { haptic } from '../haptics';
import { Text } from '../text';
import { colors } from '../theme';

/** A plain button press, felt. */
export const tap = haptic.tap;

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

type PressStyle = StyleProp<ViewStyle> | ((state: { pressed: boolean }) => StyleProp<ViewStyle>);

/** Pressable that sinks a little under the finger (`scaleTo`) and eases back: every button of the app. */
export function Press({ style, scaleTo = 0.97, onPressIn, onPressOut, ...props }: Omit<PressableProps, 'style'> & { style?: PressStyle; scaleTo?: number }) {
  const scale = useSharedValue(1);
  const [pressed, setPressed] = useState(false);
  const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return (
    <AnimatedPressable
      {...props}
      onPressIn={(e: GestureResponderEvent) => { setPressed(true); scale.value = withTiming(scaleTo, PRESS_IN); onPressIn?.(e); }}
      onPressOut={(e: GestureResponderEvent) => { setPressed(false); scale.value = withTiming(1, PRESS_OUT); onPressOut?.(e); }}
      style={[typeof style === 'function' ? style({ pressed }) : style, animated]}
    />
  );
}

/** Red for what's yours (DMs, mentions); `quiet` is grey, for plain chatter in a channel. Nudges when the number grows. */
export function Badge({ count, label, quiet = false }: { count: number; label?: string; quiet?: boolean }) {
  const scale = useSharedValue(1);
  const last = useRef(count);
  useEffect(() => {
    if (count > last.current) scale.value = withSequence(withTiming(1.12, { duration: 110 }), withTiming(1, { duration: 160 }));
    last.current = count;
  }, [count, scale]);
  const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return (
    <Animated.View style={[{ minWidth: 20, height: 20, paddingHorizontal: 6, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: quiet ? colors.graphite : colors.danger }, animated]}>
      <Text style={{ fontSize: 12, fontWeight: '500', color: quiet ? colors.muted : '#fff', lineHeight: 20 }}>{label ?? (count > 99 ? '99+' : count)}</Text>
    </Animated.View>
  );
}

const SIZES = { sm: 36, md: 40, lg: 48, xl: 56 } as const;
/**
 * Round icon button. tone: "plain" = grey fill, "ghost" = no fill, "on" = white fill (toggled), "accent", "danger".
 * `alert` paints the icon red (muted mic). `silent`: the action makes its own haptic (the mic, hanging up).
 */
export function RoundButton({ label, onPress, children, tone = 'plain', size = 'md', disabled, style, silent = false }: {
  label: string; onPress: () => void; children: (color: string) => ReactNode; tone?: 'plain' | 'ghost' | 'on' | 'accent' | 'danger' | 'alert'; size?: keyof typeof SIZES; disabled?: boolean; style?: StyleProp<ViewStyle>; silent?: boolean;
}) {
  const bg = tone === 'plain' || tone === 'alert' ? colors.tertiary : tone === 'on' || tone === 'accent' ? '#fff' : tone === 'danger' ? colors.danger : 'transparent';
  const fg = tone === 'on' || tone === 'accent' ? '#0b0b0c' : tone === 'alert' ? colors.danger : '#fff';
  const d = SIZES[size];
  return (
    <Press
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      hitSlop={size === 'sm' ? 4 : 0}
      scaleTo={0.92}
      onPress={() => { if (!silent) tap(); onPress(); }}
      style={({ pressed }) => [{ width: d, height: d, borderRadius: d / 2, alignItems: 'center', justifyContent: 'center', backgroundColor: bg, opacity: disabled ? 0.4 : tone === 'ghost' && pressed ? 0.6 : 1 }, style]}
    >
      {children(fg)}
    </Press>
  );
}

