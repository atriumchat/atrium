import { useState, type ReactNode } from 'react';
import { LayoutAnimationConfig } from 'react-native-reanimated';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import Svg, { Defs, LinearGradient as SvgGradient, Rect, Stop } from 'react-native-svg';
import { router, useLocalSearchParams } from 'expo-router';
import { VideoTrack } from '@livekit/react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { dmTitle, getSocket, useStore } from '../../src/store';
import { joinVoice, toggleSpeaker, useVoice } from '../../src/voice';
import { useT } from '../../src/i18n';
import { Text } from '../../src/text';
import { colors } from '../../src/theme';
import { Avatar } from '../../src/components/Avatar';
import { LineArt } from '../../src/components/LineArt';
import { Press, RoundButton, tap } from '../../src/components/ui';
import { haptic } from '../../src/haptics';
import { BubbleIcon, ChevronDownIcon, HeadphonesSlashIcon, MicIcon, MicSlashIcon, PhoneDownIcon, ScreenIcon, SpeakerIcon, UserPlusIcon, VideoIcon } from '../../src/icons';
import { voiceMembers } from '../../src/format';
import { openChat, openGroupPicker } from '../../src/nav';
import { CallDuration } from '../../src/shell/CallPill';
import { Bubbles } from '../../src/voice/Bubbles';
import { CallControls, Dock } from '../../src/voice/Controls';
import { useStage, type Stage } from '../../src/voice/hooks';
import { CallGlow, Ripples } from '../../src/voice/Effects';

/**
 * A voice room (or a call in a DM or group). Before you're in: who is there, and a dock with the mic you'll come in
 * with and a big Join under the thumb. Once in: everyone on the stage and the call's controls in the same dock.
 */
export default function Room() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const channel = useStore((s) => s.data?.channels.find((c) => c.id === id));
  const dm = useStore((s) => s.dms.find((d) => d.id === id));
  const meId = useStore((s) => s.data?.me.id);
  const title = useStore((s) => (dm ? dmTitle(dm, s.users, meId) : channel?.name ?? ''));
  const mine = useVoice((s) => s.channelId === id);
  const status = useVoice((s) => s.status);
  const live = mine && status === 'connected';
  // A DM or group call has a conversation of its own: its chat opens over the call.
  const onChat = dm ? () => openChat(dm.id) : undefined;
  return (
    <LayoutAnimationConfig skipExiting>
      <View style={{ flex: 1, backgroundColor: colors.window }}>
        {/* In the call the stage is the whole screen (a camera goes edge to edge); the bar floats over it. */}
        {live ? <ConnectedStage id={id} onChat={onChat} /> : null}
        <View style={{ paddingTop: insets.top }}>
          <TopBar title={title} live={live} dmId={dm?.id} />
        </View>
        {live ? null : <JoinPrompt id={id} title={title} connecting={mine && status === 'connecting'} isDm={!!dm} onChat={onChat} />}
      </View>
    </LayoutAnimationConfig>
  );
}

/** Down to the app (the call goes on, in the tab bar's accessory), the room and its timer, the audio output, and — in a DM or group — adding people. */
function TopBar({ title, live, dmId }: { title: string; live: boolean; dmId?: string }) {
  const { t } = useT();
  return (
    <View style={{ height: 56, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12 }}>
      <RoundButton label={t('shell.header.back')} onPress={() => router.back()}>{(c) => <ChevronDownIcon size={24} color={c} />}</RoundButton>
      {/* Before you're in, the page itself says the room's name in big. */}
      <View style={{ flex: 1, minWidth: 0, alignItems: 'flex-start' }}>
        {live ? (
          <View style={{ maxWidth: '100%', height: 40, justifyContent: 'center', borderRadius: 20, paddingHorizontal: 16, backgroundColor: colors.tertiary }}>
            <Text numberOfLines={1} style={{ fontSize: 16, fontWeight: '600' }}>{title}<Text style={{ fontWeight: '400', color: colors.success }}>  <CallDuration /></Text></Text>
          </View>
        ) : null}
      </View>
      {live ? <RoundButton label={t('shell.call.pickOutput')} onPress={() => void toggleSpeaker()}>{(c) => <SpeakerIcon size={22} color={c} />}</RoundButton> : null}
      {dmId ? <RoundButton label={t('chat.addPeople')} onPress={() => openGroupPicker(dmId)}>{(c) => <UserPlusIcon size={22} color={c} />}</RoundButton> : null}
    </View>
  );
}

