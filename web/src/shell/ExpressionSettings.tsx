import { useId, useState } from 'react';
import { api } from '../api';
import { useT } from '../i18n';
import { getSessionEpoch, showError, useStore } from '../store';
import { emojiNamePattern, serverEmojiUrl } from '../ui/EmojiText';
import { field, fieldLabel, Primary, Row, Rows, RowValue, Secondary, SubPage, useSub } from '../ui/settings';
import { stickerUrl } from '../chat/StickerPanel';
import { StickerUpload } from '../chat/StickerUpload';

export function StickerSettingsRow() {
  const { t } = useT();
  const stickers = useStore((s) => s.stickers);
  const sub = useSub();
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  async function toggle(id: string, active: boolean) {
    const epoch = getSessionEpoch();
    setBusy(true);
    try {
      const next = await api.setStickerActive(id, active);
      if (epoch === getSessionEpoch()) useStore.setState({ stickers: next });
    } catch (error) {
      if (epoch === getSessionEpoch()) showError(error instanceof Error ? error.message : t('settings.server.failed'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Row title={t('settings.stickers.title')} onPress={sub.show}><RowValue>{stickers.filter((sticker) => sticker.active).length}</RowValue></Row>
      <SubPage key={sub.key} open={sub.open} title={t('settings.stickers.title')} onClose={sub.hide}>
        <Secondary onPress={() => setAdding(true)}>{t('chat.sticker.add')}</Secondary>
        <Rows className="mt-3">
          {stickers.map((sticker) => (
            <Row key={sticker.id} title={sticker.name} icon={<img src={stickerUrl(sticker.id) + '?still=true'} alt="" className="size-8 object-contain" />}>
              <Secondary isDisabled={busy} onPress={() => void toggle(sticker.id, !sticker.active)}>{t(sticker.active ? 'settings.emoji.hide' : 'settings.emoji.show')}</Secondary>
            </Row>
          ))}
        </Rows>
      </SubPage>
      {adding && <StickerUpload onClose={() => setAdding(false)} />}
    </>
  );
}

export function KlipySettingsRow() {
  const { t } = useT();
  const key = useStore((s) => s.klipyKey);
  const sub = useSub();
  return (
    <>
      <Row title="KLIPY" onPress={sub.show}><RowValue>{t(key ? 'settings.klipy.on' : 'settings.klipy.off')}</RowValue></Row>
      <SubPage key={sub.key} open={sub.open} title="KLIPY" onClose={sub.hide}>
        <KlipySettings saved={key} onSaved={sub.hide} />
      </SubPage>
    </>
  );
}

function KlipySettings({ saved, onSaved }: { saved: string; onSaved: () => void }) {
  const { t } = useT();
  const fieldId = useId();
  const [key, setKey] = useState(saved);
  const [busy, setBusy] = useState(false);

  async function save(value: string) {
    const epoch = getSessionEpoch();
    setBusy(true);
    try {
      const config = await api.setKlipyKey(value);
      if (epoch !== getSessionEpoch()) return;
      useStore.setState(config);
      onSaved();
    } catch (error) {
      if (epoch === getSessionEpoch()) showError(error instanceof Error ? error.message : t('settings.server.failed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="mt-4 grid gap-3" onSubmit={(e) => { e.preventDefault(); if (key.trim()) void save(key.trim()); }}>
      <div>
        <label htmlFor={fieldId} className={fieldLabel}>{t('settings.klipy.key')}</label>
        <input id={fieldId} type="password" autoComplete="off" spellCheck={false} className={field} value={key} maxLength={128} disabled={busy} onChange={(e) => setKey(e.target.value)} />
      </div>
      <a href="https://partner.klipy.com/" target="_blank" rel="noreferrer noopener" className="w-fit text-sm text-muted underline-offset-2 hover:underline">{t('settings.klipy.getKey')}</a>
      <div className="flex flex-wrap justify-end gap-2">
        {saved && <Secondary isDisabled={busy} onPress={() => void save('')}>{t('settings.klipy.disable')}</Secondary>}
        <Primary type="submit" isPending={busy} isDisabled={!key.trim() || key.trim() === saved}>{t('settings.server.save')}</Primary>
      </div>
    </form>
  );
}

export function CustomEmojiSettingsRow() {
  const { t } = useT();
  const catalog = useStore((s) => s.customEmoji);
  const sub = useSub();
  return (
    <>
      <Row title={t('settings.emoji.title')} onPress={sub.show}><RowValue>{Object.values(catalog).filter(Boolean).length}</RowValue></Row>
      <SubPage key={sub.key} open={sub.open} title={t('settings.emoji.title')} onClose={sub.hide}>
        <CustomEmojiSettings />
      </SubPage>
    </>
  );
}

export function CustomEmojiSettings({ onUploaded }: { onUploaded?: () => void }) {
  const { t } = useT();
  const catalog = useStore((s) => s.customEmoji);
  const formId = useId();
  const [name, setName] = useState('');
  const [file, setFile] = useState<File>();
  const [fileInputKey, setFileInputKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const entries = Object.entries(catalog);
  const normalized = name.trim().toLowerCase().replace(/^:|:$/g, '');

  async function change(action: () => Promise<typeof catalog>, uploaded = false) {
    const epoch = getSessionEpoch();
    setBusy(true);
    try {
      const next = await action();
      if (epoch !== getSessionEpoch()) return;
      useStore.setState({ customEmoji: next });
      if (uploaded) {
        onUploaded?.();
        setName('');
        setFile(undefined);
        setFileInputKey((key) => key + 1);
      }
    } catch (error) {
      if (epoch === getSessionEpoch()) showError(error instanceof Error ? error.message : t('settings.server.failed'));
    } finally {
      setBusy(false);
    }
  }

  const validName = emojiNamePattern.test(normalized);
  const taken = Object.hasOwn(catalog, normalized);
  const full = entries.length >= 100;
  return (
    <>
      <form className="mt-4 grid gap-3" onSubmit={(e) => {
        e.preventDefault();
        if (file && validName && !taken && !full) void change(() => api.uploadEmoji(normalized, file), true);
      }}>
        <div>
          <label htmlFor={formId + '-name'} className={fieldLabel}>{t('settings.emoji.name')}</label>
          <input id={formId + '-name'} autoComplete="off" spellCheck={false} placeholder=":atrium:" className={field} value={name} maxLength={34} disabled={busy} onChange={(e) => setName(e.target.value)} />
          {name && !validName && <p className="mt-1 text-xs text-muted">{t('err.emojiNameInvalid')}</p>}
          {taken && <p className="mt-1 text-xs text-muted">{t('err.emojiNameTaken')}</p>}
        </div>
        <div>
          <label htmlFor={formId + '-file'} className={fieldLabel}>{t('settings.emoji.image')}</label>
          <input id={formId + '-file'} key={fileInputKey} type="file" accept="image/png,image/jpeg,image/webp" className="max-w-full text-sm text-muted file:me-2 file:rounded-full file:border-0 file:bg-white/10 file:px-3 file:py-2 file:text-foreground" disabled={busy} onChange={(e) => {
            const next = e.target.files?.[0];
            if (next && next.size > 512 * 1024) {
              showError(t('err.emojiTooBig'));
              e.target.value = '';
              setFile(undefined);
            } else setFile(next);
          }} />
        </div>
        {full && <p className="text-sm text-muted">{t('err.emojiLimit')}</p>}
        <Primary type="submit" className="justify-self-end" isPending={busy} isDisabled={!file || !validName || taken || full}>{t('settings.emoji.upload')}</Primary>
      </form>
      {!onUploaded && <Rows className="mt-4">
        {entries.map(([emoji, active]) => (
          <Row key={emoji} icon={<img src={serverEmojiUrl(emoji)} alt="" className="size-7 object-contain" />} title={`:${emoji}:`}>
            <Secondary isDisabled={busy} onPress={() => void change(() => api.setEmojiActive(emoji, !active))}>{t(active ? 'settings.emoji.hide' : 'settings.emoji.show')}</Secondary>
          </Row>
        ))}
      </Rows>}
    </>
  );
}
