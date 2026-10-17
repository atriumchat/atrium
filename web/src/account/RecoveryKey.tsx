import { useState } from 'react';
import { Button, Checkbox, Label } from '@heroui/react';
import { showError } from '../store';
import { GomexMark } from '../ui/Logo';

/** A recovery key on its way to the person: the key itself and what the saved file should say. */
// `newcomer`: made at sign-up (not by a recovery), so the "where to use Gomex" screen follows it.
export type NewKey = { key: string; name: string; serverName: string; newcomer?: boolean };

// The key is shown once, so a reload on its screen mustn't lose it: it waits in this tab until "Дальше".
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

function downloadKey({ key, name, serverName }: NewKey) {
  const title = serverName || 'Gomex';
  const lines = [title, ...(window.location.protocol.startsWith('http') ? [window.location.origin] : []), '', `Ник: ${name}`, `Ключ восстановления: ${key}`, ''];
  const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  // Slashes and the like would make the browser cut or rename the file.
  link.download = `${title.replace(/[\\/:*?"<>|]+/g, ' ').trim()} — ключ восстановления.txt`;
  link.click();
  URL.revokeObjectURL(url);
}

const white = 'h-11 flex-1 rounded-full px-5 text-[15px] [--button-bg:white] [--button-bg-hover:#e7e7ea] [--button-fg:#0b0b0c]';

/**
 * The screen right after sign-up (and after recovery or a reset link, which spend the old key): the recovery key to
 * copy or download. "Дальше" opens once it's been copied or downloaded, or "Ключ сохранён" is ticked.
 */
export function RecoveryKeyScreen({ value, onDone }: { value: NewKey; onDone: () => void }) {
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value.key);
      setCopied(true);
      setSaved(true);
    } catch {
      showError('Не получилось скопировать — ключ можно выделить вручную');
    }
  }

  return (
    <div className="flex h-full overflow-y-auto bg-background">
      <div className="m-auto flex w-full max-w-[380px] flex-col items-center gap-5 px-4 py-8">
        <GomexMark size={56} />
        <div className="text-center">
          <h1 className="text-[24px] font-medium leading-tight">Ключ восстановления</h1>
          <p className="mt-1.5 text-balance text-[14px] leading-snug text-muted">Нужен, если забудется пароль. Показывается один раз.</p>
        </div>
        <div className="w-full select-all rounded-[18px] bg-surface-tertiary px-4 py-4 text-center font-mono text-[20px] tracking-wider">
          {value.key}
        </div>
        <div className="flex w-full gap-2">
          <Button onPress={copy} className={white}>
            {copied ? 'Скопировано' : 'Скопировать'}
          </Button>
          <Button
            onPress={() => {
              downloadKey(value);
              setSaved(true);
            }}
            className={white}
          >
            Скачать
          </Button>
        </div>
        <Checkbox isSelected={saved} onChange={setSaved}>
          <Checkbox.Content>
            <Checkbox.Control>
              <Checkbox.Indicator />
            </Checkbox.Control>
            <Label>Ключ сохранён</Label>
          </Checkbox.Content>
        </Checkbox>
        {/* Next in the order after the key is the "where to use Gomex" screen: it takes over from this onDone. */}
        <Button fullWidth isDisabled={!saved} onPress={onDone} className="h-12 rounded-full text-[16px]">
          Дальше
        </Button>
      </div>
    </div>
  );
}
