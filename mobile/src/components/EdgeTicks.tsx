import { useEffect, useMemo } from 'react';
import { StyleSheet, useWindowDimensions } from 'react-native';
import Animated, { Easing, useAnimatedProps, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import Svg, { Line } from 'react-native-svg';
import { color, cornerRadius, edgeTicks, filled, scale, tickState, useSweep, type Tick } from '@gomex/ui-common';

/**
 * A flow's progress along the edge of the phone's screen (DESIGN.md), the geometry from @gomex/ui-common: ticks that
 * follow its rounded corners, one scale for the whole way, not one per step. They fill clockwise from the right of the
 * camera island, the next one breathing; the screen inside stays free for the step.
 */

const AnimatedLine = Animated.createAnimatedComponent(Line);

function Breathing(tick: Tick) {
  const opacity = useSharedValue(1);
  useEffect(() => {
    opacity.value = withRepeat(withTiming(0.3, { duration: 800, easing: Easing.inOut(Easing.quad) }), -1, true);
  }, [opacity]);
  const props = useAnimatedProps(() => ({ opacity: opacity.value }));
  return <AnimatedLine {...tick} stroke={color.text.phone} strokeWidth={scale.stroke} strokeLinecap="round" animatedProps={props} />;
}

/** `island`: the phone has a camera island at the top, which the ticks leave out. */
export function EdgeTicks({ fill, island }: { fill: number; island: boolean }) {
  const { width, height } = useWindowDimensions();
  const all = useMemo(() => edgeTicks(width, height, cornerRadius(width, height), island ? scale.island : 0), [width, height, island]);
  const on = useSweep(filled(fill, all.length));
  return (
    <Svg width={width} height={height} style={StyleSheet.absoluteFill} pointerEvents="none">
      {all.map((tick, i) => {
        const state = tickState(i, on, all.length);
        return state === 'next' ? (
          <Breathing key={i} {...tick} />
        ) : (
          <Line key={i} {...tick} stroke={state === 'on' ? color.tickOn : color.tick} strokeWidth={scale.stroke} strokeLinecap="round" />
        );
      })}
    </Svg>
  );
}
