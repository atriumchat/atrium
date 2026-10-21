import { useId, type Ref } from 'react';
import { View } from 'react-native';
import { Image } from 'expo-image';
import Svg, { Circle, Defs, Mask, Path } from 'react-native-svg';
import { G_PATH, RING, TM_PATH } from '../../../web/src/ui/logoPaths';
import { mediaSource } from '../api';
import { colors } from '../theme';

/**
 * The Gomex mark: a "G" in a ring, with ™ (same paths as the web). Below 28px the ™ would be a speck, so it is left
 * out. `filled`: the active tab's version — a solid disc with the G cut out of it.
 */
export function GomexMark({ size = 24, color = colors.text, filled = false, ref }: { size?: number; color?: string; filled?: boolean; ref?: Ref<Svg> }) {
  const mask = `g${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const r = RING.r + RING.width / 2;
  if (filled) {
    return (
      <Svg ref={ref} width={size} height={size} viewBox="0 0 164 164">
        <Defs>
          <Mask id={mask}>
            <Circle cx={RING.cx} cy={RING.cy} r={r} fill="white" />
            <Path d={G_PATH} fill="black" />
          </Mask>
        </Defs>
        <Circle cx={RING.cx} cy={RING.cy} r={r} fill={color} mask={`url(#${mask})`} />
      </Svg>
    );
  }
  return (
    <Svg ref={ref} width={size} height={size} viewBox="0 0 164 164">
      <Circle cx={RING.cx} cy={RING.cy} r={RING.r} fill="none" stroke={color} strokeWidth={RING.width} />
      <Path d={G_PATH} fill={color} />
      {size >= 28 && <Path d={TM_PATH} fill={color} />}
    </Svg>
  );
}

/** The server's own icon, a circle, where it has one; Gomex's mark where it doesn't. */
export function ServerMark({ icon, size = 24, color, filled = false }: { icon?: string | null; size?: number; color?: string; filled?: boolean }) {
  const source = icon ? mediaSource(icon) : undefined;
  if (!source) return <GomexMark size={size} color={color} filled={filled} />;
  return <View style={{ width: size, height: size, borderRadius: size / 2, overflow: 'hidden' }}><Image source={source} style={{ width: size, height: size }} cachePolicy="memory-disk" contentFit="cover" /></View>;
}
