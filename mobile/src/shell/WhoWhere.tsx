import { ScrollView, useWindowDimensions, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { appear, move, vanish } from '../motion';
import { useStore } from '../store';
import { lastRoomId, useVoice } from '../voice';
import { useT } from '../i18n';
import { Text } from '../text';
import { colors } from '../theme';
import { Avatar } from '../components/Avatar';
import { Press } from '../components/ui';
import { voiceMembers } from '../format';
import { ChevronRightIcon, HeadphonesIcon, SpeakerIcon } from '../icons';
import { openRoom } from '../nav';
import { CallDuration } from './CallPill';
import type { Channel } from '../protocol';

const GUTTER = 12;

/**
 * Who is in voice right now, as cards: the people first (that is what you look for), the room under them. Green
 * is the room you're in, pink the others; only rooms with someone in them. With everyone out, one quiet line with
 * the way into the room you used last. A tap opens the room (with its Join button), never joins on its own.
 */
export function RoomCards() {
  const { t } = useT();
  const { width } = useWindowDimensions();
  const channels = useStore((s) => s.data?.channels);
  const voice = useStore((s) => s.voice);
  const myRoomId = useVoice((s) => (s.status !== 'idle' && channels?.some((c) => c.id === s.channelId) ? s.channelId : null));
  const rooms = (channels ?? []).filter((c) => c.kind === 'voice');
  if (rooms.length === 0) return null;

  const live = rooms
    .map((room) => ({ room, people: voiceMembers(voice, room.id).map((e) => e.userId) }))
    .filter((r) => r.people.length > 0)
    .sort((a, b) => Number(b.room.id === myRoomId) - Number(a.room.id === myRoomId) || b.people.length - a.people.length || a.room.position - b.room.position);

  if (live.length === 0) {
    const last = rooms.find((r) => r.id === lastRoomId()) ?? [...rooms].sort((a, b) => a.position - b.position)[0]!;
    return (
      <View style={{ paddingHorizontal: GUTTER }}>
        <Press scaleTo={0.97}
          accessibilityRole="button"
          accessibilityLabel={t('people.who.joinRoom', { name: last.name })}
          onPress={() => openRoom(last.id)}
          style={({ pressed }) => ({ height: 52, flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 20, paddingHorizontal: 16, backgroundColor: pressed ? colors.hover : colors.graphite })}
        >
          <HeadphonesIcon size={20} color={colors.muted} />
          <Text numberOfLines={1} style={{ flex: 1, fontSize: 16, color: colors.muted }}>{t('m.voiceQuiet')}</Text>
          <Text numberOfLines={1} style={{ maxWidth: '45%', fontSize: 16, fontWeight: '500' }}>{last.name}</Text>
          <ChevronRightIcon size={18} color={colors.faint} />
        </Press>
      </View>
    );
  }

  // One room: the whole width. More: a row you swipe, the next card peeking out at the edge.
  const cardWidth = live.length === 1 ? width - GUTTER * 2 : Math.min(280, width * 0.72);
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} decelerationRate="fast" snapToInterval={cardWidth + 8} contentContainerStyle={{ gap: 8, paddingHorizontal: GUTTER }}>
      {live.map((r) => <Animated.View key={r.room.id} entering={appear} exiting={vanish} layout={move}><RoomCard room={r.room} people={r.people} mine={r.room.id === myRoomId} width={cardWidth} /></Animated.View>)}
    </ScrollView>
  );
}

function RoomCard({ room, people, mine, width }: { room: Channel; people: string[]; mine: boolean; width: number }) {
  const { t } = useT();
  const users = useStore((s) => s.users);
  const meId = useStore((s) => s.data?.me.id);
  const faces = mine && meId ? [meId, ...people.filter((id) => id !== meId)] : people;
  const names = faces.map((id) => (id === meId ? t('m.youName') : users[id]?.name ?? '…'));
  const shown = names.length > 3 ? t('m.andMore', { names: names.slice(0, 2).join(', '), n: names.length - 2 }) : names.join(', ');
  const accent = mine ? colors.here : colors.others;
  return (
    <Press scaleTo={0.97}
      accessibilityRole="button"
      accessibilityLabel={`${room.name}: ${names.join(', ')}`}
      onPress={() => openRoom(room.id)}
      style={({ pressed }) => ({ width, minHeight: 96, flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 20, padding: 14, backgroundColor: pressed ? colors.hover : colors.graphite })}
    >
      <View style={{ flex: 1, minWidth: 0, gap: 6 }}>
        <Text numberOfLines={2} style={{ fontSize: 16, fontWeight: '600', lineHeight: 21 }}>{shown}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <SpeakerIcon size={15} color={accent} />
          <Text numberOfLines={1} style={{ flexShrink: 1, fontSize: 14, fontWeight: '500', color: accent }}>{room.name}</Text>
          {mine ? <Text style={{ fontSize: 14, color: accent }}>· <CallDuration /></Text> : null}
        </View>
      </View>
      <View style={{ flexDirection: 'row' }}>
        {faces.slice(0, 3).map((id, i) => (
          <View key={id} style={{ marginLeft: i ? -12 : 0, borderRadius: 20, borderWidth: 2, borderColor: colors.graphite }}>
            <Avatar user={users[id]} size={36} ringBg={colors.graphite} />
          </View>
        ))}
      </View>
    </Press>
  );
}
