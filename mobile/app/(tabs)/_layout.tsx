import { useCallback, useState } from 'react';
import { LayoutAnimationConfig } from 'react-native-reanimated';
import { ActivityIndicator, View } from 'react-native';
import { NativeTabs } from 'expo-router/native-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { restoreSession, showError, useStore } from '../../src/store';
import { useVoice } from '../../src/voice';
import { haptic } from '../../src/haptics';
import { useT } from '../../src/i18n';
import { Text } from '../../src/text';
import { colors } from '../../src/theme';
import { Primary } from '../../src/components/Settings';
import { CallAccessory } from '../../src/shell/CallPill';
import { hasAccessory } from '../../src/shell/TabScreen';
import { TabIconShots, type TabIcon, type TabIconName } from '../../src/shell/TabIcons';

/** Mentions of you in the server's channels: the red number on the server (plain chatter doesn't count). */
const serverBadge = (s: ReturnType<typeof useStore.getState>) => (s.data?.channels ?? []).reduce((n, c) => n + (s.data?.mentions[c.id] ?? 0), 0);
/** Unread DMs + incoming friend requests, on the home tab. */
const homeBadge = (s: ReturnType<typeof useStore.getState>) => s.dms.reduce((n, d) => n + (s.data?.unread[d.id] ?? 0), 0) + s.friends.filter((f) => f.status === 'incoming').length;
const badge = (n: number) => (n > 0 ? <NativeTabs.Trigger.Badge>{n > 99 ? '99+' : String(n)}</NativeTabs.Trigger.Badge> : null);

/**
 * Phone layout: the system's tab bar (Liquid Glass from iOS 26) with home, the server and you, drawn with Atrium's
 * own glyphs and your avatar. Conversations are screens of the root stack, so they slide in over the bar.
 */
export default function TabsLayout() {
  const { t } = useT();
  const data = useStore((s) => s.data);
  const home = useStore(homeBadge);
  const server = useStore(serverBadge);
  const custom = useStore((s) => !!s.data?.serverIcon);
  const inCall = useVoice((s) => !!s.channelId);
  const [icons, setIcons] = useState<Partial<Record<TabIconName, TabIcon>>>({});
  const onShot = useCallback((name: TabIconName, icon: TabIcon) => setIcons((all) => ({ ...all, [name]: icon })), []);
  if (!data) return <ConnectionGate />;
  return (
    <LayoutAnimationConfig skipExiting>
    <View style={{ flex: 1, backgroundColor: colors.window }}>
      <NativeTabs screenListeners={{ tabPress: () => haptic.select() }} tintColor="#fff" iconColor={{ default: colors.muted, selected: '#fff' }} minimizeBehavior="onScrollDown">
        {hasAccessory && inCall ? <NativeTabs.BottomAccessory><CallAccessory /></NativeTabs.BottomAccessory> : null}
        <NativeTabs.Trigger name="index">
          <NativeTabs.Trigger.Label>{t('shell.tab.home')}</NativeTabs.Trigger.Label>
          {icons.home ? <NativeTabs.Trigger.Icon src={{ default: icons.home, selected: icons.homeOn ?? icons.home }} renderingMode="template" /> : null}
          {badge(home)}
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="server">
          {/* The tab is your server: its own name, the generic word only while it has none. */}
          <NativeTabs.Trigger.Label>{data.serverName?.trim() || t('shell.tab.server')}</NativeTabs.Trigger.Label>
          {/* The server's own icon is a picture, kept in its colours; Atrium's mark is a glyph the bar tints. */}
          {icons.server ? <NativeTabs.Trigger.Icon src={custom ? icons.server : { default: icons.server, selected: icons.serverOn ?? icons.server }} renderingMode={custom ? 'original' : 'template'} /> : null}
          {badge(server)}
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="you">
          <NativeTabs.Trigger.Label>{t('shell.tab.you')}</NativeTabs.Trigger.Label>
          {icons.you ? <NativeTabs.Trigger.Icon src={icons.you} renderingMode="original" /> : null}
        </NativeTabs.Trigger>
      </NativeTabs>
      <TabIconShots onShot={onShot} />
    </View>
    </LayoutAnimationConfig>
  );
}

function ConnectionGate() {
  const { t } = useT();
  const [busy, setBusy] = useState(false);
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: colors.window, justifyContent: 'center', padding: 24, gap: 24, paddingTop: insets.top }}>
      <Text style={{ textAlign: 'center', fontSize: 20, fontWeight: '700' }}>{t('common.noConnection')}</Text>
      {busy ? <ActivityIndicator color="white" /> : <Primary onPress={() => { setBusy(true); void restoreSession().catch(showError).finally(() => setBusy(false)); }}>{t('m.retry')}</Primary>}
    </View>
  );
}
