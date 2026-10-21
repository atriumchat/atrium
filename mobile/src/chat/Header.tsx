import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { useStore } from '../store';
import { useT } from '../i18n';
import { Text } from '../text';
import { colors } from '../theme';
import { RoundButton } from '../components/ui';
import { BellIcon, ChevronLeftIcon } from '../icons';
import { openInbox } from '../nav';

/** Round grey badge for a channel glyph in the header. */
export function HeaderIcon({ children }: { children: ReactNode }) {
  return <View style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.06)' }}>{children}</View>;
}

/** The way back from a conversation to its list (the swipe from the left edge does the same). */
export function BackButton() {
  const { t } = useT();
  return <RoundButton tone="ghost" label={t('shell.header.back')} onPress={() => router.back()}>{(c) => <ChevronLeftIcon size={24} color={c} />}</RoundButton>;
}

/** Content header: leading icon/avatar and title on the left, actions and the inbox on the right. */
/** `onTitlePress` makes the leading picture and the title one button (a group's card). */
export function ChannelHeader({ leading, title, subtitle, actions, onTitlePress }: { leading: ReactNode; title: string; subtitle?: ReactNode; actions?: ReactNode; onTitlePress?: () => void }) {
  const { t } = useT();
  const total = useStore((s) => Object.values(s.data?.mentions ?? {}).reduce((n, m) => n + m, 0));
  return (
    <View style={{ marginHorizontal: 8, marginTop: 8, height: 56, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 28, backgroundColor: colors.graphite, paddingHorizontal: 8 }}>
      <BackButton />
      <Pressable accessibilityRole={onTitlePress ? 'button' : undefined} disabled={!onTitlePress} onPress={onTitlePress} style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        {leading}
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={{ fontSize: 17, fontWeight: '500', lineHeight: 20 }}>{title}</Text>
          {subtitle ? <Text numberOfLines={1} style={{ fontSize: 13, lineHeight: 16, color: colors.muted }}>{subtitle}</Text> : null}
        </View>
      </Pressable>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
        {actions}
        <Pressable accessibilityRole="button" accessibilityLabel={total ? t('people.inbox.titleNew', { n: total }) : t('people.inbox.title')} onPress={openInbox} style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' }}>
          <BellIcon size={20} />
          {total > 0 ? <View style={{ position: 'absolute', right: 0, top: 0, minWidth: 18, height: 18, paddingHorizontal: 4, borderRadius: 9, backgroundColor: colors.danger, borderWidth: 2, borderColor: colors.graphite, alignItems: 'center', justifyContent: 'center' }}><Text style={{ fontSize: 11, fontWeight: '500', lineHeight: 14 }}>{total > 99 ? '99+' : total}</Text></View> : null}
        </Pressable>
      </View>
    </View>
  );
}
