import { useEffect, useState, type ReactNode } from 'react';
import { desktop } from '../desktop';
import { AppleLogo, DOWNLOADS, WindowsLogo } from '../shell/Downloads';
import { LineArt, type ArtName } from '../ui/Illustrations';
import { DotsIcon, PlusSquareIcon, ShareIcon } from '../ui/icons';
import { useT } from '../i18n';

export type Platform = 'mac' | 'windows' | 'ios' | 'android' | 'other';

export function detectPlatform(): Platform {
  const ua = navigator.userAgent;
  // iPadOS Safari introduces itself as a Mac; the touch screen gives it away. It adds to the Home Screen the same way.
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'ios';
  if (/Android/.test(ua)) return 'android';
  if (/Windows/.test(ua)) return 'windows';
  if (/Macintosh|Mac OS X/.test(ua)) return 'mac';
  return 'other';
}

/** Already in the desktop app, or opened from the Home Screen: nothing to offer. */
export function whereToUseNeeded() {
  const standalone = matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
  return !desktop && !standalone;
}

type InstallPrompt = Event & { prompt(): Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> };

/*
 * Chrome on Android offers installing once the page qualifies, usually long before this screen, so the offer is
 * kept from the moment the app loads. It isn't held back (no preventDefault): Chrome's own bar still shows as it
 * did before; the button here opens the same dialog.
 */
let installPrompt: InstallPrompt | null = null;
const promptWatchers = new Set<() => void>();
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    installPrompt = e as InstallPrompt;
    promptWatchers.forEach((f) => f());
  });
  window.addEventListener('appinstalled', () => {
    installPrompt = null;
    promptWatchers.forEach((f) => f());
  });
}

function useInstallPrompt() {
  const [prompt, setPrompt] = useState(installPrompt);
  useEffect(() => {
    const sync = () => setPrompt(installPrompt);
    promptWatchers.add(sync);
    return () => void promptWatchers.delete(sync);
  }, []);
  return prompt;
}

const file = (id: (typeof DOWNLOADS)[number]['id']) => DOWNLOADS.find((d) => d.id === id)!.file;

/**
 * Which Mac: Apple's own chip unless the graphics say Intel. Safari keeps the chip to itself, so this only ever
 * moves an Intel Mac off the default, and nearly every Mac sold since 2021 is Apple's.
 */
function intelMac() {
  try {
    const gl = document.createElement('canvas').getContext('webgl');
    const info = gl?.getExtension('WEBGL_debug_renderer_info');
    return !!gl && !!info && /Intel|AMD|Radeon|NVIDIA/i.test(String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)));
  } catch {
    return false;
  }
}

/*
 * The column of the desktop app's setup window (desktop/onboarding.css): 46 px controls, a white pill for the
 * main action, a quiet one under it.
 */
const primary = 'flex h-[46px] w-full items-center justify-center gap-2 rounded-full bg-[#f2f2f4] text-[15px] font-medium text-[#0c0c0e] transition-colors hover:bg-white';
const quiet = 'flex h-[46px] w-full items-center justify-center rounded-full text-[15px] text-muted transition-colors hover:text-foreground';

/**
 * "Where to use Gomex", shown once after signing up: the desktop app on a computer, the Home Screen on an
 * iPhone, installing on Android, or simply carrying on in the browser.
 */
/** `inWindow`: opened from the rail, where the window's own close is the way out, so no "Stay in browser". */
export function WhereToUse({ onDone, platform = detectPlatform(), inWindow = false }: { onDone: () => void; platform?: Platform; inWindow?: boolean }) {
  if (platform === 'ios') return <OnIPhone onDone={onDone} />;
  if (platform === 'android') return <OnAndroid onDone={onDone} />;
  return <OnComputer onDone={onDone} platform={platform} inWindow={inWindow} />;
}

function Column({ art, title, text, children }: { art: ArtName; title: string; text?: string; children: ReactNode }) {
  return (
    <div className="flex h-full overflow-y-auto bg-background">
      <div className="m-auto flex w-full max-w-[400px] flex-col px-6 pb-10 pt-[max(40px,env(safe-area-inset-top))]">
        <div className="mb-10 flex justify-center">
          <LineArt art={art} scale={2} plate="var(--background)" />
        </div>
        <h1 className="text-[21px] font-medium leading-[1.3] tracking-[-0.01em]">{title}</h1>
        {text && <p className="mt-1.5 text-[15px] text-muted">{text}</p>}
        <div className="mt-7 flex flex-col gap-2">{children}</div>
      </div>
    </div>
  );
}

