import { useEffect, useId, useRef, useState } from 'react';
import { PhotoIcon } from '@heroicons/react/24/outline';
import { api } from '../api';
import { useT } from '../i18n';
import { getSessionEpoch, useStore } from '../store';
import { Dialog } from '../ui/Dialog';
import { EmojiPicker } from '../ui/EmojiPicker';
import { EmojiText } from '../ui/EmojiText';
import { field, fieldArea, fieldLabel, Primary, Secondary } from '../ui/settings';

export function StickerUpload({ onClose }: { onClose: () => void }) {
  const { t } = useT();
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<{ data: File; url: string } | null>(null);
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const valid = !!file && !!emoji && name.trim().length >= 2;
  useEffect(() => () => { if (file) URL.revokeObjectURL(file.url); }, [file]);

  function pick(data: File) {
    if (busy) return;
    if (data.size > 512 * 1024) { setError(t('err.stickerTooBig')); return; }
    if (!/\.(?:apng|png|jpe?g|gif|webp)$/i.test(data.name) && !/^image\/(apng|png|jpeg|gif|webp)$/.test(data.type)) {
      setError(t('err.stickerFormat'));
      return;
    }
    setError('');
    setFile({ data, url: URL.createObjectURL(data) });
    setName((value) => value || data.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ').slice(0, 32));
  }

  async function save() {
    if (!valid || !file || busy) return;
    const epoch = getSessionEpoch();
    setError('');
    setBusy(true);
    try {
      const stickers = await api.uploadSticker(file.data, { name, emoji, description });
      if (epoch !== getSessionEpoch()) return;
      useStore.setState({ stickers });
      onClose();
    } catch (cause) {
      if (epoch === getSessionEpoch()) setError(cause instanceof Error ? cause.message : t('settings.server.failed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog title={t('chat.sticker.add')} subtitle={t('chat.sticker.formats')} onClose={onClose} onFileDrop={pick} isBusy={busy} sheet footer={<><Secondary isDisabled={busy} onPress={onClose}>{t('common.cancel')}</Secondary><Primary form={id} type="submit" isDisabled={!valid} isPending={busy}>{t('settings.emoji.upload')}</Primary></>}>
      <form id={id} className="grid gap-4 pb-3" onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <div>
          <span className={fieldLabel}>{t('chat.sticker.preview')}</span>
          <button type="button" aria-label={t('chat.sticker.chooseFile')} disabled={busy} onClick={() => input.current?.click()} className="grid h-28 w-full grid-cols-2 overflow-hidden rounded-panel border border-white/10 focus-visible:outline-2 focus-visible:outline-focus">
            {['bg-window text-muted', 'bg-neutral-200 text-neutral-600'].map((background) => (
              <span key={background} className={`grid h-full min-h-0 place-items-center ${background}`}>
                {file ? <img className="size-24 object-contain" src={file.url} alt="" onError={() => { setFile(null); setError(t('err.stickerFormat')); }} /> : <PhotoIcon className="size-6" />}
              </span>
            ))}
          </button>
        </div>
        <div>
          <span className={fieldLabel}>{t('chat.sticker.file')}</span>
          <input ref={input} type="file" accept="image/png,image/apng,image/jpeg,image/gif,image/webp" hidden onChange={(event) => {
            const chosen = event.target.files?.[0];
            if (chosen) pick(chosen);
            event.target.value = '';
          }} />
          <Secondary isDisabled={busy} onPress={() => input.current?.click()}>{file?.data.name ?? t('chat.sticker.chooseFile')}</Secondary>
        </div>
        <div>
          <span className={fieldLabel}>{t('chat.sticker.related')}</span>
          <EmojiPicker label={t('chat.sticker.related')} onPick={setEmoji} custom={false} disabled={busy} className="h-9 w-9 rounded-full bg-white/10">
            {emoji ? <EmojiText text={emoji} /> : <span aria-hidden>+</span>}
          </EmojiPicker>
        </div>
        <label><span className={fieldLabel}>{t('chat.sticker.name')}</span><input className={field} required minLength={2} maxLength={32} value={name} disabled={busy} onChange={(e) => setName(e.target.value)} /></label>
        <label><span className={fieldLabel}>{t('chat.sticker.description')}</span><textarea className={fieldArea} maxLength={200} value={description} disabled={busy} onChange={(e) => setDescription(e.target.value)} /></label>
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      </form>
    </Dialog>
  );
}
