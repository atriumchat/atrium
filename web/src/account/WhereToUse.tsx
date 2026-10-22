import { useEffect, useState, type ReactNode } from 'react';
import { FlowPrimary, FlowShell, FlowStep, TextAction } from '@gomex/ui-web';
import { desktop } from '../desktop';
import { DOWNLOADS } from '../shell/Downloads';
import { DotsIcon, PlusSquareIcon, ShareIcon } from '../ui/icons';
import { useT } from '../i18n';
import './whereToUse.css';

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

/** Starts a download, as a link with `download` would. */
function fetchFile(href: string) {
  Object.assign(document.createElement('a'), { href, download: '' }).click();
}

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

/**
 * "Where to use Atrium", in the flow look, shown once after signing up: the desktop app on a computer, the Home Screen
 * on an iPhone, installing on Android, or simply carrying on in the browser.
 * `inWindow`: opened from the rail, where the window's own close is the way out, so no "Stay in browser".
 */
export function WhereToUse({ onDone, platform = detectPlatform(), inWindow = false }: { onDone: () => void; platform?: Platform; inWindow?: boolean }) {
  const step = platform === 'ios' ? <OnIPhone onDone={onDone} /> : platform === 'android' ? <OnAndroid onDone={onDone} /> : <OnComputer onDone={onDone} platform={platform} inWindow={inWindow} />;
  // After sign-up it's the end of the way in, the scale full; in the rail's window, a step sized to its content.
  return inWindow ? <div className="where-window">{step}</div> : <FlowShell fill={1}>{step}</FlowShell>;
}

function OnComputer({ onDone, platform, inWindow }: { onDone: () => void; platform: Platform; inWindow: boolean }) {
  const { t } = useT();
  const [mac] = useState<'mac-intel' | 'mac-arm64'>(() => (platform === 'mac' && intelMac() ? 'mac-intel' : 'mac-arm64'));
  const [started, setStarted] = useState(false);
  const known = platform === 'mac' || platform === 'windows';
  // The rest of the installers, quietly under the main one: the other chip on a Mac, the other system's files.
  const others = platform === 'mac' ? DOWNLOADS.filter((d) => d.id !== mac) : platform === 'windows' ? DOWNLOADS.filter((d) => d.id !== 'windows') : DOWNLOADS;
  const download = (href: string) => (fetchFile(href), setStarted(true));

  return (
    <FlowStep
      title={t('account.where.computerTitle')}
      sub={t('account.where.computerText')}
      actions={
        started ? (
          <FlowPrimary onPress={onDone}>{t('account.where.done')}</FlowPrimary>
        ) : known ? (
          <FlowPrimary onPress={() => download(file(platform === 'mac' ? mac : 'windows'))}>
            {platform === 'mac' ? t('account.where.downloadMac') : t('account.where.downloadWindows')}
          </FlowPrimary>
        ) : (
          <FlowPrimary onPress={onDone}>{t('account.where.stayInBrowser')}</FlowPrimary>
        )
      }
      below={!started && known && !inWindow ? <TextAction onPress={onDone}>{t('account.where.stayInBrowser')}</TextAction> : undefined}
    >
      <div className="flow-actions">
        {others.map((d) => (
          <TextAction key={d.id} left onPress={() => download(d.file)}>
            {d.id === 'windows' ? d.label : `${d.label} ${d.detail}`}
          </TextAction>
        ))}
      </div>
    </FlowStep>
  );
}

/** Adding to the Home Screen, step by step as the system writes it, with the system's own icon. */
function Steps({ steps }: { steps: { label: string; icon: ReactNode }[] }) {
  return (
    <ol className="where-steps">
      {steps.map((s, i) => (
        <li key={s.label}>
          <span className="n">{i + 1}</span>
          <span className="label">{s.label}</span>
          <span className="icon">{s.icon}</span>
        </li>
      ))}
    </ol>
  );
}

function OnIPhone({ onDone }: { onDone: () => void }) {
  const { t } = useT();
  return (
    <FlowStep title={t('account.where.iphoneTitle')} onSubmit={onDone} actions={<FlowPrimary type="submit">{t('account.where.continue')}</FlowPrimary>}>
      <Steps
        steps={[
          { label: t('account.where.share'), icon: <ShareIcon size={19} strokeWidth={1.7} /> },
          { label: t('account.where.addToHome'), icon: <PlusSquareIcon size={19} strokeWidth={1.7} /> },
        ]}
      />
    </FlowStep>
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

  return prompt ? (
    <FlowStep
      title={t('account.where.androidTitle')}
      sub={t('account.where.androidText')}
      actions={<FlowPrimary busy={busy} onPress={() => void install()}>{t('account.where.install')}</FlowPrimary>}
      below={<TextAction onPress={onDone}>{t('account.where.stayInBrowser')}</TextAction>}
    />
  ) : (
    // No install offer from this browser: its own menu does the same.
    <FlowStep title={t('account.where.androidTitle')} onSubmit={onDone} actions={<FlowPrimary type="submit">{t('account.where.continue')}</FlowPrimary>}>
      <Steps
        steps={[
          { label: t('account.where.browserMenu'), icon: <DotsIcon size={19} className="rotate-90" /> },
          { label: t('account.where.addToHomeAndroid'), icon: <PlusSquareIcon size={19} strokeWidth={1.7} /> },
        ]}
      />
    </FlowStep>
  );
}
