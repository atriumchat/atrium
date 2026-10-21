import { Fragment, useState, type ReactNode } from 'react';
import { ActionSheetIOS, ActivityIndicator, Alert, Pressable, ScrollView, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api, mediaSource } from '../../src/api';
import { messageUser, showError, useStore } from '../../src/store';
import { joinVoice } from '../../src/voice';
import { haptic } from '../../src/haptics';
import { useT } from '../../src/i18n';
import { Text } from '../../src/text';
import { colors } from '../../src/theme';
import { Avatar } from '../../src/components/Avatar';
import { Press, tap } from '../../src/components/ui';
import { BubbleIcon, CheckIcon, ChevronRightIcon, PhoneIcon, UserPlusIcon } from '../../src/icons';
import { dateOnly } from '../../src/format';
import { openChat, openRoom } from '../../src/nav';
import type { Friend } from '../../src/protocol';

/**
 * A person's card, as a native sheet, top to bottom: who they are and where they are now; what you can do (write,
 * call, the friendship) as three equal tiles; what there is to know about them in one group; and blocking, apart at
 * the foot, so it is never pressed on the way to something else.
 */
export default function UserSheet() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useT();
  const insets = useSafeAreaInsets();
  const user = useStore((s) => s.users[id]);
  const inviter = useStore((s) => (s.users[id]?.invitedBy ? s.users[s.users[id]!.invitedBy!] : undefined));
  const isMe = useStore((s) => s.data?.me.id === id);
  const online = useStore((s) => s.online.includes(id));
  const blocked = useStore((s) => !!s.data?.blocked.includes(id));
  const room = useStore((s) => { const e = s.voice.find((v) => v.userId === id); return e ? s.data?.channels.find((c) => c.id === e.channelId)?.name : undefined; });
  if (!user) return null;

  async function block(action: () => Promise<string[]>) {
    try { const list = await action(); useStore.setState((s) => ({ data: s.data ? { ...s.data, blocked: list } : null })); haptic.warning(); } catch (e) { showError(e instanceof Error ? e.message : t('people.failed')); }
  }
  /** Opens your DM with them, then `then` with it. Every sheet closes first (this card may sit on a group's). */
  async function inDm(then: (dmId: string) => void) {
    const dm = await messageUser(id);
    if (!dm) return;
    router.dismissAll();
    setTimeout(() => then(dm.id), 50);
  }
  const presence = room ? t('people.profile.inRoom', { room }) : online ? (user.status === 'dnd' ? t('people.profile.dnd') : t('people.profile.online')) : t('people.profile.offline');
  const dot = room || (online && user.status !== 'dnd') ? colors.success : online ? colors.danger : colors.faint;
  const banner = user.avatarUrl ? mediaSource(user.avatarUrl) : undefined;

  return (
    <ScrollView style={{ backgroundColor: colors.overlay }} contentContainerStyle={{ paddingBottom: Math.max(24, insets.bottom) }}>
      {/* Their own photo, blurred down to a mood; graphite when there's no photo. */}
      <View style={{ height: 112, overflow: 'hidden', backgroundColor: colors.tertiary }}>
        {banner ? <Image source={banner} blurRadius={40} contentFit="cover" style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, opacity: 0.7, transform: [{ scale: 1.5 }] }} /> : null}
      </View>

      <View style={{ alignItems: 'center', paddingHorizontal: 20 }}>
        <View style={{ marginTop: -56, borderRadius: 60, padding: 6, backgroundColor: colors.overlay }}>
          <Avatar user={user} size={104} ringBg={colors.overlay} />
        </View>
        <Text numberOfLines={1} style={{ marginTop: 8, maxWidth: '100%', fontSize: 26, fontWeight: '700', lineHeight: 32 }}>{user.name}</Text>
        <View style={{ marginTop: 4, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: dot }} />
          <Text style={{ fontSize: 15, color: room ? colors.success : colors.muted }}>{presence}</Text>
        </View>
        {!isMe && user.statusText ? <Text style={{ marginTop: 8, fontSize: 16, lineHeight: 22, textAlign: 'center' }}>{user.statusText}</Text> : null}
      </View>

      <View style={{ paddingHorizontal: 16, paddingTop: 20, gap: 16 }}>
        {isMe ? (
          <Card>
            <Pressable accessibilityRole="button" onPress={() => { router.back(); setTimeout(() => router.push('/you/profile'), 50); }} style={({ pressed }) => ({ minHeight: 52, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, backgroundColor: pressed ? 'rgba(255,255,255,0.05)' : 'transparent' })}>
              <Text style={{ flex: 1, fontSize: 17 }}>{t('m.editProfile')}</Text>
              <ChevronRightIcon size={18} color={colors.faint} />
            </Pressable>
          </Card>
        ) : (
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Tile label={t('people.friends.message')} disabled={blocked} onPress={() => void inDm(openChat)}>{(c) => <BubbleIcon size={22} color={c} />}</Tile>
            <Tile label={t('voice.call.start')} disabled={blocked} onPress={() => void inDm((dmId) => { void joinVoice(dmId); openRoom(dmId); })}>{(c) => <PhoneIcon size={22} color={c} />}</Tile>
            <FriendTile userId={id} name={user.name} disabled={blocked} />
          </View>
        )}

        <Card>
          <Field label={t('people.profile.about')}>
            {user.bio ? <Text style={{ fontSize: 17, lineHeight: 23 }}>{user.bio}</Text> : <Text style={{ fontSize: 17, color: colors.muted }}>{t('people.profile.noBio')}</Text>}
          </Field>
          <Field label={t('people.profile.since')}>
            <Text style={{ fontSize: 17 }}>{dateOnly(user.createdAt, { day: 'numeric', month: 'long', year: 'numeric' })}</Text>
          </Field>
          {inviter ? (
            // Their inviter's card, in place of this one.
            <Field label={t('people.profile.invitedBy')} onPress={() => router.setParams({ id: inviter.id })}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Avatar user={inviter} size={24} ringBg={colors.graphite} />
                <Text numberOfLines={1} style={{ flex: 1, fontSize: 17 }}>{inviter.name}</Text>
              </View>
            </Field>
          ) : null}
        </Card>

        {!isMe ? (
          <Card>
            <Pressable
              accessibilityRole="button"
              onPress={() => (blocked ? void block(() => api.unblock(id)) : Alert.alert(t('people.profile.blockTitle', { name: user.name }), t('people.profile.blockText'), [{ text: t('common.cancel'), style: 'cancel' }, { text: t('people.profile.block'), style: 'destructive', onPress: () => void block(() => api.block(id)) }]))}
              style={({ pressed }) => ({ minHeight: 52, justifyContent: 'center', paddingHorizontal: 16, backgroundColor: pressed ? 'rgba(255,255,255,0.05)' : 'transparent' })}
            >
              <Text style={{ fontSize: 17, color: blocked ? '#fff' : colors.danger }}>{blocked ? t('people.profile.unblock') : t('people.profile.block')}</Text>
            </Pressable>
          </Card>
        ) : null}
      </View>
    </ScrollView>
  );
}

