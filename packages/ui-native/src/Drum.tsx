import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import Animated, { Easing, Extrapolation, interpolate, useAnimatedStyle, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';
import { color, drum, drumAt, type, type DrumItem, type DrumProps } from '@gomex/ui-common';
import { Check, Cross } from './icons';
import { Text } from './Text';

/**
 * A long job's steps on a drum (the installer's): the running one in the middle, the done ones fading above it, the
 * coming ones below. The motion's numbers are @gomex/ui-common's `drum`, the same as the web's.
 */

function Row({ i, at, item }: { i: number; at: SharedValue<number>; item: DrumItem }) {
  const style = useAnimatedStyle(() => {
    const away = Math.abs(i - at.value);
    return {
      opacity: interpolate(away, [...drum.away], [...drum.opacity], Extrapolation.CLAMP),
      transform: [{ scale: interpolate(away, [...drum.scaleAway], [...drum.scale], Extrapolation.CLAMP) }],
    };
  });
  return (
    // Shrinking from the left edge, the rows stay lined up under each other.
    <Animated.View style={[{ height: drum.row, flexDirection: 'row', alignItems: 'center', gap: 12, transformOrigin: 'left center' }, style]}>
      <Text numberOfLines={1} style={{ flex: 1, fontSize: type.drum.size, fontWeight: '500', letterSpacing: type.drum.tracking }}>{item.label}</Text>
      {item.state === 'run' ? <ActivityIndicator color={color.text.phone} /> : null}
      {item.state === 'done' ? <Check /> : null}
      {item.state === 'fail' ? <Cross /> : null}
    </Animated.View>
  );
}

export function Drum({ items, current, shown = 5 }: DrumProps) {
  const index = drumAt(items, current);
  const at = useSharedValue(index);
  useEffect(() => {
    at.value = withTiming(index, { duration: drum.turnMs, easing: Easing.out(Easing.cubic) });
  }, [index, at]);
  const strip = useAnimatedStyle(() => ({ transform: [{ translateY: (Math.floor(shown / 2) - at.value) * drum.row }] }));
  return (
    <View style={{ height: drum.row * shown, overflow: 'hidden' }}>
      <Animated.View style={strip}>
        {items.map((item, i) => (
          <Row key={item.id} i={i} at={at} item={item} />
        ))}
      </Animated.View>
    </View>
  );
}
