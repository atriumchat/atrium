import { useState, type ReactNode } from 'react';
import { Modal, toast } from '@heroui/react';
import { logout } from '../account/session';
import { desktop, type DesktopUpdate } from '../desktop';
import { showError, useStore } from '../store';
import { AccountSettings } from '../account/Account';
import { VoiceSettings } from '../voice/VoiceSettings';
import { ServerSettings } from './ServerSettings';
import { GomexMark } from '../ui/Logo';
import { Row, Rows, Secondary } from '../ui/settings';
import { LogoutIcon, MicIcon, RefreshIcon, UserIcon } from '../ui/icons';

export type SettingsPage = 'account' | 'voice' | 'server' | 'app';

/**
 * The settings' sections: on the computer a list on the left, each opening its page; on the phone one page of them
 * all, each section a group of rows (the "Вы" tab's "Настройки").
 */
export function useSettingsPages() {
  const isAdmin = useStore((s) => s.isAdmin);
  const pages: { id: SettingsPage; label: string; icon: ReactNode; content: ReactNode }[] = [
    { id: 'account', label: 'Аккаунт', icon: <UserIcon size={18} />, content: <AccountSettings /> },
    { id: 'voice', label: 'Голос', icon: <MicIcon size={18} />, content: <VoiceSettings /> },
  ];
  // The server's icon and name: the admin's alone, the server refuses anyone else.
  if (isAdmin) pages.push({ id: 'server', label: 'Сервер', icon: <GomexMark size={18} />, content: <ServerSettings /> });
  if (desktop?.update) pages.push({ id: 'app', label: 'Приложение', icon: <RefreshIcon size={18} />, content: <AppSettings /> });
  return pages;
}

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
 * Settings on the computer, as in Discord: the sections on the left, the open one on the right, and "Выйти" at
 * the foot of the list. In the window's tone, like the setup wizard. (The phone has one page of groups instead.)
 */
export function SettingsDialog({ onClose, start = 'account' }: { onClose: () => void; start?: SettingsPage }) {
  const pages = useSettingsPages();
  const [page, setPage] = useState<SettingsPage>(start);
  const open = pages.find((p) => p.id === page) ?? pages[0];

  return (
    <Modal.Backdrop isOpen onOpenChange={(o) => !o && onClose()}>
      <Modal.Container size="lg" placement="center">
        {/* The avatar's ring and anything else drawn in the overlay tone follows the window's tone here. */}
        <Modal.Dialog aria-label="Настройки" className="h-[min(720px,88vh)] max-w-[880px] overflow-hidden border border-edge p-0 [--overlay:var(--app-window)]">
          <Modal.CloseTrigger className="z-10" />
          <div className="flex h-full">
            <nav className="flex w-60 shrink-0 flex-col gap-0.5 border-r border-edge p-3">
              <h2 className="px-3 pb-2 pt-2 text-[13px] font-medium text-muted">Настройки</h2>
              {pages.map(({ id, label, icon }) => (
                <button
                  key={id}
                  onClick={() => setPage(id)}
                  aria-current={open.id === id ? 'page' : undefined}
                  className={`flex h-10 items-center gap-3 rounded-full px-3 text-left text-[15px] transition-colors ${
                    open.id === id ? 'bg-default text-foreground' : 'text-muted hover:bg-default/50 hover:text-foreground'
                  }`}
                >
                  {icon}
                  {label}
                </button>
              ))}
              <div className="flex-1" />
              <button onClick={logout} className="flex h-10 items-center gap-3 rounded-full px-3 text-left text-[15px] text-danger transition-colors hover:bg-danger/10">
                <LogoutIcon size={18} />
                Выйти
              </button>
            </nav>
            <div className="min-w-0 flex-1 overflow-y-auto px-10 pb-10 pt-8">
              <h2 className="text-[21px] font-medium leading-tight tracking-[-0.01em]">{open.label}</h2>
              {open.content}
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
    <Rows title="Приложение" className="mt-6">
      <Row title="Gomex для компьютера" value={update?.current}>
        <Secondary
          isDisabled={busy}
          onPress={() => (update?.status === 'ready' || update?.status === 'manual' ? desktop?.update?.install() : checkForUpdate())}
        >
          {updateLabel(update)}
        </Secondary>
      </Row>
    </Rows>
  );
}
