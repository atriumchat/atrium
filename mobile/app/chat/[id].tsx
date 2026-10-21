import { useCallback, useEffect, useRef, useState } from 'react';
import Animated, { FadeIn, FadeOut, LayoutAnimationConfig } from 'react-native-reanimated';
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Pressable, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { dmTitle, loadHistory, setActive, showError, useStore } from '../../src/store';
import { joinVoice, useVoice } from '../../src/voice';
import { useT } from '../../src/i18n';
import { Text } from '../../src/text';
import { colors, fonts } from '../../src/theme';
import { Avatar, DmAvatar } from '../../src/components/Avatar';
import { RoundButton } from '../../src/components/ui';
import { EmptyState } from '../../src/components/LineArt';
import { DotsIcon, HashIcon, PhoneIcon, VideoIcon } from '../../src/icons';
import { dayDivider, sameDay, voiceMembers } from '../../src/format';
import { openGroupInfo, openGroupPicker, openProfile } from '../../src/nav';
import { ChannelHeader, HeaderIcon } from '../../src/chat/Header';
import { Composer, type ComposerHandle } from '../../src/chat/Composer';
import { MessageRow } from '../../src/chat/Message';
import { CallBar, CallDuration } from '../../src/shell/CallPill';
import type { Dm, Message } from '../../src/protocol';

const GROUP_GAP = 7 * 60_000;
const TYPING_TTL = 4500;
const EMPTY: Message[] = [];

