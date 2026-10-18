import { useState } from 'react';
import { Button } from '@heroui/react';
import { useStore } from '../store';
import { useT } from '../i18n';
import { desktop } from '../desktop';
import { INSTALLERS } from '../updates';
import { DownloadIcon, XIcon } from '../ui/icons';

const DISMISSED_KEY = 'gomex.oldAppBannerDismissed';

/**
 * One line about an update, above the user panel (a computer) or the tab bar (a phone): the desktop app's new
 * version is downloaded, it can't check updates at all (built without the release key), the site has a newer
 * build, or this desktop app is too old to update itself.
 */
export function UpdateBanner() {
  const { t } = useT();
  const app = useStore((s) => s.desktopUpdate);
  const site = useStore((s) => s.siteUpdate);
  const [oldAppDismissed, setOldAppDismissed] = useState(() => {
    try {
      return localStorage.getItem(DISMISSED_KEY) === '1';
    } catch {
      return false;
    }
  });

  if (app?.status === 'ready') {
    return <Banner title={t('settings.banner.ready', { version: app.version ?? '' })} action={t('settings.banner.restart')} onAction={() => desktop?.update?.install()} />;
  }
  if (app?.status === 'manual') {
    return <Banner title={t('settings.banner.manual', { version: app.version ?? '' })} action={t('settings.banner.download')} onAction={() => desktop?.update?.install()} />;
  }
  // A build without the release key turns down every update, and would otherwise do it silently, for good.
  const reinstall = desktop ? INSTALLERS[desktop.platform] : undefined;
  if (app?.status === 'error' && app.code === 'no-key' && reinstall) {
    return (
      <Banner
        title={t('settings.banner.noAutoUpdate')}
        action={t('settings.banner.download')}
        onAction={() => {
          window.location.href = reinstall;
        }}
      />
    );
  }
  if (site) {
    return <Banner title={t('settings.banner.siteUpdated')} action={t('settings.banner.refresh')} onAction={() => window.location.reload()} />;
  }
  const installer = desktop && !desktop.update ? INSTALLERS[desktop.platform] : undefined;
  if (installer && !oldAppDismissed) {
    return (
      <Banner
        title={t('settings.banner.newApp')}
        action={t('settings.banner.download')}
        onAction={() => {
          window.location.href = installer;
        }}
        onDismiss={() => {
          setOldAppDismissed(true);
          try {
            localStorage.setItem(DISMISSED_KEY, '1');
          } catch {
            // Private mode: it'll show again next time, that's all.
          }
        }}
      />
    );
  }
  return null;
}

function Banner({ title, action, onAction, onDismiss }: { title: string; action: string; onAction: () => void; onDismiss?: () => void }) {
  const { t } = useT();
  return (
    <div className="mx-2 mb-2 flex items-center gap-2.5 rounded-[14px] bg-accent/15 py-2 pl-3 pr-2">
      <DownloadIcon size={18} className="shrink-0 text-accent" />
      <span className="min-w-0 flex-1 text-[13px] font-medium leading-tight">{title}</span>
      <Button size="sm" onPress={onAction} className="h-8 shrink-0 rounded-full px-3 text-[13px]">
        {action}
      </Button>
      {onDismiss && (
        <button onClick={onDismiss} aria-label={t('settings.banner.hide')} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted hover:bg-default hover:text-foreground">
          <XIcon size={14} />
        </button>
      )}
    </div>
  );
}
