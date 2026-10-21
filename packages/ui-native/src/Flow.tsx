import { createContext, useContext, useState, type ComponentProps, type ReactNode } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, TextInput, useWindowDimensions, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import {
  color,
  flowFrame,
  radius,
  space,
  type,
  type FlowLabels,
  type FlowPrimaryProps,
  type FlowProviderProps,
  type FlowSecondaryProps,
  type FlowShellProps,
  type FlowStepProps,
  type KeptRowProps,
  type LineFieldProps,
  type RadioRowProps,
  type TextActionProps,
} from '@gomex/ui-common';
import { EdgeTicks } from './EdgeTicks';
import { tap } from './haptics';
import { ChevronLeft } from './icons';
import { fonts, Text } from './Text';

/**
 * Gomex Flow in React Native (DESIGN.md), the props from @gomex/ui-common's contract, the same parts as @gomex/ui-web:
 * a screen at a time in type alone on OLED black, one scale of ticks along the screen's edge for the whole way, the
 * main button white at the bottom with back as an outlined icon beside it.
 */

const ink = color.text.phone;

const Labels = createContext<FlowLabels>({ back: 'Back' });
/** The step's `onSubmit`, for its fields' return key. */
const Submit = createContext<(() => void) | undefined>(undefined);

/** The words the parts say themselves, in the app's language; English without it. */
export function FlowProvider({ labels, children }: FlowProviderProps) {
  return <Labels.Provider value={labels}>{children}</Labels.Provider>;
}

/** How far in from the screen's edge the ticks reach (EdgeTicks: 4 in, 10 long). */
export const RING = space.ring;

/**
 * Where a flow's content sits (flowFrame): concentric with the screen's corners, clear of the ticks. In a browser
 * (design work only) the screen is an iPhone 17 Pro's, island and all.
 */
export function useFlowFrame() {
  const phone = Platform.OS === 'web';
  const real = useSafeAreaInsets();
  const insets = phone ? { top: 62, bottom: 34 } : real;
  const { width, height } = useWindowDimensions();
  return { phone, insets, ...flowFrame(width, height, insets) };
}

/**
 * The page under a flow: black, the part it's in (`label`, "Адрес (2/5)") over the step, the ticks drawn last so
 * nothing covers them. `bottom` is laid along the screen's bottom edge to edge, kept inside the ticks (InsideEdge).
 */
export function FlowShell({ fill, label, bottom, children }: FlowShellProps) {
  const frame = useFlowFrame();
  return (
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: color.page.phone }}>
      <View style={{ flex: 1, paddingTop: frame.top, paddingBottom: frame.bottom }}>
        {label ? <Text style={{ paddingHorizontal: frame.edge, paddingTop: space.inBlock, fontSize: type.stage.size, lineHeight: type.stage.line, color: color.muted }}>{label}</Text> : null}
        <View style={{ flex: 1, paddingTop: 4, paddingHorizontal: frame.edge }}>{children}</View>
        {bottom ? (
          <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0 }}>
            <InsideEdge radius={frame.radius}>{bottom}</InsideEdge>
          </View>
        ) : null}
      </View>
      <EdgeTicks fill={fill} island={frame.island} />
      {frame.phone ? <View style={{ position: 'absolute', top: 11, alignSelf: 'center', width: 126, height: 37, borderRadius: 19, backgroundColor: color.page.phone, zIndex: 10 }} /> : null}
    </KeyboardAvoidingView>
  );
}

/**
 * Something kept inside the ticks: cut along the screen's rounded bottom a ring's width in, dimming into black towards
 * the ticks at the sides and the bottom. Open at the top, so whatever jumps there isn't cut.
 */
