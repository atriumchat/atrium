import { useState, type ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, TextInput, useWindowDimensions, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { useT } from '../i18n';
import { Text } from '../text';
import { colors } from '../theme';
import { haptic } from '../haptics';
import { ChevronLeftIcon } from '../icons';
import { cornerRadius, EdgeTicks } from './EdgeTicks';

/**
 * The flow look (DESIGN.md): a screen at a time in type alone on OLED black, one scale of ticks along the screen's edge
 * for the whole way, the main button white at the bottom with back as an outlined icon beside it. Made for "Your own
 * server" (app/own.tsx); sign-in, invites and settings are to move onto it.
 */

/** How far in from the screen's edge the ticks reach (EdgeTicks: 4 in, 10 long). */
export const RING = 14;

/**
 * Where a flow's content sits. Concentric with the screen's corners (Apple's rule): the buttons' 24 radius stands the
 * screen's radius less 24 from its edges, at the bottom and the sides alike; never closer to the ticks than their width
 * and a clear gap. In a browser (design work only) the screen is an iPhone 17 Pro's, island and all.
 */
export function useFlowFrame() {
  const phone = Platform.OS === 'web';
  const real = useSafeAreaInsets();
  const insets = phone ? { top: 62, bottom: 34 } : real;
  const { width, height } = useWindowDimensions();
  const radius = cornerRadius(width, height);
  const edge = Math.max(RING + 18, radius - 24);
  return { phone, insets, radius, edge, top: Math.max(insets.top + 8, RING + 22), bottom: Math.max(edge, insets.bottom + 8) };
}

/**
 * The page under a flow: black, the part it's in (`label`, "Адрес (2/5)") over the step, the ticks drawn last so
 * nothing covers them. `bottom` is laid along the screen's bottom edge to edge, kept inside the ticks (InsideEdge).
 */
export function FlowShell({ fill, label, bottom, children }: { fill: number; label?: string; bottom?: ReactNode; children: ReactNode }) {
  const frame = useFlowFrame();
  return (
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: '#000' }}>
      <View style={{ flex: 1, paddingTop: frame.top, paddingBottom: frame.bottom }}>
        {label ? <Text style={{ paddingHorizontal: frame.edge, paddingTop: 8, fontSize: 15, lineHeight: 20, color: colors.muted }}>{label}</Text> : null}
        <View style={{ flex: 1, paddingTop: 4, paddingHorizontal: frame.edge }}>{children}</View>
        {bottom ? (
          <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0 }}>
            <InsideEdge radius={frame.radius}>{bottom}</InsideEdge>
          </View>
        ) : null}
      </View>
      <EdgeTicks fill={fill} island={frame.insets.top >= 59} />
      {frame.phone ? <View style={{ position: 'absolute', top: 11, alignSelf: 'center', width: 126, height: 37, borderRadius: 19, backgroundColor: '#000', zIndex: 10 }} /> : null}
    </KeyboardAvoidingView>
  );
}

/**
 * Something kept inside the ticks: cut along the screen's rounded bottom a ring's width in, dimming into black towards
 * the ticks at the sides and the bottom. Open at the top, so whatever jumps there isn't cut.
 */
function InsideEdge({ radius, children }: { radius: number; children: ReactNode }) {
  const inner = Math.max(0, radius - RING);
  const fade = 36;
  return (
    <View style={{ marginHorizontal: RING, marginBottom: RING, paddingTop: 80, overflow: 'hidden', borderBottomLeftRadius: inner, borderBottomRightRadius: inner }}>
      <View style={{ marginHorizontal: -RING }}>{children}</View>
      <Svg pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }} width="100%" height="100%">
        <Defs>
          <LinearGradient id="fromLeft" x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor="#000" stopOpacity="1" />
            <Stop offset="1" stopColor="#000" stopOpacity="0" />
          </LinearGradient>
          <LinearGradient id="fromRight" x1="1" y1="0" x2="0" y2="0">
            <Stop offset="0" stopColor="#000" stopOpacity="1" />
            <Stop offset="1" stopColor="#000" stopOpacity="0" />
          </LinearGradient>
          <LinearGradient id="fromBottom" x1="0" y1="1" x2="0" y2="0">
            <Stop offset="0" stopColor="#000" stopOpacity="1" />
            <Stop offset="1" stopColor="#000" stopOpacity="0" />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width={fade} height="100%" fill="url(#fromLeft)" />
        <Rect x="100%" y="0" width={fade} height="100%" fill="url(#fromRight)" transform={`translate(${-fade} 0)`} />
        <Rect x="0" y="100%" width="100%" height={fade} fill="url(#fromBottom)" transform={`translate(0 ${-fade})`} />
      </Svg>
    </View>
  );
}

/**
 * A step with nothing behind it: the title and its line in type alone, the fields under them, and at the bottom,
 * within a thumb's reach, back as an outlined round icon 2 points from the main button. `note` and `error` stand over
 * the buttons (a field's own error goes under the field, LineField); `below` under them, for a TextAction.
 */
