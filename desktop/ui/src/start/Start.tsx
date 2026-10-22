import { useEffect, useState } from 'react';
import { FlowPrimary, FlowProvider, FlowShell, FlowStep, LineField, RadioRow } from '@atrium/ui-web';
import { lang, t } from '../i18n';

/**
 * The desktop app's first window. It opens on a welcome (the app's icon as on the site, its ticks lighting up round it,
 * the greeting, Get started), then, in the flow look the phone and the web sign in with (DESIGN.md), what you're here
 * for and the one field it needs. An account: the server's address, and the app opens straight on sign-in. An
 * invite: the link, and sign-up comes with it. Your own server: the setup window takes over. From the tray later
 * (?first absent) it's only the address, to move the app to a new one.
 */

type Way = 'account' | 'invite' | 'own';
type Step = 'welcome' | 'choose' | 'account' | 'invite' | 'move';

const params = new URLSearchParams(location.search);
const first = Boolean(params.get('first'));
const placeholder = params.get('placeholder') || 'https://app.example.com';

/** The main process's side (address-preload.js); opened in a browser for design work there's none. */
const bridge = (window as unknown as { atriumAddress?: AddressBridge }).atriumAddress ?? {
  save: async (url: string) => (url.startsWith('https://') ? new Promise<never>(() => undefined) : t('address.needHttps')),
  setup: async () => undefined,
  language: async (choice: 'ru' | 'en') => {
    location.search = new URLSearchParams({ ...Object.fromEntries(params), lang: choice }).toString();
  },
};
type AddressBridge = {
  /** An error in the app's words, or never (the app restarts on success). */
  save(url: string, opts?: { signIn?: boolean }): Promise<string | undefined>;
  setup(): Promise<void>;
  language(choice: 'ru' | 'en'): Promise<void>;
};

export function Start() {
  const [step, setStep] = useState<Step>(first ? 'welcome' : 'move');
  const [way, setWay] = useState<Way>('account');
  const [value, setValue] = useState(first ? '' : (params.get('current') ?? ''));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Which way the last move went: a step forward slides in, a step back fades in (flow.css, .flow-swap).
  const [backward, setBackward] = useState(false);

  function go(next: Step, isBack = false) {
    setError(null);
    setValue('');
    setBackward(isBack);
    setStep(next);
  }
  const back = first ? () => go('choose', true) : undefined;

  async function save(signIn: boolean) {
    setBusy(true);
    setError(null);
    const problem = await bridge.save(value.trim(), { signIn });
    setBusy(false);
    if (problem) setError(problem);
  }

  function screen() {
    switch (step) {
      case 'choose':
        return (
          <FlowStep
            title="Atrium"
            sub={t('start.tagline')}
            onSubmit={() => (way === 'own' ? void bridge.setup() : go(way))}
            actions={<FlowPrimary type="submit">{t('start.next')}</FlowPrimary>}
          >
            <div role="radiogroup">
              <RadioRow title={t('start.have')} sub={t('start.haveSub')} on={way === 'account'} onPress={() => setWay('account')} />
              <RadioRow title={t('start.invited')} sub={t('address.haveInviteSub')} on={way === 'invite'} onPress={() => setWay('invite')} />
              <RadioRow title={t('address.own')} sub={t('address.ownSub')} on={way === 'own'} onPress={() => setWay('own')} last />
            </div>
          </FlowStep>
        );
      case 'account':
        return (
          <FlowStep
            title={t('address.title')}
            error={error}
            onBack={back}
            onSubmit={() => value.trim() && void save(true)}
            actions={<FlowPrimary type="submit" busy={busy} disabled={!value.trim()}>{t('address.open')}</FlowPrimary>}
          >
            <LineField label={t('start.addressField')} value={value} onChange={(e) => setValue(e.target.value)} placeholder={placeholder} autoFocus autoCapitalize="off" spellCheck={false} />
          </FlowStep>
        );
      case 'invite':
        return (
          <FlowStep
            title={t('address.inviteTitle')}
            error={error}
            onBack={back}
            onSubmit={() => value.trim() && void save(false)}
            actions={<FlowPrimary type="submit" busy={busy} disabled={!value.trim()}>{t('address.open')}</FlowPrimary>}
          >
            <LineField label={t('start.inviteField')} value={value} onChange={(e) => setValue(e.target.value)} placeholder={`${placeholder}/?invite=…`} autoFocus autoCapitalize="off" spellCheck={false} />
          </FlowStep>
        );
      case 'move':
        return (
          <FlowStep
            title={t('address.title')}
            sub={t('address.hint')}
            error={error}
            onSubmit={() => value.trim() && void save(false)}
            actions={<FlowPrimary type="submit" busy={busy} disabled={!value.trim()}>{t('address.save')}</FlowPrimary>}
          >
            <LineField label={t('start.addressField')} value={value} onChange={(e) => setValue(e.target.value)} placeholder={placeholder} autoFocus autoCapitalize="off" spellCheck={false} />
          </FlowStep>
        );
    }
  }

  // The very first thing the app shows: the icon, its ticks lighting up round it, the greeting, one button.
  if (step === 'welcome') {
    return (
      <>
        <div className="flow-corner">
          <LangButton />
        </div>
        <Welcome onStart={() => setStep('choose')} />
      </>
    );
  }

  // No scale here: there's nothing long to measure, so the ruler stays empty.
  return (
    <FlowProvider labels={{ back: t('start.back') }}>
      <FlowShell fill={0} corner={<LangButton />}>
        <div key={step} className={backward ? 'flow-swap back-in' : 'flow-swap'}>
          {screen()}
        </div>
      </FlowShell>
    </FlowProvider>
  );
}

