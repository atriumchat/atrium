import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { mediaSource } from '../api';
import { useStore } from '../store';
import { Text } from '../text';
import { colors } from '../theme';
import type { Dm, User } from '../protocol';

type Props = {
  user: User | undefined;
  size?: number;
  speaking?: boolean;
  dimmed?: boolean;
  /** Show a "online" status dot. */
  online?: boolean;
  /** Background behind the avatar, used to cut the gap around the speaking ring and status dot. */
  ringBg?: string;
  /** Your own real status (others only see "dnd" through user.status); invisible shows a hollow dot. */
  status?: 'online' | 'dnd' | 'invisible';
};

export const Avatar = memo(function Avatar({ user, size = 32, speaking = false, dimmed = false, online = false, ringBg = colors.window, status }: Props) {
  const shown = status ?? user?.status ?? 'online';
  const letter = (user?.name ?? '?').trim().charAt(0).toUpperCase() || '?';
  const dot = Math.max(10, Math.round(size * 0.31));
  const source = user?.avatarUrl ? mediaSource(user.avatarUrl) : undefined;
  return (
    <View style={{ width: size, height: size }}>
      <View
        style={{
          width: size, height: size, borderRadius: size / 2, alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
          backgroundColor: user?.color ?? '#fff', opacity: dimmed ? 0.35 : 1,
        }}
      >
        {source ? (
          <Image source={source} style={StyleSheet.absoluteFill} cachePolicy="memory-disk" recyclingKey={user?.id} contentFit="cover" transition={120} />
        ) : (
          <Text style={{ fontSize: size * 0.42, fontWeight: '500', color: '#fff' }}>{letter}</Text>
        )}
      </View>
      {speaking && <View pointerEvents="none" style={{ position: 'absolute', left: -4, top: -4, right: -4, bottom: -4, borderRadius: size, borderWidth: 2, borderColor: colors.success }} />}
      {online && (
        // The gap around the dot is a 3px ring of the background it sits on.
        <View style={{ position: 'absolute', right: -5, bottom: -5, width: dot + 6, height: dot + 6, borderRadius: (dot + 6) / 2, backgroundColor: ringBg, alignItems: 'center', justifyContent: 'center' }}>
          <View
            style={{
              width: dot, height: dot, borderRadius: dot / 2, alignItems: 'center', justifyContent: 'center',
              backgroundColor: shown === 'dnd' ? colors.danger : shown === 'invisible' ? ringBg : colors.success,
              borderWidth: shown === 'invisible' ? Math.max(2, Math.round(dot / 4)) : 0, borderColor: '#8e8e93',
            }}
          >
            {shown === 'dnd' && <View style={{ width: dot * 0.5, height: Math.max(2, dot * 0.16), borderRadius: 2, backgroundColor: ringBg }} />}
          </View>
        </View>
      )}
    </View>
  );
});

/** A DM shows the other person; a group shows two of its members overlapping. */
export function DmAvatar({ dm, size = 32, online, ringBg = colors.window }: { dm: Dm; size?: number; online?: boolean; ringBg?: string }) {
  const users = useStore((s) => s.users);
  const meId = useStore((s) => s.data?.me.id);
  if (dm.kind === 'dm') return <Avatar user={users[dm.userId ?? '']} size={size} online={online} ringBg={ringBg} />;
  const [first, second] = dm.members.filter((id) => id !== meId);
  const small = Math.round(size * 0.68);
  return (
    <View style={{ width: size, height: size }}>
      <View style={{ position: 'absolute', left: 0, top: 0 }}><Avatar user={users[first ?? '']} size={small} ringBg={ringBg} /></View>
      <View style={{ position: 'absolute', right: 0, bottom: 0, borderRadius: small, borderWidth: 2, borderColor: ringBg }}>
        <Avatar user={users[second ?? first ?? '']} size={small} ringBg={ringBg} />
      </View>
    </View>
  );
}
