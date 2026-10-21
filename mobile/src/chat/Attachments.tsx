import { useState } from 'react';
import { ActionSheetIOS, Modal, Pressable, View } from 'react-native';
import { Image } from 'expo-image';
import * as Clipboard from 'expo-clipboard';
import { mediaSource } from '../api';
import { shareAttachment } from '../files';
import { showError } from '../store';
import { t as tr, useT } from '../i18n';
import { Text } from '../text';
import { colors } from '../theme';
import { DownloadIcon, XIcon } from '../icons';
import { fileSize } from '../format';
import type { Attachment } from '../protocol';

const SINGLE_MAX_W = 280;
const SINGLE_MAX_H = 320;
const TILE = 130;

/** Pictures and files under a message. */
export function MessageAttachments({ attachments }: { attachments: Attachment[] }) {
  const images = attachments.filter((a) => a.kind !== 'file');
  const files = attachments.filter((a) => a.kind === 'file');
  return (
    <>
      <MessageImages attachments={images} />
      {files.length > 0 ? <View style={{ marginTop: 4, gap: 6 }}>{files.map((f) => <FileCard key={f.url} file={f} />)}</View> : null}
    </>
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
