import { useEffect, useState } from 'react';
import { ActionSheetIOS, Modal, Pressable, View } from 'react-native';
import { Image } from 'expo-image';
import { useReducedMotion } from 'react-native-reanimated';
import * as Clipboard from 'expo-clipboard';
import { mediaSource } from '../api';
import { shareAttachment } from '../files';
import { showError, useStore } from '../store';
import { t as tr, useT } from '../i18n';
import { Text } from '../text';
import { colors } from '../theme';
import { DownloadIcon, XIcon } from '../icons';
import { fileSize } from '../format';
import type { Attachment } from '../protocol';
import { isGifId, loadChatGif, type Gif } from '../../../web/src/chat/giphy';
import { isKlipySlug } from '../../../web/src/chat/klipy';

const SINGLE_MAX_W = 280;
const SINGLE_MAX_H = 320;
const TILE = 130;

/** Pictures and files under a message. */
export function MessageAttachments({ attachments }: { attachments: Attachment[] }) {
  const images = attachments.filter((a) => !a.kind);
  const files = attachments.filter((a) => a.kind === 'file');
  const gif = attachments.find((a) => a.kind === 'giphy' || a.kind === 'klipy');
  const stickers = attachments.filter((a) => a.kind === 'sticker');
  const gifId = gif?.gifId;
  return (
    <>
      <MessageImages attachments={images} />
      {gifId && <GifAttachment id={gifId} provider={gif?.kind === 'klipy' ? 'klipy' : 'giphy'} />}
      {stickers.map((sticker) => <StickerAttachment key={sticker.url} sticker={sticker} />)}
      {files.length > 0 ? <View style={{ marginTop: 4, gap: 6 }}>{files.map((f) => <FileCard key={f.url} file={f} />)}</View> : null}
    </>
  );
}

function StickerAttachment({ sticker }: { sticker: Attachment }) {
  const { t } = useT();
  const reduced = useReducedMotion();
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);
  const scale = Math.min(1, 150 / Math.max(sticker.width, sticker.height, 1));
  const still = sticker.animated && reduced && !playing;
  if (failed) return <Text style={{ color: colors.muted }}>{t('chat.sticker.unavailable')}</Text>;
  return (
    <View style={{ marginTop: 4, width: sticker.width * scale, height: sticker.height * scale }}>
      <Image source={mediaSource(sticker.url + (still ? '?still=true' : ''))} accessibilityLabel={sticker.description || sticker.name} contentFit="contain" style={{ flex: 1 }} onError={() => setFailed(true)} />
      {still && <Pressable accessibilityRole="button" accessibilityLabel={t('chat.sticker.play')} onPress={() => setPlaying(true)} style={{ position: 'absolute', inset: 0, justifyContent: 'center', alignItems: 'center' }}><Text>▶</Text></Pressable>}
    </View>
  );
}

function GifAttachment({ id, provider }: { id: string; provider: 'giphy' | 'klipy' }) {
  const apiKey = useStore((s) => (provider === 'klipy' ? s.data?.klipyKey : s.data?.giphyKey) ?? '');
  return (provider === 'klipy' ? isKlipySlug(id) : isGifId(id)) ? <ChatGif key={apiKey + ':' + id} id={id} apiKey={apiKey} provider={provider} /> : null;
}

function ChatGif({ id, apiKey, provider }: { id: string; apiKey: string; provider: 'giphy' | 'klipy' }) {
  const { t } = useT();
  const reducedMotion = useReducedMotion();
  const [gif, setGif] = useState<Gif | null | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const [play, setPlay] = useState(false);
  useEffect(() => {
    if (!apiKey) return;
    let active = true;
    void loadChatGif(apiKey, id, provider).then((value) => { if (active) setGif(value); });
    return () => { active = false; };
  }, [apiKey, id, provider]);
  if (!apiKey || gif === null || failed) {
    return <Text style={{ marginTop: 4, fontSize: 13, color: colors.muted }}>{t('chat.gif.unavailable')}</Text>;
  }
  const aspect = gif?.aspect ?? 4 / 3;
  return (
    <View style={{ marginTop: 4, width: '100%', maxWidth: Math.min(SINGLE_MAX_W, SINGLE_MAX_H * aspect), aspectRatio: aspect, borderRadius: 12, overflow: 'hidden', backgroundColor: colors.graphite }}>
      {gif && <Image source={reducedMotion && !play ? gif.preview : gif.animated} accessibilityLabel={gif.title} cachePolicy="none" contentFit="contain" style={{ flex: 1 }} onError={() => setFailed(true)} />}
      {gif?.credit && <Text numberOfLines={1} style={{ position: 'absolute', bottom: 4, left: 4, maxWidth: '90%', fontSize: 11, paddingHorizontal: 6, backgroundColor: colors.graphite }}>{gif.credit}</Text>}
      {gif && reducedMotion && !play && (
        <Pressable accessibilityRole="button" accessibilityLabel={t('chat.gif.play')} onPress={() => setPlay(true)} style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, justifyContent: 'center', alignItems: 'center' }}>
          <Text style={{ borderRadius: 20, overflow: 'hidden', padding: 8, backgroundColor: colors.graphite }}>▶</Text>
        </Pressable>
      )}
    </View>
  );
}