/** Up to four faces, overlapping in a loose cluster: the room's picture before you go in. */
function Faces({ ids }: { ids: string[] }) {
  const users = useStore((s) => s.users);
  const shown = ids.slice(0, 4);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}>
      {shown.map((uid, i) => (
        <View key={uid} style={{ marginLeft: i ? -18 : 0, marginTop: i % 2 ? 24 : 0, borderRadius: 40, borderWidth: 3, borderColor: colors.window }}>
          <Avatar user={users[uid]} size={64} ringBg={colors.window} />
        </View>
      ))}
    </View>
  );
}

/** Before you're in: the faces, who they are, a "showing their screen" line, the list of people, then the dock. */
function JoinPrompt({ id, title, connecting, isDm, onChat }: { id: string; title: string; connecting: boolean; isDm: boolean; onChat?: () => void }) {
  const { t } = useT();
  const voice = useStore((s) => s.voice);
  const call = useStore((s) => s.calls[id]);
  const users = useStore((s) => s.users);
  const meId = useStore((s) => s.data?.me.id);
  const [micOff, setMicOff] = useState(false);
  const members = call ? call.participants : voiceMembers(voice, id);
  const ringingMe = !!meId && !!call?.ringing.includes(meId);
  const names = members.map((m) => users[m.userId]?.name ?? '…');
  const who = names.length > 3 ? t('m.andMore', { names: names.slice(0, 2).join(', '), n: names.length - 2 }) : names.join(', ');
  const sharing = members.find((m) => m.screen);
  const join = () => void joinVoice(id, { muted: micOff });
  const action = ringingMe ? t('voice.call.answer') : isDm ? (members.length ? t('voice.call.join') : t('voice.call.start')) : t('m.joinVoice');
  return (
    <View style={{ flex: 1 }}>
      {members.length ? <CallGlow talking={false} color={colors.others} /> : null}
      {/* An empty room is just its picture and name: in the middle of the page, not stuck under the top bar. */}
      <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: members.length ? 'flex-start' : 'center', paddingHorizontal: 16, paddingTop: 16, paddingBottom: members.length ? 16 : 64 }}>
        <View style={{ alignItems: 'center' }}>
          <Ripples active={ringingMe} size={140} color={colors.success}>{members.length ? <Faces ids={members.map((m) => m.userId)} /> : <LineArt art="voice" />}</Ripples>
          <Text numberOfLines={2} style={{ marginTop: 16, fontSize: 26, fontWeight: '700', lineHeight: 32, textAlign: 'center' }}>{title}</Text>
          <Text style={{ marginTop: 4, fontSize: 16, color: colors.muted, textAlign: 'center' }}>{members.length ? who : t('voice.room.nobody')}</Text>
        </View>
        {sharing ? (
          <View style={{ marginTop: 20, flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 16, padding: 14, backgroundColor: colors.graphite }}>
            <ScreenIcon size={20} color={colors.danger} />
            <Text numberOfLines={1} style={{ flex: 1, fontSize: 16 }}>{t('m.sharing', { name: users[sharing.userId]?.name ?? '…' })}</Text>
          </View>
        ) : null}
        {members.length ? (
          <View style={{ marginTop: 20, overflow: 'hidden', borderRadius: 20, backgroundColor: colors.graphite }}>
            {members.map((m, i) => (
              <View key={m.userId}>
                {i ? <View style={{ height: 0.5, marginLeft: 62, backgroundColor: 'rgba(255,255,255,0.08)' }} /> : null}
                <View style={{ minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14 }}>
                  <Avatar user={users[m.userId]} size={36} ringBg={colors.graphite} />
                  <Text numberOfLines={1} style={{ flex: 1, fontSize: 17 }}>{users[m.userId]?.name ?? '…'}</Text>
                  {m.screen ? <ScreenIcon size={18} color={colors.danger} /> : null}
                  {m.video ? <VideoIcon size={18} color={colors.muted} /> : null}
                  {m.deafened ? <HeadphonesSlashIcon size={18} color={colors.muted} /> : m.muted ? <MicSlashIcon size={18} color={colors.muted} /> : null}
                </View>
              </View>
            ))}
          </View>
        ) : null}
      </ScrollView>
      <Dock>
        {/* The mic you'll come in with: white is on. */}
        <RoundButton size="lg" tone={micOff ? 'alert' : 'on'} label={micOff ? t('voice.mic.unmute') : t('voice.mic.mute')} silent onPress={() => { if (micOff) haptic.soft(); else haptic.rigid(); setMicOff((v) => !v); }}>{(c) => (micOff ? <MicSlashIcon size={28} color={c} /> : <MicIcon size={28} color={c} />)}</RoundButton>
        {ringingMe ? <RoundButton size="lg" tone="danger" label={t('voice.call.decline')} onPress={() => getSocket()?.emit('call:decline', { dmId: id })}>{(c) => <PhoneDownIcon size={24} color={c} />}</RoundButton> : null}
        <Press scaleTo={0.97} accessibilityRole="button" disabled={connecting} onPress={() => { tap(); join(); }} style={({ pressed }) => ({ flex: 1, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.successFill, opacity: pressed ? 0.8 : 1 })}>
          {connecting ? <ActivityIndicator color="#fff" /> : <Text style={{ fontSize: 17, fontWeight: '600', color: '#fff' }}>{action}</Text>}
        </Press>
        {onChat ? <RoundButton size="lg" label={t('m.callChat')} onPress={onChat}>{(c) => <BubbleIcon size={22} color={c} />}</RoundButton> : null}
      </Dock>
    </View>
  );
}

