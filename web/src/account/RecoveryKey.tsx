import { FlowShell } from '@gomex/ui-web';
import { t, useT } from '../i18n';
import { KeyStep } from './KeyStep';

/** A recovery key on its way to the person: the key itself and what the saved file should say. */
// `newcomer`: made at sign-up (not by a recovery), so the "where to use Atrium" screen follows it.
export type NewKey = { key: string; name: string; serverName: string; newcomer?: boolean };

// The key is shown once, so a reload on its screen mustn't lose it: it waits in this tab until "Next".
const PENDING = 'gomex_new_key';

export function loadNewKey(): NewKey | null {
  try {
    const raw = sessionStorage.getItem(PENDING);
    return raw ? (JSON.parse(raw) as NewKey) : null;
  } catch {
    return null;
  }
}

export function storeNewKey(value: NewKey | null) {
  try {
    if (value) sessionStorage.setItem(PENDING, JSON.stringify(value));
    else sessionStorage.removeItem(PENDING);
  } catch {
    // Storage unavailable: the key just won't survive a reload.
  }
}

/** The key as a small text file, with the server and the nick it belongs to. */
export function downloadKey({ key, name, serverName }: NewKey) {
  const title = serverName || 'Atrium';
  const lines = [title, ...(window.location.protocol.startsWith('http') ? [window.location.origin] : []), '', t('account.key.fileNick', { name }), t('account.key.fileKey', { key }), ''];
  const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  // Slashes and the like would make the browser cut or rename the file.
  link.download = t('account.key.fileName', { title: title.replace(/[\\/:*?"<>|]+/g, ' ').trim() });
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * The screen right after sign-up (and after recovery or a reset link, which spend the old key): the recovery key to
 * copy or download (KeyStep), at the end of the way in, so the scale stands full.
 */
export function RecoveryKeyScreen({ value, onDone }: { value: NewKey; onDone: () => void }) {
  const { t } = useT();
  return (
    <FlowShell fill={1}>
      {/* Next in the order after the key is the "where to use Atrium" screen: it takes over from this onDone. */}
      <KeyStep value={value} title={t('account.key.title')} sub={t('account.key.hint')} onNext={onDone} />
    </FlowShell>
  );
}
