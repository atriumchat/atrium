import { fetch } from 'expo/fetch';
import { File } from 'expo-file-system';
import * as FileSystem from 'expo-file-system/legacy';
import * as DocumentPicker from 'expo-document-picker';
import * as Sharing from 'expo-sharing';
import { getCredentials, mediaSource } from './api';
import { t } from './i18n';
import type { Upload } from './protocol';

export async function pickUpload(): Promise<Upload | undefined> {
  const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: false });
  const asset = result.assets?.[0];
  if (result.canceled || !asset) return;
  const credentials = getCredentials();
  if (!credentials) throw new Error(t('sessionExpired'));
  const file = new File(asset.uri);
  if (file.size > 25 * 1024 * 1024) { await file.delete(); throw new Error('≤ 25 MB'); }
  try {
    const response = await fetch(`${credentials.server}/api/uploads?name=${encodeURIComponent(asset.name)}`, {
      method: 'POST', headers: { Authorization: `Bearer ${credentials.token}`, 'Content-Type': asset.mimeType || 'application/octet-stream' },
      body: file, signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) throw new Error(t('uploadError'));
    return await response.json() as Upload;
  } finally { file.delete(); }
}

export async function shareAttachment(url: string, name = 'attachment') {
  const source = mediaSource(url);
  if (!source || !FileSystem.cacheDirectory) return;
  const target = `${FileSystem.cacheDirectory}share-${Date.now()}-${name.replace(/[^\p{L}\p{N}. _-]/gu, '_')}`;
  try {
    const result = await FileSystem.downloadAsync(source.uri, target, { headers: source.headers });
    if (result.status !== 200) throw new Error(t('error'));
    await Sharing.shareAsync(result.uri);
  } finally { await FileSystem.deleteAsync(target, { idempotent: true }); }
}

/** Uploads a local file (a photo from the library or camera, a picked document) and returns what the message carries. */
export async function uploadLocal(asset: { uri: string; name: string; mimeType?: string | null }): Promise<Upload> {
  const credentials = getCredentials();
  if (!credentials) throw new Error(t('sessionExpired'));
  const file = new File(asset.uri);
  if (file.size > 25 * 1024 * 1024) throw new Error('≤ 25 MB');
  const response = await fetch(`${credentials.server}/api/uploads?name=${encodeURIComponent(asset.name)}`, {
    method: 'POST', headers: { Authorization: `Bearer ${credentials.token}`, 'Content-Type': asset.mimeType || 'application/octet-stream' },
    body: file, signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(t('uploadError'));
  return await response.json() as Upload;
}
