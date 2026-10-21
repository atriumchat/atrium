import { useState } from 'react';
import { ActivityIndicator, Pressable } from 'react-native';
import { api } from '../api';
import { showError, useStore } from '../store';
import { useT } from '../i18n';
import { Text } from '../text';

/** Add / accept / cancel / remove, depending on the current relationship. */
export function FriendButton({ userId, name, flex = true }: { userId: string; name: string; flex?: boolean }) {
  const { t } = useT();
  const status = useStore((s) => s.friends.find((f) => f.userId === userId)?.status);
  const [busy, setBusy] = useState(false);
  async function run(action: () => Promise<never[] | unknown>) {
    setBusy(true);
    try { useStore.setState({ friends: (await action()) as never }); }
    catch (e) { showError(e instanceof Error ? e.message : t('people.failed')); }
    finally { setBusy(false); }
  }
  const primary = status === 'incoming';
  const label = status === 'friend' ? t('people.profile.removeFriend') : status === 'incoming' ? t('people.profile.acceptRequest') : status === 'outgoing' ? t('people.friends.cancelRequest') : t('people.friends.add');
  const action = () => run(() => (status === 'incoming' ? api.acceptFriend(userId) : status === 'friend' || status === 'outgoing' ? api.removeFriend(userId) : api.addFriend(name)));
  return (
    <Pressable accessibilityRole="button" disabled={busy} onPress={() => void action()} style={({ pressed }) => ({ flex: flex ? 1 : undefined, height: 40, borderRadius: 20, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: primary ? '#fff' : pressed ? 'rgba(255,255,255,0.13)' : 'rgba(255,255,255,0.08)' })}>
      {busy ? <ActivityIndicator color={primary ? '#000' : '#fff'} /> : <Text numberOfLines={1} style={{ fontSize: 15, fontWeight: '500', color: primary ? '#000' : '#fff' }}>{label}</Text>}
    </Pressable>
  );
}