export function FlowStep({ title, sub, error, note, noteHidden, actions, below, onBack, children }: {
  title: string;
  sub: string;
  error?: string | null;
  note?: string;
  noteHidden?: boolean;
  actions?: ReactNode;
  below?: ReactNode;
  onBack?: () => void;
  children?: ReactNode;
}) {
  const { t } = useT();
  return (
    <View style={{ flex: 1 }}>
      <Text style={{ fontSize: 34, lineHeight: 40, letterSpacing: -0.8 }}>{title}</Text>
      {sub ? <Text style={{ marginTop: 8, fontSize: 17, lineHeight: 23, color: colors.muted }}>{sub}</Text> : null}
      {children ? <View style={{ gap: 32, marginTop: 32 }}>{children}</View> : null}
      <View style={{ flex: 1, minHeight: 12 }} />
      <View style={{ gap: 14 }}>
        {error ? <Text style={{ fontSize: 15, color: colors.danger }}>{error}</Text> : null}
        {note ? <Text style={{ fontSize: 15, color: colors.muted, opacity: noteHidden ? 0 : 1 }}>{note}</Text> : null}
        {actions || onBack ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
            {onBack ? (
              <Pressable accessibilityRole="button" accessibilityLabel={t('setup.back')} onPress={onBack} hitSlop={12} style={({ pressed }) => ({ width: 48, height: 48, borderRadius: 24, borderWidth: 1, borderColor: pressed ? '#fff' : 'rgba(255,255,255,0.3)', alignItems: 'center', justifyContent: 'center' })}>
                <ChevronLeftIcon size={24} color="#fff" />
              </Pressable>
            ) : null}
            <View style={{ flex: 1 }}>{actions}</View>
          </View>
        ) : null}
        {below}
      </View>
    </View>
  );
}

/**
 * A field as a line: its name small above, the text big on a hairline that turns white while typing, what's wrong in
 * red right under it. Always give it a placeholder: an empty line alone doesn't say it takes text.
 */
export function LineField({ label, suffix, bad = false, error, style, ...input }: Omit<React.ComponentProps<typeof TextInput>, 'style'> & {
  label: string;
  suffix?: string;
  bad?: boolean;
  error?: string | false;
  style?: StyleProp<ViewStyle>;
}) {
  const [focused, setFocused] = useState(false);
  const wrong = bad || !!error;
  return (
    <View style={style}>
      <Text style={{ fontSize: 14, color: colors.muted }}>{label}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderColor: wrong ? colors.danger : focused ? '#fff' : 'rgba(255,255,255,0.32)' }}>
        <TextInput
          autoCapitalize="none"
          autoCorrect={false}
          placeholderTextColor="rgba(255,255,255,0.3)"
          selectionColor="#fff"
          {...input}
          onFocus={(e) => (setFocused(true), input.onFocus?.(e))}
          onBlur={(e) => (setFocused(false), input.onBlur?.(e))}
          style={{ flex: 1, minWidth: 0, height: 48, fontSize: 22, color: '#fff', fontFamily: 'Onest_400Regular', outlineStyle: 'none' } as never}
        />
        {suffix ? <Text style={{ fontSize: 22, color: colors.muted }}>{suffix}</Text> : null}
      </View>
      {error ? <Text style={{ marginTop: 6, fontSize: 14, color: colors.danger }}>{error}</Text> : null}
    </View>
  );
}

/** A text button: skip, later, copy. White and underlined, so it doesn't pass for a caption; centred unless `left`. */
export function TextAction({ onPress, left = false, children }: { onPress: () => void; left?: boolean; children: string }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} hitSlop={8} style={({ pressed }) => ({ alignSelf: left ? 'flex-start' : 'center', paddingVertical: 4, opacity: pressed ? 0.5 : 1 })}>
      <Text style={{ fontSize: 17, textDecorationLine: 'underline' }}>{children}</Text>
    </Pressable>
  );
}

/** One of a few ways, picked with a radio button on the right (as iOS marks a choice): a row between hairlines. */
export function RadioRow({ title, sub, on, onPress, last = false }: { title: string; sub?: string; on: boolean; onPress: () => void; last?: boolean }) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: on }}
      onPress={() => { haptic.tap(); onPress(); }}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 16, borderTopWidth: 1, borderBottomWidth: last ? 1 : 0, borderColor: 'rgba(255,255,255,0.12)', opacity: pressed ? 0.6 : 1 })}
    >
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 20, lineHeight: 26 }}>{title}</Text>
        {sub ? <Text style={{ marginTop: 2, fontSize: 15, lineHeight: 20, color: colors.muted }}>{sub}</Text> : null}
      </View>
      <View style={{ width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: on ? '#fff' : 'rgba(255,255,255,0.4)', alignItems: 'center', justifyContent: 'center' }}>
        {on ? <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: '#fff' }} /> : null}
      </View>
    </Pressable>
  );
}

/** A tick box with its words: square (a round one reads as a radio), white when ticked. */
export function CheckRow({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: on }} onPress={onPress} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <View style={{ width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: on ? '#fff' : 'rgba(255,255,255,0.4)', alignItems: 'center', justifyContent: 'center', backgroundColor: on ? '#fff' : 'transparent' }}>
        {on ? <View style={{ width: 10, height: 6, marginTop: -3, borderLeftWidth: 2.5, borderBottomWidth: 2.5, borderColor: '#000', transform: [{ rotate: '-45deg' }] }} /> : null}
      </View>
      <Text style={{ fontSize: 17 }}>{label}</Text>
    </Pressable>
  );
}

/** Something kept from before on this phone, with what to do with it underlined on the right. */
export function KeptRow({ label, go, onPress }: { label: string; go: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'baseline', gap: 12, opacity: pressed ? 0.5 : 1 })}>
      <Text numberOfLines={1} style={{ flex: 1, fontSize: 18 }}>{label}</Text>
      <Text style={{ fontSize: 18, textDecorationLine: 'underline' }}>{go}</Text>
    </Pressable>
  );
}
