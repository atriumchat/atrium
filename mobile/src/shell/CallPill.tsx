import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useStore, dmTitle } from '../store';
import { leaveVoice, toggleMute, useVoice } from '../voice';
import { useT } from '../i18n';
import { Text } from '../text';
import { colors } from '../theme';
import { Avatar } from '../components/Avatar';
import { RoundButton } from '../components/ui';
import { MicIcon, MicSlashIcon, PhoneDownIcon, SignalIcon } from '../icons';
import { voiceMembers } from '../format';
import { NativeTabs } from 'expo-router/native-tabs';
import { openRoom } from '../nav';
import { haptic } from '../haptics';

/** Live mm:ss (or h:mm:ss) since you joined the current voice room. */
export function CallDuration({ since }: { since?: number | null }) {
  const joinedAt = useVoice((s) => s.joinedAt);
  const start = since ?? joinedAt;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const total = Math.max(0, Math.floor((now - (start ?? now)) / 1000));
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = String(total % 60).padStart(2, '0');
  return <Text style={{ fontVariant: ['tabular-nums'] }}>{h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${String(m).padStart(2, '0')}:${s}`}</Text>;
}

/** Where the call is and what it's called: a room, or the person / group for a call in DMs. */
function useCallPlace() {
  const id = useVoice((s) => s.channelId);
  const name = useStore((s) => {
    const channel = s.data?.channels.find((c) => c.id === id);
    if (channel) return channel.name;
    const dm = s.dms.find((d) => d.id === id);
    return dm ? dmTitle(dm, s.users, s.data?.me.id) : '';
  });
  return { id, name, open: () => id && openRoom(id) };
}

/** The call you're in: faces, the room and its timer, the mic and hang-up. `compact` is the slim one-line version. */
function CallRow({ compact = false }: { compact?: boolean }) {
  const { t } = useT();
  const { id, name, open } = useCallPlace();
  const status = useVoice((s) => s.status);
  const micOff = useVoice((s) => s.muted);
  const users = useStore((s) => s.users);
  const meId = useStore((s) => s.data?.me.id);
  const voice = useStore((s) => s.voice);
  const call = useStore((s) => (id ? s.calls[id] : undefined));
  if (!id) return null;
  const connected = status === 'connected';
  const inside = (call ? call.participants : voiceMembers(voice, id)).map((e) => e.userId);
  const faces = meId ? [meId, ...inside.filter((u) => u !== meId)] : inside;
  const size = compact ? 'sm' : 'md';
  return (
    <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, paddingLeft: compact ? 12 : 10, paddingRight: 6 }}>
      <Pressable accessibilityRole="button" onPress={open} style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        {compact ? null : (
          <View style={{ flexDirection: 'row' }}>
            {faces.slice(0, 3).map((u, i) => (
              <View key={u} style={{ marginLeft: i ? -10 : 0, borderRadius: 17, borderWidth: 2, borderColor: colors.graphite }}>
                <Avatar user={users[u]} size={30} ringBg={colors.graphite} />
              </View>
            ))}
          </View>
        )}
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={{ fontSize: 15, fontWeight: '600', lineHeight: 20 }}>{name}</Text>
          {compact ? null : (
            <Text style={{ fontSize: 13, lineHeight: 16, color: connected ? colors.success : colors.warning }}>
              {connected ? <>{t('shell.call.inVoice')} · <CallDuration /></> : t('shell.call.connectingShort')}
            </Text>
          )}
        </View>
      </Pressable>
      <RoundButton size={size} tone={micOff ? 'alert' : 'plain'} label={micOff ? t('shell.call.micOn') : t('shell.call.micOff')} silent onPress={() => void toggleMute()}>
        {(c) => (micOff ? <MicSlashIcon size={20} color={c} /> : <MicIcon size={20} color={c} />)}
      </RoundButton>
      <RoundButton size={size} tone="danger" label={t('shell.call.disconnect')} silent onPress={() => { haptic.heavy(); void leaveVoice(); }}>{(c) => <PhoneDownIcon size={20} color={c} />}</RoundButton>
    </View>
  );
}

/** The call in the native tab bar's accessory (iOS 26+): the system draws the glass around it; one line once the bar shrinks. */
export function CallAccessory() {
  const placement = NativeTabs.BottomAccessory.usePlacement();
  return <CallRow compact={placement === 'inline'} />;
}

/** Before iOS 26 there is no accessory: the same call as a pill of its own, sitting on the tab bar. */
export function CallPill() {
  const id = useVoice((s) => s.channelId);
  if (!id) return null;
  return (
    <View style={{ paddingHorizontal: 16, paddingVertical: 8 }}>
      <View style={{ height: 56, flexDirection: 'row', borderRadius: 28, borderWidth: 0.5, borderColor: colors.border, backgroundColor: colors.graphite }}>
        <CallRow />
      </View>
    </View>
  );
}

/** Inside a conversation (no tab bar there): a slim "voice connected" strip on top; tap it to go back to the call. */
export function CallBar({ viewing = false }: { viewing?: boolean }) {
  const { t } = useT();
  const { id, name, open } = useCallPlace();
  const status = useVoice((s) => s.status);
  const micOff = useVoice((s) => s.muted);
  if (!id || viewing) return null;
  const connected = status === 'connected';
  const tone = connected ? colors.success : colors.warning;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6, paddingLeft: 12, paddingRight: 8, borderBottomWidth: 1, borderBottomColor: colors.separator, backgroundColor: 'rgba(48,209,88,0.1)' }}>
      <Pressable accessibilityRole="button" onPress={open} style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <SignalIcon size={18} color={tone} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ fontSize: 15, fontWeight: '500', lineHeight: 20, color: tone }}>{connected ? t('shell.call.connected') : t('shell.call.connecting')}</Text>
          <Text numberOfLines={1} style={{ fontSize: 13, lineHeight: 16, color: colors.muted }}>{name}{connected ? <> · <CallDuration /></> : null}</Text>
        </View>
      </Pressable>
      <RoundButton size="sm" tone={micOff ? 'alert' : 'plain'} label={micOff ? t('shell.call.micOn') : t('shell.call.micOff')} silent onPress={() => void toggleMute()}>
        {(c) => (micOff ? <MicSlashIcon size={18} color={c} /> : <MicIcon size={18} color={c} />)}
      </RoundButton>
      <RoundButton size="sm" tone="danger" label={t('shell.call.disconnect')} silent onPress={() => { haptic.heavy(); void leaveVoice(); }}>{(c) => <PhoneDownIcon size={18} color={c} />}</RoundButton>
    </View>
  );
}
