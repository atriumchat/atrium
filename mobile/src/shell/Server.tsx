import { useState } from 'react';
import { Alert, Pressable, ScrollView, View } from 'react-native';
import { api } from '../api';
import { showError, useStore } from '../store';
import { useVoice } from '../voice';
import { useT } from '../i18n';
import { Text, TextInput } from '../text';
import { colors } from '../theme';
import { Avatar } from '../components/Avatar';
import { RoundButton } from '../components/ui';
import { EmptyState } from '../components/LineArt';
import { BellSlashIcon, HashIcon, UserPlusIcon, HeadphonesSlashIcon, MicSlashIcon, PlusIcon, SearchIcon, SpeakerIcon, VideoIcon } from '../icons';
import { voiceMembers } from '../format';
import { openChat, openRoom } from '../nav';
import { shareInvite } from '../invite';
import { CallDuration } from './CallPill';
import { TabHeader } from './TabHeader';
import type { Channel, VoiceEntry } from '../protocol';

/** The server's channels: a search field, then text channels and voice rooms in two sections. */
export function ServerTab() {
  const { t } = useT();
  const channels = useStore((s) => s.data?.channels);
  const [filter, setFilter] = useState('');
  const query = filter.trim().toLowerCase();
  const visible = (query ? channels?.filter((c) => c.name.toLowerCase().includes(query)) : channels) ?? [];
  return (
    <View style={{ flex: 1 }}>
      <TabHeader />
      <View style={{ height: 72, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12 }}>
        <View style={{ flex: 1, height: 48, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 24, paddingHorizontal: 16, backgroundColor: colors.graphite }}>
          <SearchIcon size={16} color={colors.faint} />
          <TextInput value={filter} onChangeText={setFilter} placeholder={t('shell.sidebar.search')} accessibilityLabel={t('shell.sidebar.search')} returnKeyType="search" clearButtonMode="while-editing" autoCorrect={false} autoCapitalize="none" style={{ flex: 1, fontSize: 17, color: '#fff', height: 48 }} />
        </View>
        {/* An invite is to this server: it sits by the server's channels. */}
        <Pressable accessibilityRole="button" accessibilityLabel={t('m.invite')} onPress={() => void shareInvite()} style={({ pressed }) => ({ width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? colors.hover : colors.graphite })}>
          <UserPlusIcon size={21} />
        </Pressable>
      </View>
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 12, flexGrow: 1 }} keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled">
        {query && visible.length === 0 ? (
          <EmptyState compact art="search" title={t('shell.sidebar.noResults.title')} text={t('shell.sidebar.noResults.text')} />
        ) : (
          <>
            <Section title={t('shell.sidebar.textChannels')} kind="text">{visible.filter((c) => c.kind === 'text').map((c) => <TextItem key={c.id} channel={c} />)}</Section>
            <Section title={t('shell.sidebar.voiceRooms')} kind="voice">{visible.filter((c) => c.kind === 'voice').map((c) => <VoiceItem key={c.id} channel={c} />)}</Section>
          </>
        )}
      </ScrollView>
    </View>
  );
}

function Section({ title, kind, children }: { title: string; kind: Channel['kind']; children: React.ReactNode }) {
  const { t } = useT();
  const canManage = useStore((s) => s.data?.canManageChannels);
  function add() {
    Alert.prompt(kind === 'text' ? t('shell.sidebar.createText') : t('shell.sidebar.createVoice'), undefined, [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('common.save'), onPress: (name?: string) => {
        if (!name?.trim()) return;
        void api.createChannel(name.trim(), kind).then((channels) => useStore.setState((s) => ({ data: s.data ? { ...s.data, channels } : null }))).catch((e) => showError(e instanceof Error ? e.message : t('shell.sidebar.createFailed')));
      } },
    ], 'plain-text', '', 'default');
  }
  return (
    <View style={{ paddingTop: 16 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 4, paddingLeft: 12, minHeight: 36 }}>
        <Text style={{ fontSize: 18, fontWeight: '600' }}>{title}</Text>
        {canManage ? <RoundButton size="sm" tone="ghost" label={kind === 'text' ? t('shell.sidebar.createText') : t('shell.sidebar.createVoice')} onPress={add}>{(c) => <PlusIcon size={20} color={c} />}</RoundButton> : null}
      </View>
      <View style={{ gap: 2 }}>{children}</View>
    </View>
  );
}

