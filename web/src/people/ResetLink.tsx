import { useState } from 'react';
import { Button } from '@heroui/react';
import { api } from '../api';
import { resetLink } from '../account/resetLink';
import { showError } from '../store';
import { Dialog } from '../ui/Dialog';

/**
 * Admin only: «Ссылка для сброса пароля» for a member who lost the password and the recovery key. Making it shows the
 * link once (the server keeps only a hash); a newer link replaces the older one.
 */
export function ResetLinkButton({ userId, name }: { userId: string; name: string }) {
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function make() {
    setBusy(true);
    try {
      setLink(resetLink((await api.makeResetLink(userId)).token));
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Не получилось');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        onClick={make}
        disabled={busy}
        className="mt-1 w-full rounded-full py-2 text-[13px] text-muted transition-colors hover:bg-white/[0.06] hover:text-foreground disabled:opacity-60"
      >
        Ссылка для сброса пароля
      </button>
      {link && <ResetLinkDialog name={name} link={link} onClose={() => setLink(null)} />}
    </>
  );
}

function ResetLinkDialog({ name, link, onClose }: { name: string; link: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      showError('Не получилось скопировать — ссылку можно выделить вручную');
    }
  }

  return (
    <Dialog
      title="Ссылка для сброса пароля"
      subtitle={`Для ${name}. Действует 24 часа, открывается один раз.`}
      onClose={onClose}
      footer={
        <Button onPress={copy} className="rounded-full">
          {copied ? 'Скопировано' : 'Скопировать'}
        </Button>
      }
    >
      <p className="select-all break-all rounded-[18px] bg-surface-tertiary px-4 py-3 font-mono text-[13px] leading-snug">{link}</p>
    </Dialog>
  );
}