/** A rounded graphite group, its rows split by hairlines. */
function Card({ children }: { children: ReactNode }) {
  const rows = (Array.isArray(children) ? children : [children]).filter(Boolean);
  return (
    <View style={{ overflow: 'hidden', borderRadius: 20, backgroundColor: colors.graphite }}>
      {rows.map((row, i) => (
        <Fragment key={i}>
          {i ? <View style={{ height: 0.5, marginLeft: 16, backgroundColor: 'rgba(255,255,255,0.08)' }} /> : null}
          {row}
        </Fragment>
      ))}
    </View>
  );
}

/** A fact about them: its name small and grey, the fact under it, as in Contacts. */
function Field({ label, children, onPress }: { label: string; children: ReactNode; onPress?: () => void }) {
  const body = (
    <>
      <Text style={{ fontSize: 14, color: colors.muted }}>{label}</Text>
      <View style={{ marginTop: 2 }}>{children}</View>
    </>
  );
  const style = { paddingHorizontal: 16, paddingVertical: 12 };
  if (!onPress) return <View style={style}>{body}</View>;
  return <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [style, pressed && { backgroundColor: 'rgba(255,255,255,0.05)' }]}>{body}</Pressable>;
}

/** One of the three actions under the name: an icon over its word, all three the same size. */
function Tile({ label, onPress, children, disabled, accent, busy }: { label: string; onPress: () => void; children: (color: string) => ReactNode; disabled?: boolean; accent?: boolean; busy?: boolean }) {
  const fg = accent ? '#0b0b0c' : '#fff';
  return (
    <Press scaleTo={0.94}
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled || busy}
      onPress={() => { tap(); onPress(); }}
      style={({ pressed }) => ({ flex: 1, height: 72, borderRadius: 18, alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: accent ? (pressed ? '#e7e7ea' : '#fff') : pressed ? colors.hover : colors.graphite, opacity: disabled ? 0.4 : 1 })}
    >
      {busy ? <ActivityIndicator color={fg} /> : children(fg)}
      <Text numberOfLines={1} style={{ fontSize: 14, fontWeight: '500', color: fg }}>{label}</Text>
    </Press>
  );
}

/**
 * The friendship as a tile: "Add", "Accept" (white: it's waiting for you), or what already is — "Friends",
 * "Requested" — where undoing it asks first instead of happening on a stray tap.
 */
function FriendTile({ userId, name, disabled }: { userId: string; name: string; disabled?: boolean }) {
  const { t } = useT();
  const status = useStore((s) => s.friends.find((f) => f.userId === userId)?.status);
  const [busy, setBusy] = useState(false);
  async function run(action: () => Promise<Friend[]>) {
    setBusy(true);
    try { useStore.setState({ friends: await action() }); haptic.success(); } catch (e) { showError(e instanceof Error ? e.message : t('people.failed')); } finally { setBusy(false); }
  }
  function undo(title: string, action: string) {
    ActionSheetIOS.showActionSheetWithOptions({ title, options: [action, t('common.cancel')], destructiveButtonIndex: 0, cancelButtonIndex: 1, userInterfaceStyle: 'dark' }, (i) => { if (i === 0) void run(() => api.removeFriend(userId)); });
  }
  if (status === 'incoming') return <Tile label={t('people.friends.accept')} accent busy={busy} disabled={disabled} onPress={() => void run(() => api.acceptFriend(userId))}>{(c) => <CheckIcon size={22} color={c} />}</Tile>;
  if (status === 'friend') return <Tile label={t('m.isFriend')} busy={busy} disabled={disabled} onPress={() => undo(t('m.removeFriendTitle', { name }), t('people.profile.removeFriend'))}>{(c) => <CheckIcon size={22} color={c} />}</Tile>;
  if (status === 'outgoing') return <Tile label={t('m.requestSent')} busy={busy} disabled={disabled} onPress={() => undo(t('m.cancelRequestTitle', { name }), t('people.friends.cancelRequest'))}>{(c) => <UserPlusIcon size={22} color={c} />}</Tile>;
  return <Tile label={t('m.add')} busy={busy} disabled={disabled} onPress={() => void run(() => api.addFriend(name))}>{(c) => <UserPlusIcon size={22} color={c} />}</Tile>;
}
