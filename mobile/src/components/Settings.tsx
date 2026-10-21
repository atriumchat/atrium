import { Children, Fragment, isValidElement, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { Text, TextInput } from '../text';
import { colors } from '../theme';
import { ChevronRightIcon } from '../icons';
import { tap } from './ui';

/*
 * The settings' look from web/src/ui/settings.tsx, phone variant: grouped rows in a rounded graphite card, hairlines
 * starting after the icon, 52px rows, one white pill for the main action.
 */

/** A glyph at the start of a row, bare in the phone's cards. */
export function RowIcon({ children }: { children: ReactNode }) {
  return <View style={{ width: 22, alignItems: 'center', justifyContent: 'center' }}>{children}</View>;
}

/** Rows in a rounded graphite card; `title` is the group's caption over it. */
export function Rows({ title, children, style }: { title?: string; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const items = Children.toArray(children).filter(isValidElement);
  return (
    <View style={style}>
      {title ? <Text style={{ marginBottom: 8, paddingHorizontal: 16, fontSize: 14, color: colors.muted }}>{title}</Text> : null}
      <View style={{ overflow: 'hidden', borderRadius: 20, backgroundColor: colors.graphite }}>
        {items.map((child, i) => <Fragment key={child.key ?? i}>{child}</Fragment>)}
      </View>
    </View>
  );
}

/**
 * One row: its title with a short value under it, and what sits at the end (`children`, `value`). `onPress` makes the whole
 * row a button ending in a chevron (unless `chevron` is off, a choice's options).
 */
export function Row({ icon, title, value, children, onPress, chevron = true, last = false, danger = false }: {
  icon?: ReactNode; title: string; value?: string; children?: ReactNode; onPress?: () => void; chevron?: boolean; last?: boolean; danger?: boolean;
}) {
  const body = (
    <>
      {icon}
      <View style={{ flex: 1, minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, paddingRight: 16, borderBottomWidth: last ? 0 : 0.5, borderBottomColor: 'rgba(255,255,255,0.07)' }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={{ fontSize: 17, color: danger ? colors.danger : '#fff' }}>{title}</Text>
          {value ? <Text numberOfLines={1} style={{ fontSize: 14, color: colors.muted }}>{value}</Text> : null}
        </View>
        {children}
        {onPress && chevron ? <ChevronRightIcon size={18} color={colors.faint} /> : null}
      </View>
    </>
  );
  const layout: ViewStyle = { flexDirection: 'row', alignItems: 'center', gap: 14, paddingLeft: 16 };
  if (!onPress) return <View style={layout}>{body}</View>;
  return (
    <Pressable accessibilityRole="button" onPress={() => { tap(); onPress(); }} style={({ pressed }) => [layout, pressed && { backgroundColor: 'rgba(255,255,255,0.05)' }]}>
      {body}
    </Pressable>
  );
}

/** The value at the end of a phone row, as iOS has it: "Default", the nick, the count. */
export function RowValue({ children }: { children: ReactNode }) {
  return <Text numberOfLines={1} style={{ maxWidth: '50%', fontSize: 17, color: colors.muted }}>{children}</Text>;
}

/** The one main action: a white pill, across the whole page. */
export function Primary({ children, onPress, busy, disabled, danger, style }: { children: ReactNode; onPress: () => void; busy?: boolean; disabled?: boolean; danger?: boolean; style?: StyleProp<ViewStyle> }) {
  const off = disabled || busy;
  return (
    <Pressable
      accessibilityRole="button"
      disabled={off}
      onPress={onPress}
      style={({ pressed }) => [{ height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, paddingHorizontal: 20, backgroundColor: off ? colors.graphite : pressed ? '#fff' : '#f2f2f4' }, style]}
    >
      {busy ? <ActivityIndicator color="#0c0c0e" /> : <Text style={{ fontSize: 17, fontWeight: '500', color: off ? colors.faint : danger ? colors.danger : '#0c0c0e' }}>{children}</Text>}
    </Pressable>
  );
}

/** A graphite pill button. */
export function Secondary({ children, onPress, style, textStyle }: { children: ReactNode; onPress: () => void; style?: StyleProp<ViewStyle>; textStyle?: StyleProp<TextStyle> }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [{ height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, backgroundColor: pressed ? 'rgba(255,255,255,0.13)' : 'rgba(255,255,255,0.08)' }, style]}>
      <Text style={[{ fontSize: 15, fontWeight: '500' }, textStyle]}>{children}</Text>
    </Pressable>
  );
}

export function FieldLabel({ children }: { children: ReactNode }) {
  return <Text style={{ marginBottom: 8, fontSize: 14, color: colors.muted }}>{children}</Text>;
}

/** 46px fields with a 12px corner and a faint border (16px text: iOS zooms into smaller). */
export function Field(props: React.ComponentProps<typeof TextInput>) {
  return (
    <TextInput
      autoCapitalize="none"
      autoCorrect={false}
      {...props}
      style={[{ height: props.multiline ? undefined : 46, minHeight: props.multiline ? 120 : undefined, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)', backgroundColor: 'rgba(255,255,255,0.03)', paddingHorizontal: 14, paddingVertical: props.multiline ? 10 : 0, fontSize: 17, color: '#fff', textAlignVertical: props.multiline ? 'top' : 'center' }, props.style]}
    />
  );
}

/** Online / do not disturb / invisible, as a 12px dot. */
export function StatusDot({ status }: { status: 'online' | 'dnd' | 'invisible' }) {
  if (status === 'invisible') return <View style={{ width: 12, height: 12, borderRadius: 6, borderWidth: 3, borderColor: '#8e8e93' }} />;
  if (status === 'dnd') return <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center' }}><View style={{ width: 6, height: 2, borderRadius: 1, backgroundColor: 'rgba(0,0,0,0.8)' }} /></View>;
  return <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: colors.success }} />;
}
