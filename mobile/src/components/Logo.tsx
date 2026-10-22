import { type Ref } from 'react';
import { View } from 'react-native';
import { Image } from 'expo-image';
import Svg, { Path } from 'react-native-svg';
import { MARK_PATH, MARK_STROKE, MARK_VIEWBOX } from '../../../web/src/ui/logoPaths';
import { mediaSource } from '../api';
import { colors } from '../theme';

/**
 * The Atrium mark, an arch (same paths as the web), as an outline like the line icons round it. `filled`: the active
 * tab's version, solid.
 */
export function AtriumMark({ size = 24, color = colors.text, filled = false, ref }: { size?: number; color?: string; filled?: boolean; ref?: Ref<Svg> }) {
  return (
    <Svg ref={ref} width={size} height={size} viewBox={MARK_VIEWBOX}>
      {filled
        ? <Path d={MARK_PATH} fill={color} />
        : <Path d={MARK_PATH} fill="none" stroke={color} strokeWidth={MARK_STROKE} strokeLinejoin="round" />}
    </Svg>
  );
}

/** The server's own icon, a circle, where it has one; Atrium's mark where it doesn't. */
export function ServerMark({ icon, size = 24, color, filled = false }: { icon?: string | null; size?: number; color?: string; filled?: boolean }) {
  const source = icon ? mediaSource(icon) : undefined;
  if (!source) return <AtriumMark size={size} color={color} filled={filled} />;
  return <View style={{ width: size, height: size, borderRadius: size / 2, overflow: 'hidden' }}><Image source={source} style={{ width: size, height: size }} cachePolicy="memory-disk" contentFit="cover" /></View>;
}