/**
 * The call, laid out like FaceTime: someone's shared screen, or a camera, fills the screen edge to edge; in a call
 * of two the other person is the screen and you're a small window in the corner; three or more share a grid; with
 * no cameras at all everyone is a bubble. The controls float at the bottom.
 */
function ConnectedStage({ id, onChat }: { id: string; onChat?: () => void }) {
  const { t } = useT();
  const insets = useSafeAreaInsets();
  const room = useVoice((s) => s.room);
  const speaking = useVoice((s) => s.speaking);
  const voice = useStore((s) => s.voice);
  const call = useStore((s) => s.calls[id]);
  const users = useStore((s) => s.users);
  const stage = useStage(room);
  const entries = call ? call.participants : voiceMembers(voice, id);
  const ringing = (call?.ringing ?? []).filter((u) => !entries.some((e) => e.userId === u)).map((u) => ({ id: u, ringing: true }));
  const people = [...entries.map((m) => ({ id: m.userId, muted: m.muted, deafened: m.deafened })), ...ringing];
  const top = insets.top + 56;

  const shared = stage.find((s) => s.screen && !s.participant.isLocal) ?? stage.find((s) => s.screen);
  const me = stage.find((s) => s.participant.isLocal);
  const others = stage.filter((s) => !s.participant.isLocal);
  const anyCamera = stage.some((s) => s.camera);
  // Two of you (or just you): one big picture and, for the other, a corner window.
  const pair = !shared && anyCamera && stage.length <= 2;
  const main = shared ?? (pair ? others[0] ?? me : undefined);
  const corner = shared ? undefined : pair && others[0] && me?.camera ? me : undefined;

  let body: ReactNode;
  if (main) {
    const track = shared ? main.screen : main.camera;
    const user = users[main.participant.identity];
    body = (
      <>
        {track ? (
          <VideoTrack trackRef={track as never} objectFit={shared ? 'contain' : 'cover'} mirror={!shared && main.participant.isLocal} style={StyleSheet.absoluteFill} />
        ) : (
          <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center', backgroundColor: mix(user?.color ?? '#ffffff', colors.window, 0.3) }]}>
            <Avatar user={user} size={152} ringBg="transparent" />
          </View>
        )}
        {/* Dark at the top and bottom edges, so the bar and the controls read over any picture. */}
        <Scrim edge="top" height={top + 24} />
        <Scrim edge="bottom" height={180} />
        <View style={{ position: 'absolute', left: 16, bottom: 116 + insets.bottom, maxWidth: '70%', flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.45)', paddingHorizontal: 12, paddingVertical: 6 }}>
          {shared ? <ScreenIcon size={16} color="#fff" /> : null}
          <Text numberOfLines={1} style={{ fontSize: 15, fontWeight: '600' }}>{shared ? t('m.sharing', { name: user?.name ?? '…' }) : `${user?.name ?? ''}${main.participant.isLocal ? ` ${t('voice.you')}` : ''}`}</Text>
        </View>
        {corner?.camera ? (
          <View style={{ position: 'absolute', right: 12, top: top + 8, width: 108, height: 160, overflow: 'hidden', borderRadius: 18, borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)', backgroundColor: '#000' }}>
            <VideoTrack trackRef={corner.camera as never} objectFit="cover" mirror style={StyleSheet.absoluteFill} />
          </View>
        ) : null}
        <View style={{ flex: 1 }} />
      </>
    );
  } else if (anyCamera) {
    body = <View style={{ flex: 1, paddingTop: top }}><Tiles stage={stage} speaking={speaking} /></View>;
  } else {
    body = (
      <>
        <CallGlow talking={speaking.length > 0} />
        {/* Alone in the room: say so quietly, right under your face, instead of a lone face in an empty screen. */}
        <View style={{ flex: 1, paddingTop: top }}><Bubbles people={people} speaking={speaking} note={people.length === 1 ? t('m.alone') : undefined} /></View>
      </>
    );
  }
  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: main ? '#000' : colors.window }]}>
      {body}
      <CallControls onChat={onChat} />
    </View>
  );
}

