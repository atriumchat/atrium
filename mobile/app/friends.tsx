import { useState, type ReactNode } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { api } from '../src/api';
import { messageUser, showError, useStore } from '../src/store';
import { useT } from '../src/i18n';
import { Text, TextInput } from '../src/text';
import { colors } from '../src/theme';
import { Avatar } from '../src/components/Avatar';
import { FriendButton } from '../src/components/FriendButton';
import { EmptyState } from '../src/components/LineArt';
import { RoundButton } from '../src/components/ui';
import { BubbleIcon, CheckIcon, UserPlusIcon, XIcon } from '../src/icons';
import { BackButton } from '../src/chat/Header';
import { CallBar } from '../src/shell/CallPill';
import { openChat, openProfile } from '../src/nav';
import { haptic } from '../src/haptics';
import type { ArtName } from '../src/art.generated';
import type { Friend, User } from '../src/protocol';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type Tab = 'online' | 'all' | 'pending' | 'add';

export default function Friends() {
  const { t } = useT();
  const insets = useSafeAreaInsets();
  const friends = useStore((s) => s.friends);
  const online = useStore((s) => s.online);
  const incoming = friends.filter((f) => f.status === 'incoming').length;
  const [tab, setTab] = useState<Tab>(incoming > 0 ? 'pending' : 'online');
  const accepted = friends.filter((f) => f.status === 'friend');
  const onlineFriends = accepted.filter((f) => online.includes(f.userId));
  const pending = friends.filter((f) => f.status !== 'friend');
  const tabButton = (id: Tab, label: ReactNode) => (
    <Pressable key={id} accessibilityRole="tab" accessibilityState={{ selected: tab === id }} onPress={() => { haptic.select(); setTab(id); }} style={{ height: 36, borderRadius: 18, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: tab === id ? 'rgba(255,255,255,0.1)' : 'transparent' }}>
      {typeof label === 'string' ? <Text style={{ fontSize: 15, color: tab === id ? '#fff' : colors.muted }}>{label}</Text> : label}
    </Pressable>
  );
  return (
    <View style={{ flex: 1, backgroundColor: colors.window, paddingTop: insets.top }}>
      <CallBar />
      {/* The title row with "add" as a round button, the tabs on their own row underneath. */}
      <View style={{ marginHorizontal: 8, marginTop: 8, borderRadius: 24, backgroundColor: colors.graphite, padding: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <BackButton />
          <Text style={{ flex: 1, fontSize: 17, fontWeight: '500' }}>{t('people.friends.title')}</Text>
          <RoundButton label={t('people.friends.add')} tone={tab === 'add' ? 'on' : 'plain'} onPress={() => setTab('add')}>{(c) => <UserPlusIcon size={20} color={c} />}</RoundButton>
        </View>
        <View style={{ marginTop: 4, flexDirection: 'row', gap: 4 }}>
          {tabButton('online', t('people.friends.online'))}
          {tabButton('all', t('people.friends.all'))}
          {tabButton('pending', <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}><Text style={{ fontSize: 15, color: tab === 'pending' ? '#fff' : colors.muted }}>{t('people.friends.requests')}</Text>{incoming > 0 ? <View style={{ minWidth: 20, height: 20, paddingHorizontal: 6, borderRadius: 10, backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center' }}><Text style={{ fontSize: 12, fontWeight: '500', lineHeight: 20 }}>{incoming}</Text></View> : null}</View>)}
        </View>
      </View>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 4, paddingTop: 12, paddingBottom: Math.max(16, insets.bottom) }}>
        {tab === 'add' ? <AddFriend /> : tab === 'pending' ? (
          <FriendList title={t('people.friends.requestsTitle', { n: pending.length })} friends={pending} empty={['mailbox', t('people.friends.emptyRequests'), t('people.friends.emptyRequestsText')]} />
        ) : tab === 'all' ? (
          <FriendList title={t('people.friends.allTitle', { n: accepted.length })} friends={accepted} empty={['couch', t('people.friends.emptyFriends'), t('people.friends.emptyFriendsText')]} />
        ) : (
          <FriendList title={t('people.friends.onlineTitle', { n: onlineFriends.length })} friends={onlineFriends} empty={accepted.length ? ['away', t('people.friends.emptyOnline'), t('people.friends.emptyOnlineText')] : ['couch', t('people.friends.emptyFriends'), t('people.friends.emptyFriendsText')]} />
        )}
      </ScrollView>
    </View>
  );
}

function FriendList({ title, friends, empty }: { title: string; friends: Friend[]; empty: [ArtName, string, string] }) {
  if (friends.length === 0) return <EmptyState art={empty[0]} title={empty[1]} text={empty[2]} fill />;
  return (
    <View>
      <Text style={{ paddingHorizontal: 12, paddingBottom: 4, fontSize: 13, color: colors.faint }}>{title}</Text>
      {friends.map((f) => <FriendRow key={f.userId} friend={f} />)}
    </View>
  );
}

function FriendRow({ friend }: { friend: Friend }) {
  const { t } = useT();
  const user = useStore((s) => s.users[friend.userId]);
  const online = useStore((s) => s.online.includes(friend.userId));
  const room = useStore((s) => {
    const e = s.voice.find((v) => v.userId === friend.userId && v.kind === 'channel');
    const r = e && s.data?.channels.find((c) => c.id === e.channelId);
    return r ? { name: r.name } : null;
  });
  const [busy, setBusy] = useState(false);
  async function run(action: () => Promise<Friend[]>) {
    setBusy(true);
    try { useStore.setState({ friends: await action() }); haptic.success(); } catch (e) { showError(e instanceof Error ? e.message : t('people.failed')); } finally { setBusy(false); }
  }
  const subtitle = friend.status === 'incoming' ? t('people.friends.incoming') : friend.status === 'outgoing' ? t('people.friends.outgoing') : online ? t('people.friends.online') : t('people.friends.offline');
  return (
    <View style={{ height: 64, flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 32, paddingLeft: 8, paddingRight: 12 }}>
      <Pressable accessibilityRole="button" onPress={() => openProfile(friend.userId)} style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 4 }}>
        <Avatar user={user} size={40} online={online} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={{ fontSize: 16, fontWeight: '500' }}>{user?.name ?? '…'}</Text>
          <Text numberOfLines={1} style={{ fontSize: 14, color: friend.status === 'friend' && room ? colors.others : colors.muted }}>{friend.status === 'friend' && room ? room.name : subtitle}</Text>
        </View>
      </Pressable>
      {friend.status === 'friend' ? <RoundButton label={t('people.friends.message')} onPress={() => void messageUser(friend.userId).then((dm) => dm && openChat(dm.id))}>{(c) => <BubbleIcon size={20} color={c} />}</RoundButton> : null}
      {friend.status === 'incoming' ? (
        <>
          <RoundButton label={t('people.friends.accept')} disabled={busy} onPress={() => void run(() => api.acceptFriend(friend.userId))}>{() => <CheckIcon size={20} color={colors.success} />}</RoundButton>
          <RoundButton label={t('people.friends.decline')} disabled={busy} onPress={() => void run(() => api.removeFriend(friend.userId))}>{() => <XIcon size={20} color={colors.danger} />}</RoundButton>
        </>
      ) : null}
      {friend.status === 'outgoing' ? <RoundButton label={t('people.friends.cancelRequest')} disabled={busy} onPress={() => void run(() => api.removeFriend(friend.userId))}>{() => <XIcon size={20} color={colors.danger} />}</RoundButton> : null}
    </View>
  );
}

function AddFriend() {
  const { t } = useT();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const users = useStore((s) => s.users);
  const meId = useStore((s) => s.data?.me.id);
  const friends = useStore((s) => s.friends);
  const known = new Set(friends.filter((f) => f.status === 'friend').map((f) => f.userId));
  const people = Object.values(users).filter((u: User) => u.id !== meId && !known.has(u.id)).sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  async function submit() {
    if (!name.trim()) return;
    setBusy(true); setResult(null);
    try { useStore.setState({ friends: await api.addFriend(name) }); setResult({ ok: true, text: t('people.friends.sent', { name: name.trim() }) }); setName(''); }
    catch (e) { setResult({ ok: false, text: e instanceof Error ? e.message : t('people.failed') }); }
    finally { setBusy(false); }
  }
  return (
    <View style={{ paddingHorizontal: 12 }}>
      <Text style={{ fontSize: 17, fontWeight: '500' }}>{t('people.friends.add')}</Text>
      <Text style={{ marginTop: 4, fontSize: 15, color: colors.muted }}>{t('people.friends.hint')}</Text>
      <View style={{ marginTop: 12, height: 56, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 28, backgroundColor: colors.graphite, paddingLeft: 20, paddingRight: 8 }}>
        <TextInput value={name} onChangeText={setName} maxLength={32} placeholder={t('people.friends.nickPlaceholder')} accessibilityLabel={t('people.friends.nickLabel')} autoCapitalize="none" autoCorrect={false} returnKeyType="send" onSubmitEditing={() => void submit()} style={{ flex: 1, fontSize: 17, color: '#fff', height: 56 }} />
        <Pressable accessibilityRole="button" disabled={busy || !name.trim()} onPress={() => void submit()} style={{ height: 40, borderRadius: 20, paddingHorizontal: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: name.trim() ? '#fff' : colors.tertiary }}><Text style={{ fontSize: 16, fontWeight: '500', color: name.trim() ? '#000' : colors.faint }}>{t('people.friends.send')}</Text></Pressable>
      </View>
      {result ? <Text style={{ marginTop: 8, fontSize: 15, color: result.ok ? colors.success : colors.danger }}>{result.text}</Text> : null}
      {people.length > 0 ? (
        <View style={{ marginTop: 32 }}>
          <Text style={{ paddingBottom: 8, fontSize: 13, color: colors.faint }}>{t('people.friends.onServer')}</Text>
          {people.map((u) => (
            <View key={u.id} style={{ height: 56, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Pressable accessibilityRole="button" onPress={() => openProfile(u.id)} style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 12 }}><Avatar user={u} size={36} /><Text numberOfLines={1} style={{ flex: 1, fontSize: 16, fontWeight: '500' }}>{u.name}</Text></Pressable>
              <View style={{ width: 144 }}><FriendButton userId={u.id} name={u.name} /></View>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}