/** The globe in the corner, as on the landing and the web's sign-in: the other language, which it switches to. */
function LangButton() {
  const other = lang === 'ru' ? 'en' : 'ru';
  return (
    <button type="button" className="flow-corner-button" onClick={() => void bridge.language(other)} aria-label={other === 'en' ? 'English' : 'Русский'}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <ellipse cx="12" cy="12" rx="4" ry="9" />
        <path d="M3 12h18" />
        <path d="M4.5 7.5h15" />
        <path d="M4.5 16.5h15" />
      </svg>
      {other.toUpperCase()}
    </button>
  );
}

/** The welcome: the white tile with the mark inside a ring of ticks that light up one by one, then the words rise. */
function Welcome({ onStart }: { onStart: () => void }) {
  // The window is made hidden while the splash plays (main.js): the welcome waits to be seen before it moves.
  const [seen, setSeen] = useState(() => document.visibilityState === 'visible');
  // "Get started" first lets the welcome slip away (start.css, .leaving), then the first step slides in.
  const [leaving, setLeaving] = useState(false);
  function start() {
    if (leaving) return;
    setLeaving(true);
    setTimeout(onStart, matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 200);
  }
  useEffect(() => {
    if (seen) return;
    const look = () => document.visibilityState === 'visible' && setSeen(true);
    document.addEventListener('visibilitychange', look);
    return () => document.removeEventListener('visibilitychange', look);
  }, [seen]);
  return (
    <main className={`welcome${seen ? ' seen' : ''}${leaving ? ' leaving' : ''}`}>
      <div className="welcome-icon">
        <span className="welcome-ticks" aria-hidden="true" />
        <span className="welcome-tile" aria-hidden="true">
          <svg viewBox="-10 -25 150 150" width="56" height="56">
            <path
              fill="currentColor"
              d="M53.37 0L76.63 0A7 7 0 0 1 82.92 3.92L126.47 92.8A5 5 0 0 1 121.98 100L89 100A2 2 0 0 1 87 98L87 62A22 22 0 0 0 43 62L43 98A2 2 0 0 1 41 100L8.02 100A5 5 0 0 1 3.53 92.8L47.08 3.92A7 7 0 0 1 53.37 0Z"
            />
          </svg>
        </span>
      </div>
      <h1 className="welcome-title welcome-rise" style={{ animationDelay: '0.9s' }}>
        {t('start.welcome')}
      </h1>
      <p className="welcome-sub welcome-rise" style={{ animationDelay: '1.05s' }}>
        {t('start.tagline')}
      </p>
      <button type="button" className="welcome-go welcome-rise" style={{ animationDelay: '1.25s' }} onClick={start}>
        {t('start.begin')}
      </button>
    </main>
  );
}