function OnComputer({ onDone, platform, inWindow }: { onDone: () => void; platform: Platform; inWindow: boolean }) {
  const { t } = useT();
  const [mac] = useState<'mac-intel' | 'mac-arm64'>(() => (platform === 'mac' && intelMac() ? 'mac-intel' : 'mac-arm64'));
  const [started, setStarted] = useState(false);
  const known = platform === 'mac' || platform === 'windows';
  // The rest of the installers, quietly under the main one: the other chip on a Mac, the other system's files.
  const others =
    platform === 'mac'
      ? DOWNLOADS.filter((d) => d.id !== mac)
      : platform === 'windows'
        ? DOWNLOADS.filter((d) => d.id !== 'windows')
        : DOWNLOADS;

  return (
    <Column art="computer" title={t('account.where.computerTitle')} text={t('account.where.computerText')}>
      {started ? (
        <button onClick={onDone} className={primary}>
          {t('account.where.done')}
        </button>
      ) : (
        <>
          {known && (
            <a href={file(platform === 'mac' ? mac : 'windows')} download onClick={() => setStarted(true)} className={primary}>
              {platform === 'mac' ? <AppleLogo size={17} /> : <WindowsLogo size={15} />}
              {platform === 'mac' ? t('account.where.downloadMac') : t('account.where.downloadWindows')}
            </a>
          )}
          {!inWindow && (
            <button onClick={onDone} className={known ? quiet : primary}>
              {t('account.where.stayInBrowser')}
            </button>
          )}
        </>
      )}
      <p className="mt-3 flex justify-center gap-4 text-[13px] text-faint">
        {others.map((d) => (
          <a key={d.id} href={d.file} download onClick={() => setStarted(true)} className="transition-colors hover:text-foreground">
            {d.id === 'windows' ? d.label : `${d.label} ${d.detail}`}
          </a>
        ))}
      </p>
    </Column>
  );
}

/** A step of adding to the Home Screen, written as the system writes it, with the system's own icon. */
function Step({ n, label, icon }: { n: number; label: string; icon: ReactNode }) {
  return (
    <li className="flex h-[46px] items-center gap-3 rounded-[12px] border border-white/[0.07] bg-[#141417] pl-4 pr-3.5">
      <span className="w-3 text-[13px] tabular-nums text-faint">{n}</span>
      <span className="flex-1 text-[15px]">{label}</span>
      <span className="text-muted">{icon}</span>
    </li>
  );
}

function OnIPhone({ onDone }: { onDone: () => void }) {
  const { t } = useT();
  return (
    <Column art="iphone" title={t('account.where.iphoneTitle')}>
      <ol className="mb-5 flex flex-col gap-2">
        <Step n={1} label={t('account.where.share')} icon={<ShareIcon size={19} strokeWidth={1.7} />} />
        <Step n={2} label={t('account.where.addToHome')} icon={<PlusSquareIcon size={19} strokeWidth={1.7} />} />
      </ol>
      <button onClick={onDone} className={primary}>
        {t('account.where.continue')}
      </button>
    </Column>
  );
}

function OnAndroid({ onDone }: { onDone: () => void }) {
  const { t } = useT();
  const prompt = useInstallPrompt();
  const [busy, setBusy] = useState(false);

  async function install() {
    if (!prompt) return;
    setBusy(true);
    try {
      await prompt.prompt();
      if ((await prompt.userChoice).outcome === 'accepted') onDone();
    } catch {
      // Already used, or the browser changed its mind: the browser stays.
    } finally {
      // An offer works once.
      installPrompt = null;
      promptWatchers.forEach((f) => f());
      setBusy(false);
    }
  }

  return (
    <Column art="android" title={t('account.where.androidTitle')} text={prompt ? t('account.where.androidText') : undefined}>
      {prompt ? (
        <>
          <button onClick={install} disabled={busy} className={`${primary} disabled:opacity-60`}>
            {t('account.where.install')}
          </button>
          <button onClick={onDone} className={quiet}>
            {t('account.where.stayInBrowser')}
          </button>
        </>
      ) : (
        <>
          {/* No install offer from this browser: its own menu does the same. */}
          <ol className="mb-5 flex flex-col gap-2">
            <Step n={1} label={t('account.where.browserMenu')} icon={<DotsIcon size={19} className="rotate-90" />} />
            <Step n={2} label={t('account.where.addToHomeAndroid')} icon={<PlusSquareIcon size={19} strokeWidth={1.7} />} />
          </ol>
          <button onClick={onDone} className={primary}>
            {t('account.where.continue')}
          </button>
        </>
      )}
    </Column>
  );
}
