import { Pressable, View } from 'react-native';
import { useStore } from '../store';
import { joinVoice, useVoice } from '../voice';
import { useT } from '../i18n';
import { Text } from '../text';
import { colors } from '../theme';
import { Avatar } from '../components/Avatar';
import { SpeakerIcon } from '../icons';
import { voiceMembers } from '../format';

/**
 * A call into a voice room, sent from the room's "Call to room" button: the room, who's inside, and a button to go in.
 * Pink when people are there, green when you are, grey when it's empty or gone — as the room circles on the home screen.
 */
export function RoomCard({ channelId }: { channelId: string }) {
  const { t } = useT();
  const room = useStore((s) => s.data?.channels.find((c) => c.id === channelId));
  const voice = useStore((s) => s.voice);
  const here = useVoice((s) => s.channelId === channelId);
  const users = useStore((s) => s.users);
  const people = voiceMembers(voice, channelId).map((e) => e.userId);
  const bg = !room || people.length === 0 ? colors.graphite : here ? colors.here : colors.others;
  const ink = !room || people.length === 0 ? colors.muted : here ? colors.hereInk : colors.othersInk;
  return (
    <View style={{ marginTop: 4, width: '100%', maxWidth: 400, flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 24, padding: 12, backgroundColor: 'rgba(255,255,255,0.06)' }}>
      <View style={{ width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: bg }}><SpeakerIcon size={22} color={ink} /></View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ fontSize: 16, fontWeight: '500', lineHeight: 20 }}>{room?.name ?? t('voice.room.deleted')}</Text>
        {room ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            {people.length > 0 ? <View style={{ flexDirection: 'row' }}>{people.slice(0, 3).map((id, i) => <View key={id} style={{ marginLeft: i ? -6 : 0, borderRadius: 10, borderWidth: 2, borderColor: '#1d1d21' }}><Avatar user={users[id]} size={16} /></View>)}</View> : null}
            <Text style={{ fontSize: 14, lineHeight: 20, color: colors.muted }}>{people.length > 0 ? t('voice.room.people', { n: people.length }) : t('voice.room.empty')}</Text>
          </View>
        ) : null}
      </View>
      {room ? (
        <Pressable accessibilityRole="button" disabled={here} onPress={() => void joinVoice(channelId)} style={({ pressed }) => ({ height: 36, borderRadius: 18, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: here ? colors.graphite : pressed ? '#e7e7ea' : '#fff' })}>
          <Text style={{ fontSize: 15, color: here ? colors.muted : '#0b0b0c' }}>{here ? t('voice.room.here') : t('voice.room.enter')}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