function InsideEdge({ radius: corner, children }: { radius: number; children: ReactNode }) {
  const inner = Math.max(0, corner - RING);
  const fade = 36;
  return (
    <View style={{ marginHorizontal: RING, marginBottom: RING, paddingTop: 80, overflow: 'hidden', borderBottomLeftRadius: inner, borderBottomRightRadius: inner }}>
      <View style={{ marginHorizontal: -RING }}>{children}</View>
      <Svg pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }} width="100%" height="100%">
        <Defs>
          <LinearGradient id="fromLeft" x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor={color.page.phone} stopOpacity="1" />
            <Stop offset="1" stopColor={color.page.phone} stopOpacity="0" />
          </LinearGradient>
          <LinearGradient id="fromRight" x1="1" y1="0" x2="0" y2="0">
            <Stop offset="0" stopColor={color.page.phone} stopOpacity="1" />
            <Stop offset="1" stopColor={color.page.phone} stopOpacity="0" />
          </LinearGradient>
          <LinearGradient id="fromBottom" x1="0" y1="1" x2="0" y2="0">
            <Stop offset="0" stopColor={color.page.phone} stopOpacity="1" />
            <Stop offset="1" stopColor={color.page.phone} stopOpacity="0" />
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
 * `onSubmit` is what a field's return key does.
 */
export function FlowStep({ title, sub, error, note, noteHidden, actions, aside, below, onBack, onSubmit, children }: FlowStepProps) {
  const labels = useContext(Labels);
  return (
    <Submit.Provider value={onSubmit}>
      <View style={{ flex: 1 }}>
        <Text accessibilityRole="header" style={{ fontSize: type.title.size, lineHeight: type.title.line, letterSpacing: type.title.tracking }}>{title}</Text>
        {sub ? <Text style={{ marginTop: space.inBlock, fontSize: type.sub.size, lineHeight: type.sub.line, color: color.muted }}>{sub}</Text> : null}
        {children ? <View style={{ gap: space.between, marginTop: space.between }}>{children}</View> : null}
        <View style={{ flex: 1, minHeight: 12 }} />
        <View style={{ gap: 14 }}>
          {error ? <Text accessibilityRole="alert" style={{ fontSize: type.note.size, lineHeight: type.note.line, color: color.danger }}>{error}</Text> : null}
          {note ? <Text style={{ fontSize: type.note.size, lineHeight: type.note.line, color: color.muted, opacity: noteHidden ? 0 : 1 }}>{note}</Text> : null}
          {actions || onBack || aside ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
              {onBack ? (
                <Pressable accessibilityRole="button" accessibilityLabel={labels.back} onPress={onBack} hitSlop={12} style={({ pressed }) => ({ width: 48, height: 48, borderRadius: radius.button, borderWidth: 1, borderColor: pressed ? ink : color.outline, alignItems: 'center', justifyContent: 'center' })}>
                  <ChevronLeft />
                </Pressable>
              ) : null}
              <View style={{ flex: 1 }}>{actions}</View>
              {aside}
            </View>
          ) : null}
          {below}
        </View>
      </View>
    </Submit.Provider>
  );
}

/** The one main action: a white pill. */
export function FlowPrimary({ onPress, disabled = false, busy = false, children }: FlowPrimaryProps) {
  const off = disabled || busy;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: off, busy }}
      disabled={off}
      onPress={onPress}
      style={({ pressed }) => ({ height: 48, borderRadius: radius.button, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20, backgroundColor: busy ? color.button : off ? color.graphite : pressed ? color.buttonHover : color.button })}
    >
      {busy ? <ActivityIndicator color={color.buttonInk} /> : <Text style={{ fontSize: type.button.size, lineHeight: type.button.line, fontWeight: '500', color: off ? color.faint : color.buttonInk }}>{children}</Text>}
    </Pressable>
  );
}

/**
 * A field as a line: its name small above, the text big on a hairline that turns white while typing, what's wrong in
 * red right under it. Always give it a placeholder: an empty line alone doesn't say it takes text.
 */
