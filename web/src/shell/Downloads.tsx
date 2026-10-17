import { useState } from 'react';
import { Modal, Tooltip } from '@heroui/react';
import { useStore } from '../store';
import { DownloadIcon } from '../ui/icons';

export function AppleLogo({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701" />
    </svg>
  );
}

export function WindowsLogo({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M3 3h8.5v8.5H3zM12.5 3H21v8.5h-8.5zM3 12.5h8.5V21H3zM12.5 12.5H21V21h-8.5z" />
    </svg>
  );
}

/** Installers on the server (deploy/downloads, served by Caddy at /download/). */
export const DOWNLOADS = [
  { id: 'mac-arm64', label: 'Mac', detail: 'M1–M4', file: '/download/Gomex-mac-apple-silicon.dmg' },
  { id: 'mac-intel', label: 'Mac', detail: 'Intel', file: '/download/Gomex-mac-intel.dmg' },
  { id: 'windows', label: 'Windows', detail: '10 и 11', file: '/download/Gomex-windows.exe' },
] as const;

/** Which installer fits this computer: Windows, or a Mac (Apple Silicon unless the browser says Intel). */
function guess(): (typeof DOWNLOADS)[number]['id'] {
  const ua = navigator.userAgent;
  if (/Windows/i.test(ua)) return 'windows';
  return 'mac-arm64';
}

/** At the foot of the server rail, as in Discord: get the app for the computer. Not shown inside the app. */
export function DownloadRailButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Tooltip delay={0} closeDelay={0}>
        <Tooltip.Trigger>
          <button
            onClick={() => setOpen(true)}
            aria-label="Скачать приложение"
            className="flex h-12 w-12 items-center justify-center rounded-full bg-default text-success outline-none transition-colors duration-200 hover:bg-success hover:text-success-foreground"
          >
            <DownloadIcon size={22} />
          </button>
        </Tooltip.Trigger>
        <Tooltip.Content placement="right">Скачать приложение</Tooltip.Content>
      </Tooltip>
      {open && <DownloadDialog onClose={() => setOpen(false)} />}
    </>
  );
}

function DownloadDialog({ onClose }: { onClose: () => void }) {
  const mine = guess();
  const isMobile = useStore((s) => s.isMobile);
  const ordered = [...DOWNLOADS].sort((a, b) => Number(b.id === mine) - Number(a.id === mine));
  return (
    <Modal.Backdrop isOpen onOpenChange={(o) => !o && onClose()}>
      <Modal.Container size={isMobile ? 'full' : 'sm'} placement="center">
        <Modal.Dialog aria-label="Gomex для компьютера" className="p-6">
          <Modal.CloseTrigger />
          <h2 className="pr-8 text-[20px] font-medium">Gomex для компьютера</h2>
          <p className="mt-1 text-[14px] text-muted">Push-to-talk в фоне, уведомления, значок в доке</p>
          <div className="mt-5 flex flex-col gap-2">
            {ordered.map((d) => (
              <a
                key={d.id}
                href={d.file}
                onClick={onClose}
                className={`flex h-14 items-center gap-3 rounded-full bg-default px-5 transition-colors hover:bg-[#28282d] ${
                  d.id === mine ? 'ring-[1.5px] ring-white ring-inset' : ''
                }`}
              >
                {d.id === 'windows' ? <WindowsLogo /> : <AppleLogo />}
                <span className="flex-1 text-[16px] font-medium">
                  {d.label} <span className="text-muted">{d.detail}</span>
                </span>
                {d.id === mine && <span className="rounded-full bg-white px-2.5 py-0.5 text-[12px] font-medium text-black">Рекомендуется</span>}
                <DownloadIcon size={20} />
              </a>
            ))}
          </div>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
