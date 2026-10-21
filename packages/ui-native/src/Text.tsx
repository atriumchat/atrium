import { createContext, useContext, type ComponentRef, type Ref } from 'react';
import { StyleSheet, Text as RNText, TextInput as RNTextInput, type TextInputProps, type TextProps, type TextStyle } from 'react-native';
import { color } from '@gomex/ui-common';

/** Onest's weight files, as the app loads them (@expo-google-fonts/onest). */
export const fonts = { 400: 'Onest_400Regular', 500: 'Onest_500Medium', 600: 'Onest_600SemiBold', 700: 'Onest_700Bold' } as const;

/** Onest comes as one file per weight, and iOS ignores fontWeight for a custom family: pick the file here. */
function family(style: TextStyle | undefined): TextStyle {
  const weight = String(style?.fontWeight ?? '400');
  const w = weight === 'bold' ? 700 : Number(weight) || 400;
  const file = w >= 650 ? fonts[700] : w >= 550 ? fonts[600] : w >= 450 ? fonts[500] : fonts[400];
  return { fontFamily: file, fontWeight: 'normal' };
}
const flat = (style: TextProps['style']) => StyleSheet.flatten(style) as TextStyle | undefined;

/** A Text inside a Text inherits its colour; only the outermost one defaults to white. */
const Nested = createContext(false);
export function Text({ style, ...props }: TextProps) {
  const nested = useContext(Nested);
  const s = flat(style);
  return <Nested.Provider value><RNText maxFontSizeMultiplier={1.25} {...props} style={[nested ? null : { color: color.text.phone }, style, family(s)]} /></Nested.Provider>;
}
export type TextInputRef = ComponentRef<typeof RNTextInput>;
export function TextInput({ style, ...props }: TextInputProps & { ref?: Ref<TextInputRef> }) {
  return <RNTextInput maxFontSizeMultiplier={1.25} placeholderTextColor={color.faint} selectionColor={color.text.phone} keyboardAppearance="dark" {...props} style={[style, family(flat(style))]} />;
}
