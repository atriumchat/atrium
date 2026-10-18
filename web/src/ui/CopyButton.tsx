import { useState } from 'react';
import { showError } from '../store';
import { CheckIcon, CopyIcon } from './icons';

/**
 * Copying as an icon at the right end of the field that holds the text (a key, a link), not a button under it: the
 * tick says it's done for a moment. Place it inside a `relative` box, or in a flex row at its end.
 */
export function CopyButton({ text, label = 'Скопировать', onCopied, className = '' }: { text: string; label?: string; onCopied?: () => void; className?: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await copyText(text);
      setCopied(true);
      onCopied?.();
      setTimeout(() => setCopied(false), 1500);
    } catch {
      showError('Не получилось скопировать — можно выделить вручную');
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      disabled={!text}
      aria-label={copied ? 'Скопировано' : label}
      title={copied ? 'Скопировано' : label}
      className={`flex size-9 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-white/[0.08] hover:text-foreground disabled:opacity-40 ${copied ? 'text-here hover:text-here' : ''} ${className}`}
    >
      {copied ? <CheckIcon size={18} strokeWidth={2.5} /> : <CopyIcon size={18} />}
    </button>
  );
}

/** The clipboard, or the old way where it's refused (a window without focus, an older webview). */
export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    // Below.
  }
  const area = Object.assign(document.createElement('textarea'), { value: text, readOnly: true });
  area.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
  document.body.append(area);
  area.select();
  const copied = document.execCommand('copy');
  area.remove();
  if (!copied) throw new Error('Не получилось скопировать');
}
