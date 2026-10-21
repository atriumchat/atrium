import { useEffect, useState } from 'react';
import { View } from 'react-native';
import Animated, { Easing, LayoutAnimationConfig, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming, cancelAnimation } from 'react-native-reanimated';
import { appear, move, vanish } from '../motion';
import { useStore } from '../store';
import { Text } from '../text';
import { colors } from '../theme';
import { Avatar } from '../components/Avatar';
import { HeadphonesSlashIcon, MicSlashIcon } from '../icons';

export type BubblePerson = { id: string; muted?: boolean; deafened?: boolean; /** Being rung, not in the call yet: drawn faded. */ ringing?: boolean };
const GAP = 16;
/** Room under each circle for the name. */
const LABEL = 26;

/**
 * People in a call drawn as photo circles with their names: everyone in a centred grid that reflows smoothly
 * when someone comes or goes. Whoever talks grows a hair, a faint green ring breathes out of them, and their name lights up.
 */
/** `note`: a quiet line right under the circles ("you're the only one here"). */
export function Bubbles({ people, speaking, note }: { people: BubblePerson[]; speaking: string[]; note?: string }) {
  const [box, setBox] = useState({ w: 0, h: 0 });
  const n = Math.max(1, people.length);
  // The biggest circle that fits n of them (with their names) in the box, in as many columns as work best.
  let size = 0;
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    size = Math.max(size, Math.min((box.w - GAP * (cols - 1)) / cols, (box.h - (note ? 40 : 0) - GAP * (rows - 1)) / rows - LABEL));
  }
  size = Math.max(0, Math.min(size * 0.86, 152));
  return (
    <View onLayout={(e) => setBox({ w: e.nativeEvent.layout.width - 32, h: e.nativeEvent.layout.height - 32 })} style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      {/* Mounted with the first circles: those are just there; only someone who comes in later fades in. */}
      {size > 0 ? (
        <LayoutAnimationConfig skipEntering>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', alignContent: 'center', gap: GAP, maxWidth: box.w }}>
            {people.map((p) => <Bubble key={p.id} person={p} size={size} speaking={speaking.includes(p.id)} />)}
          </View>
          {note ? <Text style={{ marginTop: 12, textAlign: 'center', fontSize: 15, color: colors.muted }}>{note}</Text> : null}
        </LayoutAnimationConfig>
      ) : null}
    </View>
  );
}

function Bubble({ person, size, speaking }: { person: BubblePerson; size: number; speaking: boolean }) {
  const user = useStore((s) => s.users[person.id]);
  const scale = useSharedValue(1);
  const pulse = useSharedValue(0);
  const faded = useSharedValue(person.ringing ? 0.35 : 1);
  const on = useSharedValue(speaking ? 1 : 0);

  useEffect(() => {
    scale.value = withTiming(speaking ? 1.04 : 1, { duration: 180 });
    on.value = withTiming(speaking ? 1 : 0, { duration: 150 });
    if (speaking) pulse.value = withRepeat(withTiming(1, { duration: 1400, easing: Easing.out(Easing.quad) }), -1, false);
    else { cancelAnimation(pulse); pulse.value = withTiming(0, { duration: 200 }); }
  }, [speaking, scale, pulse, on]);
  // Someone being rung breathes in and out until they pick up.
  useEffect(() => {
    if (person.ringing) faded.value = withRepeat(withSequence(withTiming(0.7, { duration: 700 }), withTiming(0.3, { duration: 700 })), -1, false);
    else { cancelAnimation(faded); faded.value = withTiming(1, { duration: 250 }); }
  }, [person.ringing, faded]);

  const body = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }], opacity: faded.value }));
  const ring = useAnimatedStyle(() => ({ opacity: on.value * 0.5 * (1 - pulse.value), transform: [{ scale: 1 + pulse.value * 0.14 }] }));
  const solid = useAnimatedStyle(() => ({ opacity: on.value }));
  const off = person.deafened || person.muted;

  return (
    <Animated.View entering={appear} exiting={vanish} layout={move} style={{ width: size, alignItems: 'center' }}>
      <Animated.View style={[{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }, body]}>
        {/* The ring that pulses out of whoever talks, and a steady one right on the edge. */}
        <Animated.View pointerEvents="none" style={[{ position: 'absolute', width: size, height: size, borderRadius: size / 2, borderWidth: 3, borderColor: colors.success }, ring]} />
        <Avatar user={user} size={size} ringBg={colors.window} />
        <Animated.View pointerEvents="none" style={[{ position: 'absolute', width: size + 8, height: size + 8, borderRadius: (size + 8) / 2, borderWidth: 3, borderColor: colors.success }, solid]} />
        {off ? (
          <Animated.View entering={appear} exiting={vanish} style={{ position: 'absolute', right: size * 0.04, bottom: size * 0.04, width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.graphite, borderWidth: 2, borderColor: colors.window }}>
            {person.deafened ? <HeadphonesSlashIcon size={15} color={colors.danger} /> : <MicSlashIcon size={15} color={colors.danger} />}
          </Animated.View>
        ) : null}
      </Animated.View>
      <Animated.View style={{ height: LABEL, justifyContent: 'flex-end', maxWidth: size + GAP }}>
        <Text numberOfLines={1} style={{ fontSize: 15, fontWeight: speaking ? '600' : '500', color: speaking ? '#fff' : colors.muted }}>{user?.name ?? ''}</Text>
      </Animated.View>
    </Animated.View>
  );
}
