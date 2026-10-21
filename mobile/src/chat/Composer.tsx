import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import Animated from 'react-native-reanimated';
import { appear, vanish } from '../motion';
import { ActionSheetIOS, ActivityIndicator, Keyboard, Pressable, ScrollView, View } from 'react-native';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ask, receiveMessage, sendTyping, showError, useStore } from '../store';
import { uploadLocal } from '../files';
import { haptic } from '../haptics';
import { localeOf, t as tr, useT } from '../i18n';
import { Text, TextInput, type TextInputRef } from '../text';
import { colors } from '../theme';
import { Avatar } from '../components/Avatar';
import { RoundButton } from '../components/ui';
import { ArrowUpIcon, AtIcon, PaperclipIcon, PlusIcon, ReplyIcon, PencilIcon, XIcon } from '../icons';
import { fileSize, mentionsToNames, namesToMentions, plainText } from '../format';
import type { Message, Upload, User } from '../protocol';

const MAX_ATTACHMENTS = 10;
/** An attached picture or file: shown at once, sendable once the upload has finished. */
type PendingFile = { key: string; name: string; size: number; preview?: string; upload?: Upload };
type MentionOption = { id: string; label: string; user?: User };
export type ComposerHandle = { reply: (m: Message) => void; edit: (m: Message) => void };

