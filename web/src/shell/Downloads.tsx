import { useState } from 'react';
import { Tooltip } from '@heroui/react';
import { t, useT } from '../i18n';
import { WhereToUse } from '../account/WhereToUse';
import { DownloadIcon } from '../ui/icons';
import { Window } from '../ui/Dialog';

/** Installers on the server (deploy/downloads, served by Caddy at /download/). */
export const DOWNLOADS = [
  { id: 'mac-arm64', label: 'Mac', detail: 'M1–M4', file: '/download/Gomex-mac-apple-silicon.dmg' },
  { id: 'mac-intel', label: 'Mac', detail: 'Intel', file: '/download/Gomex-mac-intel.dmg' },
  { id: 'windows', label: 'Windows', get detail() {
      return t('settings.downloads.windowsDetail');
    },
    file: '/download/Gomex-windows.exe' },
] as const;

/** At the foot of the server rail, as in Discord: get the app for the computer. Shown only where it makes sense (see whereToUseNeeded): not in the desktop app or from the Home Screen. */
export function DownloadRailButton() {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Tooltip delay={0} closeDelay={0}>
        <Tooltip.Trigger>
          <button
            onClick={() => setOpen(true)}
            aria-label={t('settings.downloads.button')}
            className="flex h-12 w-12 items-center justify-center rounded-full bg-default text-success outline-none transition-colors duration-200 hover:bg-success hover:text-success-foreground"
          >
            <DownloadIcon size={22} />
          </button>
        </Tooltip.Trigger>
        <Tooltip.Content placement="right">{t('settings.downloads.button')}</Tooltip.Content>
      </Tooltip>
      {open && <DownloadDialog onClose={() => setOpen(false)} />}
    </>
  );
}

/** The same "where to use Gomex" screen as after sign-up, in a window; it brings its own title and buttons. */
function DownloadDialog({ onClose }: { onClose: () => void }) {
  const { t } = useT();
  return (
    <Window label={t('settings.downloads.dialog')} onClose={onClose} className="max-w-[400px] overflow-hidden p-0">
      <WhereToUse onDone={onClose} inWindow />
    </Window>
  );
}