/** A text channel or a direct-message conversation; both render with the same chat. */
export default function Chat() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useT();
  const insets = useSafeAreaInsets();
  const channel = useStore((s) => s.data?.channels.find((c) => c.id === id));
  const dm = useStore((s) => s.dms.find((d) => d.id === id));
  const meId = useStore((s) => s.data?.me.id);
  const title = useStore((s) => (dm ? dmTitle(dm, s.users, meId) : channel?.name ?? 'Gomex'));
  const messages = useStore((s) => s.messages[id] ?? EMPTY);
  const loaded = useStore((s) => s.hasMore[id] !== undefined);
  const hasMore = useStore((s) => s.hasMore[id] ?? false);
  const connected = useStore((s) => s.connected);
  const isGroup = dm?.kind === 'group';
  const [failed, setFailed] = useState(false);
  const [older, setOlder] = useState(false);
  const list = useRef<FlatList<Message>>(null);
  const composer = useRef<ComposerHandle>(null);
  const busyOlder = useRef(false);

  useFocusEffect(useCallback(() => {
    let live = true;
    setActive(id); setFailed(false);
    void loadHistory(id).catch((e) => { if (live) { showError(e); setFailed(true); } });
    return () => { live = false; setActive(null); };
  }, [id]));

  const render = useCallback(({ item, index }: { item: Message; index: number }) => {
    // The list is newest first, so the older neighbour is the next item.
    const prev = messages[index + 1];
    const newDay = !prev || !sameDay(prev.createdAt, item.createdAt);
    const startsGroup = newDay || prev.userId !== item.userId || item.createdAt - prev.createdAt > GROUP_GAP;
    // One View, not a Fragment: an inverted list lays a cell's children out column-reverse, which put the day under its first message.
    return (
      <View>
        {newDay ? <View style={{ alignItems: 'center', paddingBottom: 4, paddingTop: 20 }} accessibilityRole="header"><View style={{ borderRadius: 14, backgroundColor: colors.graphite, paddingHorizontal: 12, paddingVertical: 4 }}><Text style={{ fontSize: 13, fontWeight: '500', color: colors.muted }}>{dayDivider(item.createdAt)}</Text></View></View> : null}
        <MessageRow message={item} startsGroup={startsGroup} onReply={(m) => composer.current?.reply(m)} onEdit={(m) => composer.current?.edit(m)} />
      </View>
    );
  }, [messages]);

  const placeholder = t(isGroup ? 'chat.placeholder.group' : dm ? 'chat.placeholder.dm' : 'chat.placeholder.channel', { title });
  const intro = loaded && !hasMore && messages.length > 0 ? (
    <View style={{ paddingHorizontal: 16, paddingBottom: 8, paddingTop: 24 }}>
      {dm ? (isGroup ? <DmAvatar dm={dm} size={72} /> : <Avatar user={useStore.getState().users[dm.userId ?? '']} size={72} />) : <View style={{ width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.graphite }}><HashIcon size={32} /></View>}
      <Text style={{ marginTop: 12, fontSize: 28, fontWeight: '700', lineHeight: 36 }}>{dm ? title : t('chat.intro.welcome', { title })}</Text>
      <Text style={{ fontSize: 16, color: colors.muted }}>{dm ? t(isGroup ? 'chat.intro.group' : 'chat.intro.dm', { title }) : t('chat.intro.channel')}</Text>
    </View>
  ) : older || hasMore ? <ActivityIndicator color="#fff" style={{ padding: 16 }} /> : null;

  return (
    <LayoutAnimationConfig skipExiting>
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: colors.window, paddingTop: insets.top }}>
      <CallBar viewing={false} />
      {dm ? <DmHeader dm={dm} title={title} /> : <ChannelHeader leading={<HeaderIcon><HashIcon size={18} color={colors.muted} /></HeaderIcon>} title={title} />}
      {!dm ? <OngoingCall /> : null}
      {!connected ? <Text style={{ paddingVertical: 6, textAlign: 'center', fontSize: 14, color: colors.muted }}>{t('common.noConnection')}</Text> : null}
      {failed ? (
        <Pressable accessibilityRole="button" style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }} onPress={() => { setFailed(false); void loadHistory(id, false, true).catch((e) => { setFailed(true); showError(e); }); }}><Text>{t('m.retry')}</Text></Pressable>
      ) : (
        <FlatList
          ref={list}
          inverted
          data={messages}
          keyExtractor={(m) => m.id}
          renderItem={render}
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          initialNumToRender={16}
          maxToRenderPerBatch={10}
          windowSize={9}
          maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
          contentContainerStyle={{ paddingBottom: 8, flexGrow: 1 }}
          onEndReachedThreshold={0.4}
          onEndReached={() => {
            if (!hasMore || busyOlder.current) return;
            busyOlder.current = true; setOlder(true);
            void loadHistory(id, true).catch(showError).finally(() => { busyOlder.current = false; setOlder(false); });
          }}
          ListFooterComponent={intro ?? undefined}
          ListEmptyComponent={loaded && !hasMore ? <View style={{ transform: [{ scaleY: -1 }] }}><EmptyState art={isGroup ? 'group' : dm ? 'chat' : 'channel'} title={dm ? title : `#${title}`} text={t(isGroup ? 'chat.start.group' : dm ? 'chat.start.dm' : 'chat.start.channel')} fill /></View> : undefined}
        />
      )}
      <TypingLine channelId={id} />
      <Composer id={id} isDm={!!dm} placeholder={placeholder} composerRef={composer} onSent={() => list.current?.scrollToOffset({ offset: 0, animated: true })} />
    </KeyboardAvoidingView>
    </LayoutAnimationConfig>
  );
}

/** Header of a DM or group: who it is, call buttons, and a menu to add people (and rename or leave a group). */
function DmHeader({ dm, title }: { dm: Dm; title: string }) {
  const { t } = useT();
  const peer = useStore((s) => s.users[dm.userId ?? '']);
  const online = useStore((s) => dm.kind === 'dm' && s.online.includes(dm.userId ?? ''));
  const inThisCall = useVoice((s) => s.channelId === dm.id);
  const live = useStore((s) => !!s.calls[dm.id]);
  const group = dm.kind === 'group';
  // A group's things live on its card; a 1:1 DM has one: make it a group.
  const more = () => (group ? openGroupInfo(dm.id) : openGroupPicker(dm.id));
  return (
    <ChannelHeader
      leading={dm.userId && !group ? <Pressable accessibilityRole="button" onPress={() => openProfile(dm.userId!)}><Avatar user={peer} size={36} online={online} ringBg={colors.graphite} /></Pressable> : <DmAvatar dm={dm} size={36} ringBg={colors.graphite} />}
      title={title}
      onTitlePress={group ? () => openGroupInfo(dm.id) : undefined}
      subtitle={group ? t('chat.members', { n: dm.members.length }) : online ? t('chat.online') : t('chat.offline')}
      actions={
        <>
          {!inThisCall ? (
            <>
              <RoundButton tone="ghost" label={live ? t('voice.call.join') : t('voice.call.start')} onPress={() => void joinVoice(dm.id)}>{(c) => <PhoneIcon size={20} color={c} />}</RoundButton>
              <RoundButton tone="ghost" label={t('voice.call.video')} onPress={() => void joinVoice(dm.id, { video: true })}>{(c) => <VideoIcon size={20} color={c} />}</RoundButton>
            </>
          ) : null}
          <RoundButton tone="ghost" label={group ? t('m.groupInfo') : t('chat.createGroup')} onPress={more}>{(c) => <DotsIcon size={20} color={c} />}</RoundButton>
        </>
      }
    />
  );
}

