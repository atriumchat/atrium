import { Fragment, useState, type ReactNode } from 'react';
import { Modal, toast } from '@heroui/react';
import { logout } from '../account/session';
import { t, useT, type TFn } from '../i18n';
import { desktop, type DesktopUpdate } from '../desktop';
import { showError, useStore } from '../store';
import { AccountSettings } from '../account/Account';
import { VoiceSettings } from '../voice/VoiceSettings';
import { ServerSettings } from './ServerSettings';
import { RolesSettings } from './RolesSettings';
import { AtriumMark } from '../ui/Logo';
import { focusReducedMotionDialog } from '../ui/Dialog';
import { Row, Rows, Secondary } from '../ui/settings';
import { LogoutIcon, MicIcon, RefreshIcon, ShieldIcon, UserIcon, XIcon } from '../ui/icons';

export type SettingsPage = 'account' | 'voice' | 'server' | 'roles' | 'app';

/**
 * The settings' sections: on the computer a list on the left, each opening its page; on the phone one page of them
 * all, each section a group of rows (the "You" tab's "Settings").
 */
export function useSettingsPages() {
  const { t } = useT();
  const isAdmin = useStore((s) => s.isAdmin);
  const manageRoles = useStore((s) => s.permissions.includes('manageRoles'));
  const pages: { id: SettingsPage; group: 'personal' | 'server'; label: string; icon: ReactNode; content: ReactNode }[] = [
    { id: 'account', group: 'personal', label: t('settings.page.account'), icon: <UserIcon size={18} />, content: <AccountSettings /> },
    { id: 'voice', group: 'personal', label: t('settings.page.voice'), icon: <MicIcon size={18} />, content: <VoiceSettings /> },
  ];
  // The server's icon and name: the admin's alone, the server refuses anyone else.
  if (isAdmin) pages.push({ id: 'server', group: 'server', label: t('settings.page.server'), icon: <AtriumMark size={18} filled />, content: <ServerSettings /> });
  if (manageRoles) pages.push({ id: 'roles', group: 'server', label: t('settings.page.roles'), icon: <ShieldIcon size={18} />, content: <RolesSettings /> });
  if (desktop?.update) pages.push({ id: 'app', group: 'personal', label: t('settings.page.app'), icon: <RefreshIcon size={18} />, content: <AppSettings /> });
  return pages;
}

/** The update line in the desktop app's settings, by the updater's state. */
function updateLabel(update: DesktopUpdate | null, t: TFn) {
  if (update?.status === 'ready') return t('settings.update.ready', { version: update.version ?? '' });
  if (update?.status === 'manual') return t('settings.update.manual', { version: update.version ?? '' });
  if (update?.status === 'checking') return t('settings.update.checking');
  if (update?.status === 'downloading') return t('settings.update.downloading', { percent: Math.round((update.progress ?? 0) * 100) });
  return t('settings.update.check');
}

async function checkForUpdate() {
  const state = await desktop?.update?.check();
  if (state?.status === 'latest') toast(t('settings.update.latest', { version: state.current }));
  if (state?.status === 'error') showError(t('settings.update.failed', { error: state.error ?? '' }));
}

/**
 * Settings on the computer, as in Discord: the sections on the left, the open one on the right, and "Log out" at
 * the foot of the list. In the window's tone, like the setup wizard. (The phone has one page of groups instead.)
 */
export function SettingsDialog({ onClose, start = 'account' }: { onClose: () => void; start?: SettingsPage }) {
  const { t } = useT();
  const pages = useSettingsPages();
  const [page, setPage] = useState<SettingsPage>(start);
  // The first page comes with the window; only a switch brings its content in on its own.
  const [switched, setSwitched] = useState(false);
  const open = pages.find((p) => p.id === page) ?? pages[0];
  // Personal sections first, then the server's; a caption over each group only when there are two.
  const groups = (['personal', 'server'] as const).map((group) => ({ group, items: pages.filter((p) => p.group === group) })).filter((g) => g.items.length);

  return (
    <Modal.Backdrop ref={focusReducedMotionDialog} isOpen onOpenChange={(o) => !o && onClose()}>
      <Modal.Container size="lg" placement="center">
        {/* The avatar's ring and anything else drawn in the overlay tone follows the window's tone here. */}
        <Modal.Dialog aria-label={t('settings.title')} className="h-[min(720px,88vh)] max-w-[880px] overflow-hidden border border-edge p-0 [--overlay:var(--app-window)]">
          <Modal.CloseTrigger aria-label={t('common.close')} className="z-10"><XIcon size={16} /></Modal.CloseTrigger>
          <div className="flex h-full max-md:flex-col">
            <nav className="flex w-60 shrink-0 flex-col gap-0.5 border-r border-edge p-3 max-md:w-full max-md:flex-row max-md:overflow-x-auto max-md:border-r-0 max-md:border-b max-md:pr-12">
              <h2 className="px-3 pb-2 pt-2 text-[13px] font-medium text-muted max-md:hidden">{t('settings.title')}</h2>
              {groups.map(({ group, items }) => (
                <Fragment key={group}>
                  {groups.length > 1 && <h3 className="truncate px-3 pb-1 pt-3 text-[12px] font-medium text-faint max-md:hidden">{t(`settings.group.${group}`)}</h3>}
                  {items.map(({ id, label, icon }) => (
                    <button
                      key={id}
                      onClick={() => {
                        setPage(id);
                        setSwitched(true);
                      }}
                      aria-current={open.id === id ? 'page' : undefined}
                      className={`flex h-10 shrink-0 items-center gap-3 rounded-full px-3 text-left text-[15px] transition-colors max-md:whitespace-nowrap ${
                        open.id === id ? 'bg-default text-foreground' : 'text-muted hover:bg-white/[0.08] hover:text-foreground'
                      }`}
                    >
                      {icon}
                      <span className="min-w-0 truncate">{label}</span>
                    </button>
                  ))}
                </Fragment>
              ))}
              <div className="flex-1 max-md:hidden" />
              <button onClick={logout} className="flex h-10 items-center gap-3 rounded-full px-3 text-left text-[15px] text-danger transition-colors hover:bg-danger/10 max-md:hidden">
                <LogoutIcon size={18} />
                {t('settings.logout')}
              </button>
            </nav>
            <div key={open.id} className={`min-w-0 flex-1 overflow-y-auto px-10 pb-10 pt-8 max-md:min-h-0 max-md:px-4 max-md:pt-4 ${switched ? 'gx-page-in' : ''}`}>
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
  const { t } = useT();
  const update = useStore((s) => s.desktopUpdate);
  const busy = update?.status === 'checking' || update?.status === 'downloading';
  return (
    <Rows title={t('settings.page.app')} className="mt-6">
      <Row title={t('settings.app.desktop')} value={update?.current}>
        <Secondary
          isDisabled={busy}
          onPress={() => (update?.status === 'ready' || update?.status === 'manual' ? desktop?.update?.install() : checkForUpdate())}
        >
          {updateLabel(update, t)}
        </Secondary>
      </Row>
    </Rows>
  );
}