function ItemRow({ onPress, dim, children, label }: { onPress: () => void; dim?: boolean; children: React.ReactNode; label?: string }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => ({ height: 44, flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 22, paddingHorizontal: 12, opacity: dim ? 0.45 : 1, backgroundColor: pressed ? 'rgba(30,30,34,0.5)' : 'transparent' })}>
      {children}
    </Pressable>
  );
}

function TextItem({ channel }: { channel: Channel }) {
  const { t } = useT();
  const unread = useStore((s) => s.data?.unread[channel.id] ?? 0);
  const mentions = useStore((s) => s.data?.mentions[channel.id] ?? 0);
  const muted = useStore((s) => s.data?.mutedChannels.includes(channel.id) ?? false);
  // Like Discord: new messages make the name bright; only mentions of you get a red number.
  const showUnread = unread > 0 && !muted;
  const label = mentions > 0 ? t('shell.sidebar.mentions', { name: channel.name, n: mentions }) : showUnread ? t('shell.sidebar.unread', { name: channel.name }) : undefined;
  return (
    <ItemRow onPress={() => openChat(channel.id)} dim={muted && mentions === 0} label={label}>
      {/* Discord's pill at the edge: new messages here, easier to catch than a bolder name alone. */}
      {showUnread || mentions > 0 ? <View style={{ position: 'absolute', left: -12, width: 4, height: 8, borderTopRightRadius: 4, borderBottomRightRadius: 4, backgroundColor: '#fff' }} /> : null}
      <View style={{ opacity: 0.6 }}><HashIcon size={18} /></View>
      <Text numberOfLines={1} style={{ flex: 1, fontSize: 17, fontWeight: showUnread || mentions > 0 ? '600' : '500', color: showUnread || mentions > 0 ? '#fff' : colors.muted }}>{channel.name}</Text>
      {muted && mentions === 0 ? <BellSlashIcon size={14} color={colors.muted} /> : null}
      {mentions > 0 ? <View style={{ minWidth: 20, height: 20, paddingHorizontal: 6, borderRadius: 10, backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center' }}><Text style={{ fontSize: 12, fontWeight: '500', lineHeight: 20 }}>{mentions > 99 ? '99+' : mentions}</Text></View> : null}
    </ItemRow>
  );
}

function VoiceItem({ channel }: { channel: Channel }) {
  const connectedHere = useVoice((s) => s.channelId === channel.id && s.status === 'connected');
  const voice = useStore((s) => s.voice);
  const members = voiceMembers(voice, channel.id);
  return (
    <View>
      {/* On a phone a tap opens the room first, with a Join button, like Discord's app. */}
      <ItemRow onPress={() => openRoom(channel.id)}>
        <View style={connectedHere ? undefined : { opacity: 0.6 }}><SpeakerIcon size={18} color={connectedHere ? colors.success : '#fff'} /></View>
        <Text numberOfLines={1} style={{ flex: 1, fontSize: 17, fontWeight: '500', color: colors.muted }}>{channel.name}</Text>
        {connectedHere ? <Text style={{ fontSize: 13, color: colors.success }}><CallDuration /></Text> : null}
      </ItemRow>
      {members.length > 0 ? <View style={{ paddingBottom: 4, paddingLeft: 32 }}>{members.map((m) => <VoiceMember key={m.userId} entry={m} />)}</View> : null}
    </View>
  );
}

/** Person under a voice room, Discord-style. */
function VoiceMember({ entry }: { entry: VoiceEntry }) {
  const { t } = useT();
  const user = useStore((s) => s.users[entry.userId]);
  const speaking = useVoice((s) => s.channelId === entry.channelId && s.status === 'connected' && s.speaking.includes(entry.userId));
  return (
    <View style={{ height: 32, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 6 }}>
      <Avatar user={user} size={22} speaking={speaking} />
      <Text numberOfLines={1} style={{ flex: 1, fontSize: 16, color: speaking ? '#fff' : colors.muted }}>{user?.name ?? '…'}</Text>
      {entry.screen ? <View style={{ borderRadius: 4, backgroundColor: colors.danger, paddingHorizontal: 4 }}><Text style={{ fontSize: 11, fontWeight: '700', lineHeight: 16 }}>{t('shell.sidebar.live').toUpperCase()}</Text></View> : null}
      {entry.video ? <VideoIcon size={16} color={colors.muted} /> : null}
      {entry.deafened ? <HeadphonesSlashIcon size={16} color={colors.muted} /> : entry.muted ? <MicSlashIcon size={16} color={colors.muted} /> : null}
    </View>
  );
}
