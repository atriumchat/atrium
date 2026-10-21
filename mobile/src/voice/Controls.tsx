import { type ReactNode } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { leaveVoice, toggleCamera, toggleMute, useVoice } from '../voice';
import { useT } from '../i18n';
import { colors } from '../theme';
import { Press, RoundButton } from '../components/ui';
import { haptic } from '../haptics';
import { BubbleIcon, MicIcon, MicSlashIcon, PhoneDownIcon, VideoIcon, VideoSlashIcon } from '../icons';

/** The bottom of a screen about a call: one rounded dock, pinned under the thumb. */
export function Dock({ children, center = false }: { children: ReactNode; center?: boolean }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={{ paddingHorizontal: 12, paddingTop: 8, paddingBottom: Math.max(12, insets.bottom), alignItems: center ? 'center' : 'stretch' }}>
      {/* Centred, it hugs its buttons: a small floating dock, not a wide empty bar. */}
      <View style={{ minHeight: 76, flexDirection: 'row', alignItems: 'center', justifyContent: center ? 'center' : 'space-between', gap: center ? 16 : 10, borderRadius: 38, borderWidth: 0.5, borderColor: colors.border, backgroundColor: colors.graphite, paddingHorizontal: center ? 12 : 14, paddingVertical: 10 }}>
        {children}
      </View>
    </View>
  );
}

/**
 * The call's controls, in the dock: mic and camera (white while on, the off mic red), the conversation's chat
 * when the call has one, and hang up.
 */
export function CallControls({ onChat }: { onChat?: () => void }) {
  const { t } = useT();
  const muted = useVoice((s) => s.muted);
  const cameraOn = useVoice((s) => s.camera);
  return (
    // One even group in the middle, every button the same circle, hang-up last: the hand learns where things are.
    <Dock center>
      <RoundButton size="xl" tone={muted ? 'alert' : 'on'} label={muted ? t('voice.mic.unmute') : t('voice.mic.mute')} silent onPress={() => void toggleMute()}>{(c) => (muted ? <MicSlashIcon size={28} color={c} /> : <MicIcon size={28} color={c} />)}</RoundButton>
      <RoundButton size="xl" tone={cameraOn ? 'on' : 'plain'} label={cameraOn ? t('voice.camera.off') : t('voice.camera.on')} onPress={() => void toggleCamera()}>{(c) => (cameraOn ? <VideoIcon size={28} color={c} /> : <VideoSlashIcon size={28} color={c} />)}</RoundButton>
      {onChat ? <RoundButton size="xl" label={t('m.callChat')} onPress={onChat}>{(c) => <BubbleIcon size={26} color={c} />}</RoundButton> : null}
      <Press scaleTo={0.94} accessibilityRole="button" accessibilityLabel={t('voice.leave')} onPress={() => { haptic.heavy(); void leaveVoice(); }} style={({ pressed }) => ({ width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.danger, opacity: pressed ? 0.8 : 1 })}>
        <PhoneDownIcon size={30} color="#fff" />
      </Press>
    </Dock>
  );
}
