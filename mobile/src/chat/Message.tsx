import { memo, useState } from 'react';
import { useRef } from 'react';
import Animated from 'react-native-reanimated';
import { appear, move } from '../motion';
import { ActionSheetIOS, Alert, Pressable, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { ask, showError, useStore } from '../store';
import { haptic } from '../haptics';
import { useT } from '../i18n';
import { Text } from '../text';
import { colors } from '../theme';
import { Avatar } from '../components/Avatar';
import { SmileIcon } from '../icons';
import { invitedRoom, plainText, timeOf } from '../format';
import { openProfile } from '../nav';
import { Markdown } from './Markdown';
import { Press } from '../components/ui';
import { MessageAttachments } from './Attachments';
import { RoomCard } from './RoomCard';
import type { Message } from '../protocol';

const QUICK_REACTIONS = ['👍', '❤️', '😂', '🔥', '😮', '🎉'];
const EMOJI_ONLY = /^(?:\p{Extended_Pictographic}|\p{Emoji_Modifier}|\p{Regional_Indicator}|‍|️|\s)+$/u;
const HAS_PICTO = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u;
const isEmojiOnly = (text: string) => { const s = text.trim(); return s.length > 0 && s.length <= 16 && EMOJI_ONLY.test(s) && HAS_PICTO.test(s); };

export const toggleReaction = (messageId: string, emoji: string) => { haptic.select(); void ask('reaction:toggle', { messageId, emoji }).catch(showError); };

type Props = { message: Message; startsGroup: boolean; onReply: (m: Message) => void; onEdit: (m: Message) => void };

/**
 * Messages from someone you blocked stay folded into one quiet line, unless you open them. Memoised: a new message,
 * edit or reaction only re-renders its own row (message objects stay the same unless they change).
 */
export const MessageRow = memo(function MessageRow(props: Props) {
  const { t } = useT();
  const blocked = useStore((s) => s.data?.blocked.includes(props.message.userId));
  const [shown, setShown] = useState(false);
  if (blocked && !shown) {
    return (
      <Text style={{ paddingVertical: 4, paddingLeft: 68, paddingRight: 16, fontSize: 14, color: colors.faint }}>
        {t('chat.blocked.label')} · <Text style={{ color: colors.muted }} onPress={() => setShown(true)}>{t('chat.blocked.show')}</Text>
      </Text>
    );
  }
  return <MessageBody {...props} />;
});

function MessageBody({ message, startsGroup, onReply, onEdit }: Props) {
  const { t } = useT();
  const user = useStore((s) => s.users[message.userId]);
  const meId = useStore((s) => s.data?.me.id);
  const isAdmin = useStore((s) => s.data?.canManageChannels);
  const mine = message.userId === meId;
  const canDelete = mine || (!message.dm && !!isAdmin);
  const canEdit = mine && !invitedRoom(message.content);
  // A reply always shows who wrote it, like Discord, even in the middle of someone's run of messages.
  const showHeader = startsGroup || !!message.replyTo;
  const big = !message.replyTo && isEmojiOnly(message.content);
  // Only a message that just arrived rises in (the inverted list makes it come up from the composer); history doesn't.
  const fresh = Date.now() - message.createdAt < 4000;

  // Long-press opens the native action sheet; "React" opens a second one with the quick reactions.
  function react() {
    const options = [...QUICK_REACTIONS, t('common.cancel')];
    ActionSheetIOS.showActionSheetWithOptions({ options, cancelButtonIndex: options.length - 1, userInterfaceStyle: 'dark' }, (i) => { const e = QUICK_REACTIONS[i]; if (e) toggleReaction(message.id, e); });
  }
  function actions() {
    haptic.firm();
    const items: [string, () => void, boolean?][] = [
      [t('chat.addReaction'), react],
      [t('chat.reply'), () => onReply(message)],
      ...(message.content ? [[t('common.copy.label'), () => void Clipboard.setStringAsync(mentionless(message.content)).then(haptic.success)] as [string, () => void]] : []),
      ...(canEdit ? [[t('chat.edit'), () => onEdit(message)] as [string, () => void]] : []),
      ...(canDelete ? [[t('chat.delete'), () => Alert.alert(t('chat.deleteTitle'), t('chat.deleteText'), [{ text: t('common.cancel'), style: 'cancel' }, { text: t('chat.delete'), style: 'destructive', onPress: () => void ask('message:delete', { id: message.id }).catch(showError) }]), true] as [string, () => void, boolean]] : []),
    ];
    const options = [...items.map((i) => i[0]), t('common.cancel')];
    ActionSheetIOS.showActionSheetWithOptions({ options, cancelButtonIndex: options.length - 1, destructiveButtonIndex: items.findIndex((i) => i[2]) >= 0 ? items.findIndex((i) => i[2]) : undefined, userInterfaceStyle: 'dark' }, (i) => items[i]?.[1]());
  }
  function mentionless(text: string) { return plainText(text, useStore.getState().users); }

  return (
    <Animated.View entering={fresh ? appear : undefined}>
    <Pressable onLongPress={actions} delayLongPress={350} accessibilityActions={[{ name: 'reply', label: t('chat.reply') }]} onAccessibilityAction={() => onReply(message)}>
      <View style={{ paddingLeft: 68, paddingRight: 16, ...(showHeader ? { marginTop: 16, paddingVertical: 2 } : { paddingVertical: 2 }) }}>
        {message.replyTo ? <ReplyLine reply={message.replyTo} /> : null}
        {showHeader ? (
          <>
            <Pressable accessibilityRole="button" onPress={() => openProfile(message.userId)} style={{ position: 'absolute', left: 16, top: message.replyTo ? 28 : 4 }}><Avatar user={user} size={40} /></Pressable>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
              <Text onPress={() => openProfile(message.userId)} style={{ fontSize: 17, fontWeight: '500', lineHeight: 22 }}>{user?.name ?? t('chat.someone')}</Text>
              {/* Just the time: the day is on the divider above. */}
              <Text style={{ fontSize: 13, color: colors.faint }}>{timeOf(message.createdAt)}</Text>
            </View>
          </>
        ) : null}
        {message.content ? (
          invitedRoom(message.content) ? <RoomCard channelId={invitedRoom(message.content)!} /> : (
            <Markdown text={message.content} big={big} after={message.editedAt ? <Text style={{ fontSize: 12, color: colors.faint }}> ({t('chat.edited')})</Text> : null} />
          )
        ) : null}
        <MessageAttachments attachments={message.attachments} />
        <Reactions message={message} meId={meId} />
      </View>
    </Pressable>
    </Animated.View>
  );
}

/** The answered message above a reply: who and what, in one faint line. */
function ReplyLine({ reply }: { reply: NonNullable<Message['replyTo']> }) {
  const { t } = useT();
  const users = useStore((s) => s.users);
  const author = reply.deleted ? undefined : users[reply.userId];
  const text = reply.deleted ? t('chat.messageDeleted') : plainText(reply.content, users) || (reply.attachments ? t('chat.attachment') : '');
  return (
    <View style={{ marginBottom: 2, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      {/* The little spine from the avatar up to the line, as in Discord. */}
      <View style={{ position: 'absolute', left: -46, top: 9, width: 34, height: 12, borderTopLeftRadius: 8, borderLeftWidth: 2, borderTopWidth: 2, borderColor: 'rgba(255,255,255,0.15)' }} />
      {author ? <Avatar user={author} size={16} /> : null}
      {author ? <Text style={{ fontSize: 15, fontWeight: '500', color: 'rgba(255,255,255,0.8)' }}>{author.name}</Text> : null}
      <Text numberOfLines={1} style={{ flex: 1, fontSize: 15, color: colors.muted, fontStyle: reply.deleted ? 'italic' : 'normal' }}>{text}</Text>
    </View>
  );
}

function Reactions({ message, meId }: { message: Message; meId: string | undefined }) {
  const { t } = useT();
  const users = useStore((s) => s.users);
  const reactions = message.reactions ?? [];
  // Chips already there when the row appeared (scrolling, opening the chat) just are; only a new one fades in.
  const seen = useRef(new Set(reactions.map((r) => r.emoji)));
  if (reactions.length === 0) return null;
  return (
    <View style={{ marginTop: 4, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 4 }}>
      {reactions.map((r) => {
        const mine = !!meId && r.users.includes(meId);
        const who = r.users.map((id) => users[id]?.name ?? '…').join(', ');
        return (
          <Animated.View key={r.emoji} entering={seen.current.has(r.emoji) ? undefined : appear} layout={move}>
          <Press scaleTo={0.94} accessibilityRole="button" accessibilityLabel={`${r.emoji} ${r.users.length}: ${who}`} accessibilityState={{ selected: mine }} onPress={() => toggleReaction(message.id, r.emoji)} style={{ height: 28, flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 14, paddingHorizontal: 8, backgroundColor: mine ? '#fff' : 'rgba(255,255,255,0.16)' }}>
            <Text style={{ fontSize: 16 }}>{r.emoji}</Text>
            <Text style={{ fontSize: 14, fontWeight: mine ? '500' : '400', color: mine ? '#000' : '#fff', fontVariant: ['tabular-nums'] }}>{r.users.length}</Text>
          </Press>
          </Animated.View>
        );
      })}
      <Pressable accessibilityRole="button" accessibilityLabel={t('chat.addReaction')} onPress={() => { const options = [...QUICK_REACTIONS, t('common.cancel')]; ActionSheetIOS.showActionSheetWithOptions({ options, cancelButtonIndex: options.length - 1, userInterfaceStyle: 'dark' }, (i) => { const e = QUICK_REACTIONS[i]; if (e) toggleReaction(message.id, e); }); }} style={{ width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.graphite }}><SmileIcon size={15} color={colors.muted} /></Pressable>
    </View>
  );
}