/** Banner like the reference's call header: who's talking right now in a room, and a way in. */
function OngoingCall() {
  const { t } = useT();
  const voice = useStore((s) => s.voice);
  const channels = useStore((s) => s.data?.channels);
  const users = useStore((s) => s.users);
  const myRoom = useVoice((s) => (s.status === 'connected' ? s.channelId : null));
  const speaking = useVoice((s) => s.speaking);
  const rooms = (channels ?? []).filter((c) => c.kind === 'voice').map((c) => ({ channel: c, members: voiceMembers(voice, c.id) })).filter((r) => r.members.length > 0)
    .sort((a, b) => (a.channel.id === myRoom ? -1 : b.channel.id === myRoom ? 1 : b.members.length - a.members.length));
  const room = rooms[0];
  if (!room) return null;
  const inside = room.channel.id === myRoom;
  return (
    <View style={{ marginHorizontal: 8, marginTop: 8, flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 28, backgroundColor: colors.graphite, padding: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        {room.members.slice(0, 3).map((m) => <Avatar key={m.userId} user={users[m.userId]} size={40} speaking={inside && speaking.includes(m.userId)} ringBg={colors.graphite} />)}
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ fontSize: 16, fontWeight: '500' }}>{room.channel.name}</Text>
        <Text numberOfLines={1} style={{ fontSize: 14, color: colors.muted }}>{inside ? <>{t('chat.call.ongoing')} · <CallDuration /></> : room.members.map((m) => users[m.userId]?.name ?? '…').join(', ')}</Text>
      </View>
      {!inside ? <Pressable accessibilityRole="button" onPress={() => void joinVoice(room.channel.id)} style={({ pressed }) => ({ height: 40, borderRadius: 20, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? '#e7e7ea' : '#fff' })}><Text style={{ fontSize: 16, color: '#0b0b0c', fontWeight: '500' }}>{t('chat.call.joinShort')}</Text></Pressable> : null}
    </View>
  );
}

function TypingLine({ channelId }: { channelId: string }) {
  const { t } = useT();
  const typing = useStore((s) => s.typing[channelId]);
  const users = useStore((s) => s.users);
  const meId = useStore((s) => s.data?.me.id);
  const [now, setNow] = useState(() => Date.now());
  // Wake up once, when the first name shown runs out, instead of ticking every second.
  useEffect(() => {
    let next = Infinity;
    for (const [uid, ts] of Object.entries(typing ?? {})) if (uid !== meId && now - ts < TYPING_TTL) next = Math.min(next, ts + TYPING_TTL);
    if (next === Infinity) return;
    const timer = setTimeout(() => setNow(Date.now()), Math.max(0, next - Date.now()));
    return () => clearTimeout(timer);
  }, [typing, now, meId]);
  useEffect(() => { if (typing) setNow(Date.now()); }, [typing]);
  const names = Object.entries(typing ?? {}).filter(([uid, ts]) => uid !== meId && now - ts < TYPING_TTL).map(([uid]) => users[uid]?.name).filter(Boolean);
  return (
    <View style={{ height: 24, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 32 }}>
      {names.length > 0 ? (
        <Animated.Text entering={FadeIn.duration(180)} exiting={FadeOut.duration(180)} numberOfLines={1} style={{ fontFamily: fonts[400], fontSize: 14, color: colors.muted }}><Text style={{ fontWeight: '500', color: '#fff' }}>{names.join(', ')}</Text> {names.length > 1 ? t('chat.typing.many') : t('chat.typing.one')}</Animated.Text>
      ) : null}
    </View>
  );
}