export function LineField({ label, suffix, trailing, bad = false, error, style, ...input }: LineFieldProps & Omit<ComponentProps<typeof TextInput>, 'style'> & { style?: StyleProp<ViewStyle> }) {
  const [focused, setFocused] = useState(false);
  const submit = useContext(Submit);
  const wrong = bad || !!error;
  return (
    <View style={style}>
      <Text style={{ fontSize: type.label.size, lineHeight: type.label.line, color: color.muted }}>{label}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderColor: wrong ? color.danger : focused ? ink : color.fieldLine }}>
        <TextInput
          autoCapitalize="none"
          autoCorrect={false}
          placeholderTextColor={color.placeholder}
          selectionColor={ink}
          keyboardAppearance="dark"
          returnKeyType={submit ? 'go' : undefined}
          onSubmitEditing={submit ? () => submit() : undefined}
          {...input}
          onFocus={(e) => (setFocused(true), input.onFocus?.(e))}
          onBlur={(e) => (setFocused(false), input.onBlur?.(e))}
          style={{ flex: 1, minWidth: 0, height: 48, fontSize: type.field.size, color: ink, fontFamily: fonts[400], outlineStyle: 'none' } as never}
        />
        {suffix ? <Text style={{ fontSize: type.field.size, color: color.muted }}>{suffix}</Text> : null}
        {trailing}
      </View>
      {error ? <Text accessibilityRole="alert" style={{ marginTop: 6, fontSize: type.label.size, lineHeight: type.label.line, color: color.danger }}>{error}</Text> : null}
    </View>
  );
}

/** A small outlined button right of the main one, 2 points off, for the way round it: skip, later. */
export function FlowSecondary({ onPress, children }: FlowSecondaryProps) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => ({ height: 48, marginLeft: 2, paddingHorizontal: 20, borderRadius: radius.button, borderWidth: 1, borderColor: pressed ? ink : color.outline, alignItems: 'center', justifyContent: 'center' })}>
      <Text style={{ fontSize: type.button.size }}>{children}</Text>
    </Pressable>
  );
}

/** A text button: skip, later, copy. White and underlined, so it doesn't pass for a caption; centred unless `left`. */
export function TextAction({ onPress, left = false, children }: TextActionProps) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} hitSlop={8} style={({ pressed }) => ({ alignSelf: left ? 'flex-start' : 'center', paddingVertical: 4, opacity: pressed ? 0.5 : 1 })}>
      <Text style={{ fontSize: type.button.size, textDecorationLine: 'underline' }}>{children}</Text>
    </Pressable>
  );
}

/** One of a few ways, picked with a radio button on the right (as iOS marks a choice): a row between hairlines. */
export function RadioRow({ title, sub, on, onPress, last = false }: RadioRowProps) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: on }}
      onPress={() => (tap(), onPress())}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 16, borderTopWidth: 1, borderBottomWidth: last ? 1 : 0, borderColor: color.hairline, opacity: pressed ? 0.6 : 1 })}
    >
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: type.choice.size, lineHeight: type.choice.line }}>{title}</Text>
        {sub ? <Text style={{ marginTop: 2, fontSize: type.note.size, lineHeight: type.note.line, color: color.muted }}>{sub}</Text> : null}
      </View>
      <View style={{ width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: on ? ink : color.control, alignItems: 'center', justifyContent: 'center' }}>
        {on ? <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: ink }} /> : null}
      </View>
    </Pressable>
  );
}

/** Something kept from before on this phone, with what to do with it underlined on the right. */
export function KeptRow({ label, go, onPress }: KeptRowProps) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'baseline', gap: 12, opacity: pressed ? 0.5 : 1 })}>
      <Text numberOfLines={1} style={{ flex: 1, fontSize: type.kept.size, lineHeight: type.kept.line }}>{label}</Text>
      <Text style={{ fontSize: type.kept.size, lineHeight: type.kept.line, textDecorationLine: 'underline' }}>{go}</Text>
    </Pressable>
  );
}
