import { useState, type ReactNode } from 'react';
import { Modal, toast } from '@heroui/react';
import { logout } from '../account/session';
import { desktop, type DesktopUpdate } from '../desktop';
import { showError, useStore } from '../store';
import { AccountSettings } from '../account/Account';
import { VoiceSettings } from '../voice/VoiceSettings';
import { ServerSettings } from './ServerSettings';
import { GomexMark } from '../ui/Logo';
import { LogoutIcon, MicIcon, RefreshIcon, UserIcon } from '../ui/icons';

type Page = 'account' | 'voice' | 'server' | 'app';

/** The update line in the desktop app's settings, by the updater's state. */
function updateLabel(update: DesktopUpdate | null) {
  if (update?.status === 'ready') return `Перезапустить и обновить до ${update.version}`;
  if (update?.status === 'manual') return `Скачать Gomex ${update.version}`;
  if (update?.status === 'checking') return 'Проверяем обновления…';
  if (update?.status === 'downloading') return `Скачиваем обновление… ${Math.round((update.progress ?? 0) * 100)}%`;
  return 'Проверить обновления';
}

async function checkForUpdate() {
  const state = await desktop?.update?.check();
  if (state?.status === 'latest') toast(`Последняя версия — ${state.current}`);
  if (state?.status === 'error') showError(`Не получилось проверить обновления: ${state.error}`);
}

/**
 * Settings, as in Discord: the sections on the left (on the phone, along the top), the open one on the
 * right, and "Выйти" at the foot of the list.
 */
export function SettingsDialog({ onClose, start = 'account' }: { onClose: () => void; start?: Page }) {
  const isMobile = useStore((s) => s.isMobile);
  const isAdmin = useStore((s) => s.canManageChannels);
  const [page, setPage] = useState<Page>(start);
  const pages: [Page, string, ReactNode][] = [
    ['account', 'Аккаунт', <UserIcon size={18} />],
    ['voice', 'Голос', <MicIcon size={18} />],
    // The server's icon and name: the admin's, like the channels.
    ...(isAdmin ? ([['server', 'Сервер', <GomexMark size={18} />]] as [Page, string, ReactNode][]) : []),
    ...(desktop?.update ? ([['app', 'Приложение', <RefreshIcon size={18} />]] as [Page, string, ReactNode][]) : []),
  ];
  const title = pages.find((p) => p[0] === page)?.[1] ?? '';

  return (
    <Modal.Backdrop isOpen onOpenChange={(o) => !o && onClose()}>
      <Modal.Container size={isMobile ? 'full' : 'lg'} placement="center">
        <Modal.Dialog aria-label="Настройки" className="h-[min(720px,88vh)] max-w-[880px] overflow-hidden p-0 max-md:h-dvh max-md:max-w-none max-md:pt-[env(safe-area-inset-top)]">
          <Modal.CloseTrigger className="z-10" />
          <div className="flex h-full max-md:flex-col">
            <nav className="flex w-60 shrink-0 flex-col gap-0.5 border-r-[0.5px] border-edge p-3 max-md:w-full max-md:flex-row max-md:border-b-[0.5px] max-md:border-r-0 max-md:pr-14">
              <h2 className="px-3 pb-2 pt-2 text-[13px] font-medium text-muted max-md:hidden">Настройки</h2>
              {pages.map(([id, label, icon]) => (
                <button
                  key={id}
                  onClick={() => setPage(id)}
                  aria-current={page === id ? 'page' : undefined}
                  className={`flex h-10 items-center gap-3 rounded-full px-3 text-left text-[15px] transition-colors max-md:flex-1 max-md:justify-center ${
                    page === id ? 'bg-default text-foreground' : 'text-muted hover:bg-default/50 hover:text-foreground'
                  }`}
                >
                  {icon}
                  {label}
                </button>
              ))}
              <div className="flex-1 max-md:hidden" />
              <button onClick={logout} className="flex h-10 items-center gap-3 rounded-full px-3 text-left text-[15px] text-danger transition-colors hover:bg-danger/10 max-md:hidden">
                <LogoutIcon size={18} />
                Выйти
              </button>
            </nav>
            <div className="min-w-0 flex-1 overflow-y-auto px-8 pb-8 pt-6 max-md:px-5">
              <h2 className="text-[20px] font-medium max-md:hidden">{title}</h2>
              {page === 'account' && <AccountSettings />}
              {page === 'voice' && <VoiceSettings />}
              {page === 'server' && <ServerSettings />}
              {page === 'app' && <AppSettings />}
            </div>
          </div>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}

/** The desktop app's own version and updates. */
function AppSettings() {
  const update = useStore((s) => s.desktopUpdate);
  const busy = update?.status === 'checking' || update?.status === 'downloading';
  return (
    <section className="mt-6">
      <p className="text-[14px] text-muted">Gomex для компьютера {update?.current}</p>
      <button
        disabled={busy}
        onClick={() => (update?.status === 'ready' || update?.status === 'manual' ? desktop?.update?.install() : checkForUpdate())}
        className="mt-3 h-11 rounded-full bg-white px-5 text-[15px] font-medium text-black hover:bg-[#e7e7ea] disabled:opacity-50"
      >
        {updateLabel(update)}
      </button>
    </section>
  );
}
