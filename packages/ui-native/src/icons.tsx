import Svg, { Path } from 'react-native-svg';
import { color } from '@atrium/ui-common';

/** The few icons the parts draw: 24-unit strokes, as in the app's own icon set. */

function Icon({ size = 24, width = 2, stroke = color.text.phone, d }: { size?: number; width?: number; stroke?: string; d: string }) {
  return (
    <Svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke={stroke} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round">
      <Path d={d} />
    </Svg>
  );
}

export const ChevronLeft = () => <Icon d="m15 18-6-6 6-6" />;
export const Check = () => <Icon size={18} width={2.5} d="M20 6 9 17l-5-5" />;
export const Cross = () => <Icon size={18} width={2.5} stroke={color.danger} d="M18 6 6 18M6 6l12 12" />;
