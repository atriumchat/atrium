import { useState } from 'react';
import { api } from '../api';
import { resetLink } from '../account/resetLink';
import { showError } from '../store';
import { CopyButton } from '../ui/CopyButton';
import { Dialog } from '../ui/Dialog';
import { useT } from '../i18n';

/**
 * Admin only: a password reset link for a member who lost the password and the recovery key. Making it shows the
 * link once (the server keeps only a hash); a newer link replaces the older one.
 */
export function ResetLinkButton({ userId, name }: { userId: string; name: string }) {
  const { t } = useT();
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function make() {
    setBusy(true);
    try {
      setLink(resetLink((await api.makeResetLink(userId)).token));
    } catch (e) {
      showError(e instanceof Error ? e.message : t('account.resetLink.failed'));
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
        {t('account.resetLink.button')}
      </button>
      {link && <ResetLinkDialog name={name} link={link} onClose={() => setLink(null)} />}
    </>
  );
}

function ResetLinkDialog({ name, link, onClose }: { name: string; link: string; onClose: () => void }) {
  const { t } = useT();
  return (
    <Dialog
      title={t('account.resetLink.title')}
      subtitle={t('account.resetLink.subtitle', { name })}
      onClose={onClose}
    >
      <div className="flex items-center gap-1 rounded-[18px] bg-surface-tertiary py-1.5 pl-4 pr-1.5">
        <p className="min-w-0 flex-1 select-all break-all py-1.5 font-mono text-[13px] leading-snug">{link}</p>
        <CopyButton text={link} />
      </div>
    </Dialog>
  );
}