/** A soft dark fade from one edge, for text and buttons over a picture. */
function Scrim({ edge, height }: { edge: 'top' | 'bottom'; height: number }) {
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, height, [edge]: 0 }}>
      <Svg width="100%" height="100%">
        <Defs>
          <SvgGradient id={`scrim-${edge}`} x1="0" y1={edge === 'top' ? '0' : '1'} x2="0" y2={edge === 'top' ? '1' : '0'}>
            <Stop offset="0" stopColor="#000" stopOpacity={0.55} />
            <Stop offset="1" stopColor="#000" stopOpacity={0} />
          </SvgGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill={`url(#scrim-${edge})`} />
      </Svg>
    </View>
  );
}

/** Discord-style tiles: the person's colour as background, avatar centred (or their camera), name tag bottom-left. */
function Tiles({ stage, speaking }: { stage: Stage[]; speaking: string[] }) {
  const { t } = useT();
  const users = useStore((s) => s.users);
  const voice = useStore((s) => s.voice);
  const [box, setBox] = useState({ w: 0, h: 0 });
  // The tiles share the stage: one fills it, two stack, three or four make a 2×2, more than six scroll.
  const n = stage.length;
  const cols = n <= 2 ? 1 : 2;
  const rows = Math.ceil(n / cols);
  const GAP = 8;
  const fit = n <= 6;
  const width = (box.w - GAP * (cols - 1)) / cols;
  const height = fit ? (box.h - GAP * (rows - 1)) / rows : width * 1.25;
  return (
    <View style={{ flex: 1, paddingHorizontal: 12, paddingTop: 4, paddingBottom: 4 }} onLayout={(e) => setBox({ w: e.nativeEvent.layout.width - 24, h: e.nativeEvent.layout.height - 8 })}>
      {box.w > 0 ? (
        <ScrollView scrollEnabled={!fit} contentContainerStyle={{ flexDirection: 'row', flexWrap: 'wrap', gap: GAP }}>
          {stage.map(({ participant, camera }) => {
            const user = users[participant.identity];
            const entry = voice.find((e) => e.userId === participant.identity);
            const on = speaking.includes(participant.identity);
            return (
              <View key={participant.identity} style={{ width, height, overflow: 'hidden', borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: camera ? '#000' : mix(user?.color ?? '#ffffff', colors.window, 0.35) }}>
                {camera ? <VideoTrack trackRef={camera as never} objectFit="cover" mirror={participant.isLocal} style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }} /> : <Avatar user={user} size={Math.min(112, width * 0.4, height * 0.45)} ringBg="transparent" />}
                {on ? <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, borderRadius: 20, borderWidth: 3, borderColor: colors.success }} /> : null}
                <View style={{ position: 'absolute', left: 10, bottom: 10, maxWidth: '85%', flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.55)', paddingHorizontal: 10, paddingVertical: 5 }}>
                  {entry?.deafened ? <HeadphonesSlashIcon size={14} color={colors.danger} /> : entry?.muted ? <MicSlashIcon size={14} color={colors.danger} /> : null}
                  <Text numberOfLines={1} style={{ fontSize: 14, fontWeight: '500' }}>{user?.name ?? participant.name}{participant.isLocal ? ` ${t('voice.you')}` : ''}</Text>
                </View>
              </View>
            );
          })}
        </ScrollView>
      ) : null}
    </View>
  );
}

function mix(hex: string, bg: string, amount: number) {
  const p = (h: string) => { const v = h.replace('#', ''); const f = v.length === 3 ? v.split('').map((c) => c + c).join('') : v; return [0, 2, 4].map((i) => parseInt(f.slice(i, i + 2), 16)); };
  const a = p(hex), b = p(bg);
  return `rgb(${a.map((x, i) => Math.round(x * amount + (b[i] ?? 0) * (1 - amount))).join(',')})`;
}
