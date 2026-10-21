import { useEffect, type ReactNode } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, { Easing, cancelAnimation, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withTiming, type SharedValue } from 'react-native-reanimated';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';
import { colors } from '../theme';

/**
 * The call's light: a soft glow of `color` behind everyone, breathing slowly; it brightens while someone talks, so
 * the room looks alive even with your eyes half on it.
 */
export function CallGlow({ talking, color = colors.success }: { talking: boolean; color?: string }) {
  const { width, height } = useWindowDimensions();
  const breath = useSharedValue(0);
  const level = useSharedValue(0.4);
  useEffect(() => {
    breath.value = withRepeat(withTiming(1, { duration: 3200, easing: Easing.inOut(Easing.sin) }), -1, true);
    return () => cancelAnimation(breath);
  }, [breath]);
  useEffect(() => { level.value = withTiming(talking ? 1 : 0.4, { duration: talking ? 250 : 900 }); }, [talking, level]);
  const style = useAnimatedStyle(() => ({ opacity: level.value * (0.75 + breath.value * 0.25), transform: [{ scale: 1 + breath.value * 0.06 + (level.value - 0.4) * 0.08 }] }));
  const size = Math.max(width, height) * 1.1;
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }]}>
      <Animated.View style={[{ width: size, height: size }, style]}>
        <Svg width={size} height={size}>
          <Defs>
            <RadialGradient id="glow" cx="50%" cy="46%" r="50%">
              <Stop offset="0" stopColor={color} stopOpacity={0.32} />
              <Stop offset="0.45" stopColor={color} stopOpacity={0.1} />
              <Stop offset="1" stopColor={color} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Rect x={0} y={0} width={size} height={size} fill="url(#glow)" />
        </Svg>
      </Animated.View>
    </View>
  );
}

/** Rings spreading out from `children` while `active`: connecting, or a call ringing you. */
export function Ripples({ active, size, color = colors.success, children }: { active: boolean; size: number; color?: string; children: ReactNode }) {
  return (
    <View style={{ alignItems: 'center', justifyContent: 'center' }}>
      {active ? [0, 1, 2].map((i) => <Ring key={i} delay={i * 600} size={size} color={color} />) : null}
      {children}
    </View>
  );
}

function Ring({ delay, size, color }: { delay: number; size: number; color: string }) {
  const t: SharedValue<number> = useSharedValue(0);
  useEffect(() => {
    t.value = withDelay(delay, withRepeat(withTiming(1, { duration: 1800, easing: Easing.out(Easing.cubic) }), -1, false));
    return () => cancelAnimation(t);
  }, [delay, t]);
  const style = useAnimatedStyle(() => ({ opacity: 0.55 * (1 - t.value), transform: [{ scale: 0.8 + t.value * 0.9 }] }));
  return <Animated.View pointerEvents="none" style={[{ position: 'absolute', width: size, height: size, borderRadius: size / 2, borderWidth: 2, borderColor: color }, style]} />;
}
