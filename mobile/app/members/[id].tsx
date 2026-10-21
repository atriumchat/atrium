import { type ReactNode } from 'react';
import { Alert, Pressable, ScrollView, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../../src/api';
import { addDm, dmTitle, showError, useStore } from '../../src/store';
import { leaveVoice, useVoice } from '../../src/voice';
import { useT } from '../../src/i18n';
import { Text } from '../../src/text';
import { colors } from '../../src/theme';
import { Avatar, DmAvatar } from '../../src/components/Avatar';
import { Press, tap } from '../../src/components/ui';
import { ChevronRightIcon, LogoutIcon, PencilIcon, UserPlusIcon } from '../../src/icons';
import { openGroupPicker, openProfile } from '../../src/nav';

const MAX_MEMBERS = 10;

/**
 * A group's card, as a native sheet: its faces, name and who's in it; what you can do with it (add people, rename,
 * leave) as labelled round buttons; then everyone in it, with the way to add more on top.
 */
export default function GroupInfo() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useT();
  const insets = useSafeAreaInsets();
  const dm = useStore((s) => s.dms.find((d) => d.id === id));
  const users = useStore((s) => s.users);
  const meId = useStore((s) => s.data?.me.id);
  const online = useStore((s) => s.online);
  if (!dm) return null;
  const group = dm;

  const title = dmTitle(dm, users, meId);
  const others = dm.members.filter((m) => m !== meId).map((m) => users[m]?.name ?? '…');
  const who = others.length > 2 ? t('m.andMore', { names: others.slice(0, 2).join(', '), n: others.length - 2 }) : others.join(', ');
  // An unnamed group is already titled by its people: say how many instead of repeating them.
  const subtitle = who === title ? t('chat.members', { n: dm.members.length }) : who;
  const full = dm.members.length >= MAX_MEMBERS;
  // You first, then whoever is around, then by name.
  const members = [...dm.members].sort((a, b) => Number(b === meId) - Number(a === meId) || Number(online.includes(b)) - Number(online.includes(a)) || (users[a]?.name ?? '').localeCompare(users[b]?.name ?? '', 'ru'));

  function add() {
    router.back();
    setTimeout(() => openGroupPicker(group.id), 50);
  }
  function rename() {
    Alert.prompt(t('chat.groupName'), t('chat.groupNameHint'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('common.save'), onPress: (name?: string) => void api.renameGroup(group.id, name ?? '').then(addDm).catch(showError) },
    ], 'plain-text', group.name);
  }
  function leave() {
    Alert.alert(t('chat.leaveTitle'), t('chat.leaveText'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('chat.leave'), style: 'destructive', onPress: () => void (async () => {
        try {
          if (useVoice.getState().channelId === group.id) await leaveVoice();
          await api.leaveGroup(group.id);
          // The sheet and the chat under it both go: back to the tabs.
          router.dismissAll();
          useStore.setState((s) => ({ dms: s.dms.filter((d) => d.id !== group.id) }));
        } catch (e) { showError(e); }
      })() },
    ]);
  }

  return (
    <ScrollView style={{ backgroundColor: colors.overlay }} contentContainerStyle={{ paddingTop: 28, paddingHorizontal: 16, paddingBottom: Math.max(24, insets.bottom) }}>
      <View style={{ alignItems: 'center' }}>
        <DmAvatar dm={dm} size={88} ringBg={colors.overlay} />
        <Text numberOfLines={2} style={{ marginTop: 12, fontSize: 24, fontWeight: '700', lineHeight: 30, textAlign: 'center' }}>{title}</Text>
        {subtitle ? <Text numberOfLines={1} style={{ marginTop: 4, fontSize: 15, color: colors.muted }}>{subtitle}</Text> : null}
      </View>

      <View style={{ marginTop: 24, flexDirection: 'row', justifyContent: 'center', gap: 28 }}>
        <Action label={t('chat.addPeople')} disabled={full} onPress={add}><UserPlusIcon size={22} /></Action>
        <Action label={t('chat.rename')} onPress={rename}><PencilIcon size={22} /></Action>
        <Action label={t('chat.leave')} danger onPress={leave}><LogoutIcon size={22} color={colors.danger} /></Action>
      </View>

      <Text style={{ marginTop: 28, marginBottom: 8, paddingHorizontal: 16, fontSize: 14, color: colors.muted }}>{t('m.membersOf', { n: dm.members.length, max: MAX_MEMBERS })}</Text>
      <View style={{ overflow: 'hidden', borderRadius: 20, backgroundColor: colors.graphite }}>
        {!full ? (
          <Row onPress={add} first>
            <View style={{ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' }}><UserPlusIcon size={18} color="#0b0b0c" /></View>
            <Text style={{ flex: 1, fontSize: 17, fontWeight: '500' }}>{t('chat.addPeople')}</Text>
            <ChevronRightIcon size={18} color={colors.faint} />
          </Row>
        ) : null}
        {members.map((m, i) => (
          <Row key={m} first={full && i === 0} onPress={() => openProfile(m)}>
            <Avatar user={users[m]} size={36} online={online.includes(m)} ringBg={colors.graphite} />
            <Text numberOfLines={1} style={{ flex: 1, fontSize: 17 }}>
              {users[m]?.name ?? '…'}
              {m === meId ? <Text style={{ color: colors.muted }}> · {t('m.youName')}</Text> : null}
            </Text>
          </Row>
        ))}
      </View>
    </ScrollView>
  );
}

/** A round button with its word under it. */
function Action({ label, onPress, children, danger, disabled }: { label: string; onPress: () => void; children: ReactNode; danger?: boolean; disabled?: boolean }) {
  return (
    <Press scaleTo={0.9} accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={() => { tap(); onPress(); }} style={({ pressed }) => ({ width: 76, alignItems: 'center', gap: 8, opacity: disabled ? 0.4 : pressed ? 0.6 : 1 })}>
      <View style={{ width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.graphite }}>{children}</View>
      <Text numberOfLines={1} style={{ fontSize: 14, fontWeight: '500', color: danger ? colors.danger : '#fff' }}>{label}</Text>
    </Press>
  );
}

function Row({ children, onPress, first }: { children: ReactNode; onPress: () => void; first?: boolean }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => ({ backgroundColor: pressed ? 'rgba(255,255,255,0.05)' : 'transparent' })}>
      {first ? null : <View style={{ height: 0.5, marginLeft: 64, backgroundColor: 'rgba(255,255,255,0.08)' }} />}
      <View style={{ minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14 }}>{children}</View>
    </Pressable>
  );
}