export function Composer({ id, placeholder, isDm, composerRef, onSent }: { id: string; placeholder: string; isDm: boolean; composerRef: Ref<ComposerHandle>; onSent: () => void }) {
  const { t } = useT();
  const insets = useSafeAreaInsets();
  const users = useStore((s) => s.users);
  const [text, setText] = useState('');
  const [selection, setSelection] = useState(0);
  const [pending, setPending] = useState<PendingFile[]>([]);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [editing, setEditing] = useState<Message | null>(null);
  const [pick] = useState(0);
  const [busy, setBusy] = useState(false);
  const input = useRef<TextInputRef>(null);
  // Over the keyboard there is no home indicator to clear: the inset would leave a strip of empty space.
  const [keyboard, setKeyboard] = useState(false);
  useEffect(() => {
    const show = Keyboard.addListener('keyboardWillShow', () => setKeyboard(true));
    const hide = Keyboard.addListener('keyboardWillHide', () => setKeyboard(false));
    return () => { show.remove(); hide.remove(); };
  }, []);
  const uploading = pending.some((p) => !p.upload);
  const canSend = !busy && !uploading && (text.trim().length > 0 || pending.length > 0);

  useImperativeHandle(composerRef, () => ({
    reply: (m) => { setEditing(null); setReplyTo(m); input.current?.focus(); },
    edit: (m) => { setReplyTo(null); setEditing(m); setText(mentionsToNames(m.content, useStore.getState().users)); input.current?.focus(); },
  }));
  useEffect(() => { setText(''); setPending([]); setReplyTo(null); setEditing(null); }, [id]);

  // "@" right before the caret opens a list of people to mention.
  const mentionQuery = /(?:^|\s)@([^\s@]{0,32})$/.exec(text.slice(0, selection))?.[1];
  const options: MentionOption[] = mentionQuery === undefined ? [] : [
    ...Object.values(users).filter((u) => u.name.toLowerCase().startsWith(mentionQuery.toLowerCase())).sort((a, b) => a.name.localeCompare(b.name, localeOf())).slice(0, 6).map((u) => ({ id: u.id, label: u.name, user: u })),
    ...(tr('common.md.everyone').startsWith(mentionQuery.toLowerCase()) ? [{ id: 'all', label: tr('common.md.everyone') }] : []),
  ];
  function insertMention(o: MentionOption) {
    haptic.select();
    const before = text.slice(0, selection).replace(/@[^\s@]*$/, `@${o.label} `);
    setText(before + text.slice(selection));
    setSelection(before.length);
  }

  function addAssets(files: { uri: string; name: string; size: number; mimeType?: string | null; image?: boolean }[]) {
    const accepted = files.slice(0, Math.max(0, MAX_ATTACHMENTS - pending.length));
    if (accepted.length < files.length) showError(t('chat.maxAttachments', { n: MAX_ATTACHMENTS }));
    for (const f of accepted) {
      const key = `${Date.now()}-${Math.random()}`;
      setPending((list) => [...list, { key, name: f.name, size: f.size, preview: f.image ? f.uri : undefined }]);
      uploadLocal({ uri: f.uri, name: f.name, mimeType: f.mimeType }).then(
        (upload) => setPending((list) => list.map((p) => (p.key === key ? { ...p, upload } : p))),
        (e) => { showError(t('chat.uploadFailed', { name: f.name, error: e instanceof Error ? e.message : String(e) })); setPending((list) => list.filter((p) => p.key !== key)); },
      );
    }
  }
  async function fromLibrary() {
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, selectionLimit: MAX_ATTACHMENTS - pending.length, quality: 0.9 });
    if (!r.canceled) addAssets(r.assets.map((a) => ({ uri: a.uri, name: a.fileName ?? `photo-${Date.now()}.jpg`, size: a.fileSize ?? 0, mimeType: a.mimeType, image: true })));
  }
  async function fromCamera() {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return;
    const r = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.9 });
    if (!r.canceled) addAssets(r.assets.map((a) => ({ uri: a.uri, name: a.fileName ?? `photo-${Date.now()}.jpg`, size: a.fileSize ?? 0, mimeType: a.mimeType, image: true })));
  }
  async function fromFiles() {
    const r = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: true });
    if (!r.canceled) addAssets(r.assets.map((a) => ({ uri: a.uri, name: a.name, size: a.size ?? 0, mimeType: a.mimeType, image: a.mimeType?.startsWith('image/') })));
  }
  function attach() {
    const options = [tr('m.photoLibrary'), tr('m.takePhoto'), tr('m.file'), tr('common.cancel')];
    ActionSheetIOS.showActionSheetWithOptions({ options, cancelButtonIndex: 3, userInterfaceStyle: 'dark' }, (i) => {
      const job = i === 0 ? fromLibrary() : i === 1 ? fromCamera() : i === 2 ? fromFiles() : null;
      job?.catch(showError);
    });
  }

  async function send() {
    if (!canSend) return;
    const content = namesToMentions(text.trim(), users);
    if (editing) {
      if (!content && editing.attachments.length === 0) return showError(t('chat.emptyEdit'));
      setBusy(true);
      try { if (content !== editing.content) await ask('message:edit', { id: editing.id, content }); setEditing(null); setText(''); }
      catch (e) { showError(e); } finally { setBusy(false); }
      return;
    }
    const files = pending; const answering = replyTo;
    setBusy(true);
    try {
      const result = await ask<{ message: Message }>(isDm ? 'dm:send' : 'message:send', { [isDm ? 'dmId' : 'channelId']: id, content, attachments: files.map((p) => p.upload!.id), replyTo: answering?.id });
      receiveMessage(result.message);
      haptic.soft();
      setText(''); setPending([]); setReplyTo(null);
      onSent();
    } catch (e) { showError(e); } finally { setBusy(false); }
  }

  return (
    <View style={{ paddingHorizontal: 8, paddingTop: 4, paddingBottom: keyboard ? 8 : Math.max(8, insets.bottom) }}>
      {options.length > 0 ? (
        <Animated.View entering={appear} exiting={vanish} accessibilityRole="menu" style={{ position: 'absolute', bottom: '100%', left: 8, right: 8, zIndex: 20, borderRadius: 20, borderWidth: 0.5, borderColor: colors.border, backgroundColor: colors.graphite, padding: 6 }}>
          {options.map((o, i) => (
            <Pressable key={o.id} accessibilityRole="button" onPress={() => insertMention(o)} style={{ height: 40, flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 20, paddingHorizontal: 8, backgroundColor: i === pick ? 'rgba(255,255,255,0.1)' : 'transparent' }}>
              {o.user ? <Avatar user={o.user} size={26} ringBg={colors.graphite} /> : <View style={{ width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' }}><AtIcon size={15} color="#000" /></View>}
              <Text numberOfLines={1} style={{ fontSize: 16 }}>{o.label}</Text>
              {!o.user ? <Text style={{ fontSize: 14, color: colors.faint }}>{t('chat.mentionAll')}</Text> : null}
            </Pressable>
          ))}
        </Animated.View>
      ) : null}
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8 }}>
        <RoundButton label={t('chat.attachFile')} onPress={attach} disabled={!!editing} style={{ marginBottom: 4 }}>{(c) => <PlusIcon size={20} color={c} strokeWidth={2.5} />}</RoundButton>
        <View style={{ flex: 1, minWidth: 0, minHeight: 48, justifyContent: 'center', borderRadius: 24, backgroundColor: colors.graphite, paddingHorizontal: 20 }}>
          {replyTo || editing ? (
            <Animated.View entering={appear} exiting={vanish} style={{ marginHorizontal: -8, marginTop: 8, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.06)', paddingVertical: 6, paddingLeft: 12, paddingRight: 6 }}>
              {editing ? <PencilIcon size={15} color={colors.muted} /> : <ReplyIcon size={15} color={colors.muted} />}
              <Text numberOfLines={1} style={{ flex: 1, fontSize: 14, color: colors.muted }}>
                {editing ? t('chat.editMessage') : <>{t('chat.replyTo')} <Text style={{ fontWeight: '500', color: '#fff' }}>{users[replyTo!.userId]?.name ?? '…'}</Text>: {plainText(replyTo!.content, users) || t('chat.attachmentLower')}</>}
              </Text>
              <Pressable accessibilityRole="button" accessibilityLabel={t('chat.cancelReply')} hitSlop={8} onPress={() => { setReplyTo(null); if (editing) { setEditing(null); setText(''); } }} style={{ width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' }}><XIcon size={14} color={colors.muted} strokeWidth={2.5} /></Pressable>
            </Animated.View>
          ) : null}
          {pending.length > 0 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingTop: 16, paddingBottom: 4 }} style={{ marginHorizontal: -4 }}>
              {pending.map((p) => (
                <View key={p.key} style={[{ overflow: 'hidden', backgroundColor: colors.window }, p.preview ? { width: 96, height: 96, borderRadius: 14 } : { width: 176, height: 96, borderRadius: 18, justifyContent: 'center', gap: 4, paddingHorizontal: 12 }]}>
                  {p.preview ? <Image source={{ uri: p.preview }} contentFit="cover" style={{ width: '100%', height: '100%', opacity: p.upload ? 1 : 0.5 }} /> : (
                    <>
                      <PaperclipIcon size={18} color={colors.muted} />
                      <Text numberOfLines={1} style={{ fontSize: 14 }}>{p.name}</Text>
                      <Text style={{ fontSize: 13, color: colors.faint }}>{fileSize(p.size)}</Text>
                    </>
                  )}
                  {!p.upload ? <View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.3)' }}><ActivityIndicator color="#fff" /></View> : null}
                  <Pressable accessibilityRole="button" accessibilityLabel={t('chat.removeFile', { name: p.name })} onPress={() => setPending((l) => l.filter((x) => x.key !== p.key))} style={{ position: 'absolute', right: 4, top: 4, width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.6)' }}><XIcon size={14} strokeWidth={3} /></Pressable>
                </View>
              ))}
            </ScrollView>
          ) : null}
          <TextInput
            ref={input}
            multiline
            value={text}
            onChangeText={(v) => { setText(v); if (!editing) sendTyping(id); }}
            onSelectionChange={(e) => setSelection(e.nativeEvent.selection.end)}
            placeholder={placeholder}
            accessibilityLabel={placeholder}
            style={{ maxHeight: 220, minHeight: 48, paddingTop: 13, paddingBottom: 13, fontSize: 17, lineHeight: 22, color: '#fff' }}
          />
        </View>
        <RoundButton tone={canSend ? 'accent' : 'plain'} label={t('chat.send')} disabled={!canSend} onPress={() => void send()} style={{ marginBottom: 4 }}>{(c) => <ArrowUpIcon size={20} color={c} strokeWidth={2.5} />}</RoundButton>
      </View>
    </View>
  );
}
