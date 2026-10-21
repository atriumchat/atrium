import { View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { ART, type ArtName, type Drawing } from '../art.generated';
import { Text } from '../text';
import { colors } from '../theme';

/** One drawing from the web's illustrations, in `color`; `plate` is the colour of the surface under it. */
export function LineArt({ art, scale = 1.6, plate = colors.window, color = colors.text }: { art: ArtName; scale?: number; plate?: string; color?: string }) {
  const { marks, box }: Drawing = ART[art];
  return (
    <Svg viewBox={box.join(' ')} width={Math.round(box[2] * scale)} height={Math.round(box[3] * scale)} fill="none" stroke={color} strokeWidth={0.9} strokeLinejoin="round" strokeLinecap="round">
      {marks.map((m, i) => (
        <Path
          key={i}
          d={m.d}
          fill={m.ink ? color : m.plate ? plate : undefined}
          fillRule={m.even ? 'evenodd' : undefined}
          stroke={m.ink ? 'none' : undefined}
          opacity={m.o}
          strokeDasharray={m.dash}
          strokeWidth={m.w}
        />
      ))}
    </Svg>
  );
}

/** An empty place: its drawing, a short title and one quiet line. */
export function EmptyState({ art, title, text, compact, plate, fill }: { art: ArtName; title: string; text?: string; compact?: boolean; plate?: string; fill?: boolean }) {
  return (
    <View style={{ flex: fill ? 1 : undefined, alignItems: 'center', justifyContent: 'center', paddingHorizontal: compact ? 16 : 24, paddingTop: compact ? 32 : 32, paddingBottom: compact ? 32 : 64 }}>
      <LineArt art={art} scale={compact ? 1.1 : 1.6} plate={plate} />
      <Text style={{ marginTop: compact ? 16 : 24, fontSize: compact ? 16 : 18, fontWeight: '500', textAlign: 'center' }}>{title}</Text>
      {text ? <Text style={{ marginTop: 4, maxWidth: 320, fontSize: compact ? 14 : 15, color: colors.muted, textAlign: 'center', lineHeight: compact ? 18 : 20 }}>{text}</Text> : null}
    </View>
  );
}
