import { useMemo, useState } from 'react';
import Animated from 'react-native-reanimated';
import { appear, move, vanish } from '../motion';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { useStore, dmTitle, getSocket, refresh, showError } from '../store';
import { joinVoice, useVoice } from '../voice';
import { useT, type TFn } from '../i18n';
import { Text } from '../text';
import { colors } from '../theme';
import { DmAvatar } from '../components/Avatar';
import { PhoneDownIcon, PhoneIcon as PhoneGlyph } from '../icons';
import { Badge, Press, RoundButton } from '../components/ui';
import { EmptyState } from '../components/LineArt';
import { PhoneIcon, PlusIcon } from '../icons';
import { shortStamp, plainText } from '../format';
import { openChat, openGroupPicker, openRoom } from '../nav';
import { haptic } from '../haptics';
import { SearchRow, TabHeader } from './TabHeader';
import { RoomCards } from './WhoWhere';
import type { Dm } from '../protocol';

/**
 * The phone's home: who is in voice right now, then your conversations, newest first, with a search over them.
 * Friends and the inbox are buttons in the header.
 */
export function HomeTab() {
  const { t } = useT();
  const all = useDmList();
  const users = useStore((s) => s.users);
  const meId = useStore((s) => s.data?.me.id);
  const [filter, setFilter] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const query = filter.trim().toLowerCase();
  const dms = query ? all.filter((dm) => dmTitle(dm, users, meId).toLowerCase().includes(query)) : all;
  return (
    <View style={{ flex: 1 }}>
      <TabHeader title={t('shell.tab.home')} friends />
      <SearchRow value={filter} onChange={setFilter} placeholder={t('m.searchDms')} />
      <IncomingCalls />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingTop: 4, paddingBottom: 16, gap: 16, flexGrow: 1 }}
        refreshControl={<RefreshControl tintColor="#fff" refreshing={refreshing} onRefresh={() => { haptic.firm(); setRefreshing(true); void refresh().catch(showError).finally(() => setRefreshing(false)); }} />}
      >
        {query ? null : <Animated.View entering={appear} layout={move}><RoomCards /></Animated.View>}
        <View style={{ paddingHorizontal: 12, flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 4, paddingLeft: 12 }}>
            <Text style={{ fontSize: 18, fontWeight: '600' }}>{t('shell.home.dms')}</Text>
            <RoundButton size="sm" tone="ghost" label={t('shell.home.newGroup')} onPress={openGroupPicker}>{(c) => <PlusIcon size={20} color={c} />}</RoundButton>
          </View>
          {dms.length > 0 ? dms.map((dm) => <Animated.View key={dm.id} layout={move}><FeedDm dm={dm} /></Animated.View>) : query ? (
            <EmptyState compact art="search" title={t('people.picker.noResults')} />
          ) : (
            <EmptyState compact art="messages" title={t('shell.home.empty.title')} text={t('shell.home.empty.text')} />
          )}
        </View>
      </ScrollView>
    </View>
  );
}

/** Your conversations, newest first: groups always, a DM once someone has written in it. */
export function useDmList(): Dm[] {
  const dms = useStore((s) => s.dms);
  return useMemo(() => dms.filter((dm) => dm.kind === 'group' || dm.preview), [dms]);
}

function previewText(dm: Dm, users: ReturnType<typeof useStore.getState>['users'], meId: string | undefined, t: TFn) {
  if (!dm.preview) return dm.kind === 'group' ? t('shell.home.members', { n: dm.members.length }) : t('shell.home.noMessages');
  const who = dm.preview.userId === meId ? t('shell.home.you') : dm.kind === 'group' ? `${users[dm.preview.userId]?.name ?? '…'}: ` : '';
  return who + (plainText(dm.preview.text, users) || (dm.preview.images > 1 ? t('shell.home.attachments', { n: dm.preview.images }) : t('shell.home.attachment')));
}

export function FeedDm({ dm }: { dm: Dm }) {
  const { t } = useT();
  const users = useStore((s) => s.users);
  const meId = useStore((s) => s.data?.me.id);
  const online = useStore((s) => dm.kind === 'dm' && s.online.includes(dm.userId ?? ''));
  const unread = useStore((s) => s.data?.unread[dm.id] ?? 0);
  const inCall = useStore((s) => !!s.calls[dm.id]);
  return (
    <Press scaleTo={0.98}
      accessibilityRole="button"
      onPress={() => openChat(dm.id)}
      style={({ pressed }) => ({ height: 68, borderRadius: 20, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: pressed ? 'rgba(30,30,34,0.6)' : 'transparent' })}
    >
      <DmAvatar dm={dm} size={48} online={online} ringBg={colors.window} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
          <Text numberOfLines={1} style={{ flex: 1, fontSize: 17, lineHeight: 20, fontWeight: '500', color: unread > 0 ? '#fff' : 'rgba(255,255,255,0.85)' }}>{dmTitle(dm, users, meId)}</Text>
          <Text style={{ fontSize: 13, lineHeight: 16, color: colors.faint }}>{dm.preview ? shortStamp(dm.lastMessageAt) : ''}</Text>
        </View>
        <View style={{ marginTop: 2, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text numberOfLines={1} style={{ flex: 1, fontSize: 15, lineHeight: 20, color: colors.muted }}>{previewText(dm, users, meId, t)}</Text>
          {inCall ? <PhoneIcon size={16} color={colors.success} /> : unread > 0 ? <Badge count={unread} /> : null}
        </View>
      </View>
    </Press>
  );
}

/** Someone is ringing you in a DM or group: answer joins the call, decline tells them. */
function IncomingCalls() {
  const { t } = useT();
  const meId = useStore((s) => s.data?.me.id);
  const allCalls = useStore((s) => s.calls);
  const calls = Object.values(allCalls).filter((c) => meId && c.ringing.includes(meId));
  const dms = useStore((s) => s.dms);
  const users = useStore((s) => s.users);
  const active = useVoice((s) => s.channelId);
  return (
    <>
      {calls.filter((c) => c.dmId !== active).map((c) => {
        const dm = dms.find((d) => d.id === c.dmId);
        if (!dm) return null;
        return (
          <Animated.View key={c.dmId} entering={appear} exiting={vanish} layout={move} style={{ marginHorizontal: 12, marginBottom: 8, flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 32, backgroundColor: colors.graphite, padding: 8 }}>
            <DmAvatar dm={dm} size={44} ringBg={colors.graphite} />
            <Pressable accessibilityRole="button" onPress={() => openRoom(dm.id)} style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={{ fontSize: 16, fontWeight: '600' }}>{dmTitle(dm, users, meId)}</Text>
              <Text numberOfLines={1} style={{ fontSize: 14, color: colors.success }}>{t('voice.call.incoming')}</Text>
            </Pressable>
            <RoundButton tone="danger" label={t('voice.call.decline')} onPress={() => getSocket()?.emit('call:decline', { dmId: dm.id })}>{(c) => <PhoneDownIcon size={20} color={c} />}</RoundButton>
            <Pressable accessibilityRole="button" accessibilityLabel={t('voice.call.answer')} onPress={() => { void joinVoice(dm.id); openRoom(dm.id); }} style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.successFill }}><PhoneGlyph size={20} color="#fff" /></Pressable>
          </Animated.View>
        );
      })}
    </>
  );
}