/** Any non-picture file: its type in a circle, name, size, and the whole card shares it (Save to Files, AirDrop…). */
function FileCard({ file }: { file: Attachment }) {
  const { t } = useT();
  const ext = (file.name ?? '').split('.').pop()?.slice(0, 4).toUpperCase() || t('chat.attach.fileExt');
  return (
    <Pressable accessibilityRole="button" onPress={() => void shareAttachment(file.url, file.name).catch(showError)} style={({ pressed }) => ({ width: '100%', maxWidth: 420, flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 28, paddingVertical: 8, paddingLeft: 8, paddingRight: 16, backgroundColor: pressed ? colors.tertiary : colors.graphite })}>
      <View style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' }}><Text style={{ fontSize: 11, fontWeight: '600', color: '#000' }}>{ext}</Text></View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ fontSize: 15 }}>{file.name}</Text>
        <Text style={{ fontSize: 13, color: colors.muted }}>{fileSize(file.size)}</Text>
      </View>
      <DownloadIcon size={18} color={colors.muted} />
    </Pressable>
  );
}

/** Images under a message. Space is reserved from the stored size so the chat doesn't jump while they load. */
function MessageImages({ attachments }: { attachments: Attachment[] }) {
  const { t } = useT();
  const [open, setOpen] = useState<Attachment | null>(null);
  if (attachments.length === 0) return null;
  const single = attachments.length === 1;
  return (
    <>
      <View style={{ marginTop: 4, flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {attachments.map((a) => {
          // One image keeps its shape; several become equal square tiles.
          const scale = Math.min(1, SINGLE_MAX_W / (a.width || 1), SINGLE_MAX_H / (a.height || 1));
          const width = single ? Math.max(1, Math.round(a.width * scale)) : TILE;
          const height = single ? Math.max(1, Math.round(a.height * scale)) : TILE;
          return (
            <Pressable key={a.url} accessibilityRole="imagebutton" accessibilityLabel={t('chat.attach.openImage')} onPress={() => setOpen(a)} style={{ width, height, overflow: 'hidden', borderRadius: 12, backgroundColor: colors.graphite }}>
              <Image source={mediaSource(a.previewUrl ?? a.url)} recyclingKey={a.url} cachePolicy="memory-disk" contentFit="cover" transition={150} style={{ width, height }} />
            </Pressable>
          );
        })}
      </View>
      {open ? <Lightbox image={open} onClose={() => setOpen(null)} /> : null}
    </>
  );
}

function Lightbox({ image, onClose }: { image: Attachment; onClose: () => void }) {
  const { t } = useT();
  function menu() {
    const options = [tr('chat.attach.saveImage'), tr('chat.attach.copyLink'), tr('common.cancel')];
    ActionSheetIOS.showActionSheetWithOptions({ options, cancelButtonIndex: 2, userInterfaceStyle: 'dark' }, (i) => {
      if (i === 0) void shareAttachment(image.url, 'image.webp').catch(showError);
      if (i === 1) { const s = mediaSource(image.url); if (s) void Clipboard.setStringAsync(s.uri); }
    });
  }
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Pressable accessibilityLabel={t('common.close')} onPress={onClose} onLongPress={menu} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', justifyContent: 'center' }}>
        <Image source={mediaSource(image.url)} contentFit="contain" style={{ width: '100%', height: '80%' }} />
        <Pressable accessibilityRole="button" accessibilityLabel={t('common.close')} onPress={onClose} style={{ position: 'absolute', right: 20, top: 60, width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.1)' }}><XIcon size={20} /></Pressable>
      </Pressable>
    </Modal>
  );
}
