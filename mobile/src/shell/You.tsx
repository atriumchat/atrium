import { useState, type ReactNode } from 'react';
import Animated from 'react-native-reanimated';
import { appear, vanish } from '../motion';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { Image } from 'expo-image';
import { api, mediaSource } from '../api';
import { showError, useStore } from '../store';
import { useT } from '../i18n';
import { Text } from '../text';
import { colors } from '../theme';
import { Avatar } from '../components/Avatar';
import { StatusDot } from '../components/Settings';
import { Press, RoundButton } from '../components/ui';
import { GearIcon, PencilIcon, XIcon } from '../icons';
import { dateOnly, statusUntil } from '../format';
import { haptic } from '../haptics';

export const statusKey = { online: 'shell.status.online', dnd: 'shell.status.dnd', invisible: 'shell.status.invisible' } as const;

/**
 * The phone's "You" tab is your own card, as others see it: your face and status (with when it ends, and a cross to
 * drop it), the two things you change most, what's on your profile, and your friends. Language, the server and
 * logging out are rare: they live in Settings, behind the gear.
 */
export function YouTab() {
  const { t } = useT();
  const me = useStore((s) => s.data?.me);
  const status = useStore((s) => s.data?.myStatus ?? 'online');
  const statusText = useStore((s) => s.data?.myStatusText);
  const until = useStore((s) => s.data?.myStatusUntil);
  if (!me) return null;
  const banner = me.avatarUrl ? mediaSource(me.avatarUrl) : undefined;
  const custom = status !== 'online' || !!statusText;

  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingBottom: 24 }}>
      {/* Your photo, blurred, behind the top of the card: the same banner others see on your profile. */}
      <View style={{ height: 120, marginHorizontal: 16, marginTop: 8, overflow: 'hidden', borderRadius: 24, backgroundColor: colors.tertiary }}>
        {banner ? <Image source={banner} blurRadius={40} contentFit="cover" style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, opacity: 0.7, transform: [{ scale: 1.5 }] }} /> : null}
        <View style={{ position: 'absolute', right: 10, top: 10 }}>
          <RoundButton label={t('m.settings')} onPress={() => router.push('/you/settings')} style={{ backgroundColor: 'rgba(0,0,0,0.45)' }}>{(c) => <GearIcon size={20} color={c} />}</RoundButton>
        </View>
      </View>

      <View style={{ paddingHorizontal: 16, gap: 12 }}>
        <View style={{ marginTop: -48, marginLeft: 12, alignSelf: 'flex-start', borderRadius: 56, padding: 6, backgroundColor: colors.window }}>
          <Avatar user={me} size={92} online status={status} ringBg={colors.window} />
        </View>

        <Card>
          <View style={{ padding: 16, gap: 12 }}>
            <Text numberOfLines={1} style={{ fontSize: 26, fontWeight: '700', lineHeight: 32 }}>{me.name}</Text>
            {custom ? <Animated.View entering={appear} exiting={vanish}><StatusLine status={status} text={statusText} until={until} /></Animated.View> : null}
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Pill onPress={() => router.push('/you/status')}><StatusDot status={status} /><Text numberOfLines={1} style={{ fontSize: 16, fontWeight: '500' }}>{t('m.editStatus')}</Text></Pill>
              <Pill onPress={() => router.push('/you/profile')}><PencilIcon size={17} /><Text numberOfLines={1} style={{ fontSize: 16, fontWeight: '500' }}>{t('m.editProfile')}</Text></Pill>
            </View>
          </View>
        </Card>

        <Card>
          <Pressable accessibilityRole="button" onPress={() => router.push('/you/bio')} style={({ pressed }) => ({ paddingHorizontal: 16, paddingVertical: 12, backgroundColor: pressed ? 'rgba(255,255,255,0.05)' : 'transparent' })}>
            <Text style={{ fontSize: 14, color: colors.muted }}>{t('people.profile.about')}</Text>
            <Text style={{ marginTop: 2, fontSize: 17, lineHeight: 23, color: me.bio ? '#fff' : colors.muted }}>{me.bio || t('shell.you.bioPlaceholder')}</Text>
          </Pressable>
          <View style={{ height: 0.5, marginLeft: 16, backgroundColor: 'rgba(255,255,255,0.08)' }} />
          <View style={{ paddingHorizontal: 16, paddingVertical: 12 }}>
            <Text style={{ fontSize: 14, color: colors.muted }}>{t('people.profile.since')}</Text>
            <Text style={{ marginTop: 2, fontSize: 17 }}>{dateOnly(me.createdAt, { day: 'numeric', month: 'long', year: 'numeric' })}</Text>
          </View>
        </Card>
      </View>
    </ScrollView>
  );
}

/** Your status as others see it, when it is more than plain "online": how long it lasts, and a cross to drop it. */
function StatusLine({ status, text, until }: { status: 'online' | 'dnd' | 'invisible'; text?: string | null; until?: number | null }) {
  const { t } = useT();
  const [busy, setBusy] = useState(false);
  async function clear() {
    haptic.select();
    setBusy(true);
    try {
      const r = await api.status('online', '');
      useStore.setState((s) => ({ data: s.data ? { ...s.data, myStatus: r.status, myStatusText: r.text, myStatusUntil: r.until } : null }));
    } catch (e) { showError(e instanceof Error ? e.message : t('shell.status.changeFailed')); } finally { setBusy(false); }
  }
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 16, paddingVertical: 10, paddingLeft: 14, paddingRight: 8, backgroundColor: 'rgba(255,255,255,0.05)' }}>
      <StatusDot status={status} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={2} style={{ fontSize: 16 }}>{text || t(statusKey[status])}</Text>
        {until ? <Text style={{ marginTop: 2, fontSize: 14, color: colors.muted }}>{statusUntil(until)}</Text> : null}
      </View>
      {busy ? <ActivityIndicator color="#fff" style={{ width: 36 }} /> : <RoundButton size="sm" tone="ghost" label={t('m.clearStatus')} onPress={() => void clear()}>{(c) => <XIcon size={16} color={c} />}</RoundButton>}
    </View>
  );
}

function Card({ children }: { children: ReactNode }) {
  return <View style={{ overflow: 'hidden', borderRadius: 20, backgroundColor: colors.graphite }}>{children}</View>;
}

function Pill({ children, onPress }: { children: ReactNode; onPress: () => void }) {
  return (
    <Press scaleTo={0.96} accessibilityRole="button" onPress={onPress} style={({ pressed }) => ({ flex: 1, height: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 22, paddingHorizontal: 10, backgroundColor: pressed ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.09)' })}>
      {children}
    </Press>
  );
}
