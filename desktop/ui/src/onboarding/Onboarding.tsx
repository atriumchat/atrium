import { useEffect, useRef, useState, type ReactNode } from 'react';
import { domainOk, emailOk, freeName, hostOk, jobFill, mailboxOf, MOCK_DOMAIN, nameOk, ownOnDesktop, pickTurn, readServerLetter, RENT, TASKS, type OwnDesktopStep as Step } from '@atrium/setup';
import { Drum, FlowPrimary, FlowProvider, FlowSecondary, FlowShell, FlowStep, KeptRow, LineField, RadioRow, TextAction } from '@atrium/ui-web';
import type { DrumItem } from '@atrium/ui-common';
import { t } from '../i18n';
import { setup, standIn, type InstallEvent } from './bridge';
import './onboarding.css';

/**
 * "Your own server" in the desktop app: a fresh VPS becomes an Atrium server, then the app opens its first-run wizard.
 * The steps, their scale and the way back are @atrium/setup's ownOnDesktop; the parts are Atrium Flow's (DESIGN.md);
 * the SSH, deSEC and the install run in the main process (server-setup.js) through the bridge.
 */

type Facts = { ip: string; os: string; size: string };
type RowState = DrumItem['state'];

// A letter for an e-mail that already has a deSEC account never comes; after this long the ways on are offered.
const MAIL_LATE = location.hash.includes('slowmail') ? 5000 : 15 * 60 * 1000;
// A name made minutes ago may not reach this computer for a while; then the button opens anyway.
const OPEN_ANYWAY = 4 * 60 * 1000;

export function Onboarding() {
  const [step, setStep] = useState<{ id: Step; back: boolean; n: number }>({ id: 'server', back: false, n: 0 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const turn = useRef(pickTurn()).current;

  // 1. The server.
  const [host, setHost] = useState('');
  const [user, setUser] = useState('root');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [badHost, setBadHost] = useState(false);
  const [facts, setFacts] = useState<Facts | null>(null);
  // No server yet: the host's letter, pasted, gives the fields above.
  const [letter, setLetter] = useState('');

  // 2. The address.
  const [way, setWay] = useState<'free' | 'own'>('free');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [savedDomain, setSavedDomain] = useState<string | null>(null);
  const [savedError, setSavedError] = useState('');
  const [mail, setMail] = useState<'waiting' | 'confirmed' | 'failed'>('waiting');
  const [mailLate, setMailLate] = useState(false);
  const [domain, setDomain] = useState('');
  const [address, setAddress] = useState<string | null>(null);

  // 3. The install.
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [current, setCurrent] = useState<string | null>(null);
  const [failed, setFailed] = useState('');
  const [done, setDone] = useState<{ url: string; shown: string } | null>(null);
  const [open, setOpen] = useState(false);
  const opening = useRef(0);

  function go(id: Step, back = false) {
    setError('');
    setStep((s) => ({ id, back, n: s.n + 1 }));
  }

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await action();
    } finally {
      setBusy(false);
    }
  }

  /* ---------- 1. the server ---------- */

  const serverReady = hostOk(host) && !!user.trim() && !!password;
  const connect = () =>
    serverReady &&
    void run(async () => {
      const answer = await setup.connect({ host: host.trim(), user: user.trim() || 'root', password }).catch(() => ({ error: t('ssh.noReply') }) as const);
      if ('error' in answer) {
        setError(answer.error);
        setBadHost('field' in answer && answer.field === 'host');
        return;
      }
      setFacts(answer.facts);
      go('address');
    });

  const found = readServerLetter(letter);
  const takeLetter = () => {
    if (!found) return;
    setHost(found.host);
    setUser(found.user);
    setPassword(found.password);
    setBadHost(false);
    go('server', true);
  };

  /* ---------- 2. the address ---------- */

  // An address this computer has from an earlier server: deSEC allows one name per e-mail, so it's offered first.
  useEffect(() => {
    if (step.id !== 'free-name') return;
    setSavedError('');
    void setup.savedAddress().then(({ domain }) => setSavedDomain(domain));
  }, [step.id]);

  const takeSaved = () =>
    void run(async () => {
      const answer = await setup.useSaved({ ip: facts?.ip ?? '' });
      if ('error' in answer) return setSavedError(answer.error);
      setAddress(answer.domain);
      install(answer.domain);
    });

  // Whether the name is free is deSEC's answer to the sign-up itself; then the letter.
  const freeReady = nameOk(name) && emailOk(email);
  const register = () =>
    freeReady &&
    void run(async () => {
      const answer = await setup.register({ name: freeName(name), email: email.trim() });
      if ('error' in answer) return setError(answer.error);
      waitForMail();
    });

  function waitForMail() {
    setMail('waiting');
    setMailLate(false);
    go('free-mail');
  }

  useEffect(() => {
    if (step.id !== 'free-mail' || mail !== 'waiting') return;
    let gone = false;
    let onward = 0;
    const late = setTimeout(() => setMailLate(true), MAIL_LATE);
    void setup.waitMail({ ip: facts?.ip ?? '' }).then((answer) => {
      if (gone) return;
      clearTimeout(late);
      if ('error' in answer) {
        setMail('failed');
        setError(answer.error);
        return;
      }
      setMail('confirmed');
      setMailLate(false);
      const confirmed = `${freeName(name)}.dedyn.io`;
      setAddress(confirmed);
      onward = window.setTimeout(() => install(confirmed), 900);
    });
    return () => {
      gone = true;
      clearTimeout(late);
      clearTimeout(onward);
    };
    // Waits once per visit to the step.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step.n]);

  const leaveMail = (to: Step, back = false) => {
    setup.cancelMail();
    go(to, back);
  };

  const domainName = domain.trim().toLowerCase();
  const checkDomain = () =>
    domainOk(domainName) &&
    void run(async () => {
      const answer = await setup.checkDomain({ domain: domainName, turn, ip: facts?.ip ?? '' });
      if ('error' in answer) return setError(answer.error);
      setAddress(domainName);
      install(domainName);
    });

  /* ---------- 3. the install ---------- */

  function install(domain = address ?? '') {
    setRows({});
    setCurrent(TASKS[0]);
    setFailed('');
    setDone(null);
    setOpen(false);
    clearTimeout(opening.current);
    go('install');
    // The installer reports its own steps; a row is done once a later one starts (a step the server didn't need is
    // simply passed by).
    const onEvent = (event: InstallEvent) => {
      if (event.step) {
        const at = TASKS.indexOf(event.step as (typeof TASKS)[number]);
        if (at < 0 || event.state === 'sub') return;
        if (event.state === 'run' || event.state === 'done') {
          setRows((r) => ({ ...r, ...Object.fromEntries(TASKS.slice(0, at).map((id) => [id, 'done'])), [event.step!]: event.state === 'run' ? (r[event.step!] ?? 'run') : 'done' }));
          setCurrent(event.step);
        } else if (event.state === 'fail') {
          setRows((r) => ({ ...r, [event.step!]: 'fail' }));
          setCurrent(event.step);
        }
        return;
      }
      if (event.state === 'fail') setFailed(('why' in event && event.why) || t('ob.install.failed'));
      if (event.state === 'ready') {
        setRows(Object.fromEntries(TASKS.map((id) => [id, 'done'])));
        setCurrent(null);
        setDone({ url: event.url, shown: event.url.replace(/^https:\/\//, '').replace(/\/\?.*$/, '') });
        // The main window shows its own page if opened too early, so a name that stays away doesn't lock the button.
        opening.current = window.setTimeout(() => setOpen(true), OPEN_ANYWAY);
      }
      if (event.state === 'open') {
        clearTimeout(opening.current);
        setOpen(true);
      }
    };
    setup.install({ domain, turn }, onEvent).catch(() => setFailed(t('ob.install.failed')));
  }

  /* ---------- design work in a browser: #step=address (or free-name, free-mail, own, install) ---------- */

  useEffect(() => {
    const jump = standIn && (location.hash.match(/step=([\w-]+)/)?.[1] as Step | 'done' | undefined);
    if (!jump || jump === 'server') return;
    setHost('2.27.52.78');
    setPassword('secret');
    setFacts({ ip: '2.27.52.78', os: 'Ubuntu 24.04 LTS · x86_64', size: t('ssh.size', { memory: 2, disk: 18 }) });
    setName('podval');
    setEmail('you@gmail.com');
    setAddress(MOCK_DOMAIN);
    if (jump === 'own') setDomain('chat.podval.ru');
    if (jump === 'install' || jump === 'done') install(MOCK_DOMAIN);
    else if (jump in ownOnDesktop.steps) go(jump as Step);
    // Once, on opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------- the scale, the line over the title, back ---------- */

  const doneRows = TASKS.filter((id) => rows[id] === 'done').length;
  const fill = step.id === 'install' ? jobFill(ownOnDesktop.fill('install'), 1, doneRows, TASKS.length, !!done) : ownOnDesktop.fill(step.id);
  const stage = ownOnDesktop.stage(step.id);
  const backTo = ownOnDesktop.back(step.id, { way });
  const back = backTo ? () => go(backTo, true) : undefined;

  // The step's first field takes the focus once the step has settled (mid-animation it would drag the step to it).
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const timer = setTimeout(() => box.current?.querySelector<HTMLInputElement>('input:not([disabled])')?.focus({ preventScroll: true }), 560);
    return () => clearTimeout(timer);
  }, [step.n]);

  function screen(): ReactNode {
    switch (step.id) {
      case 'server':
        return (
          <FlowStep
            title={t('ob.server.h')}
            sub={t('ob.server.sub')}
            error={error}
            onSubmit={connect}
            actions={<FlowPrimary type="submit" busy={busy} disabled={!serverReady}>{t('ob.connect')}</FlowPrimary>}
            below={<TextAction onPress={() => go('rent')}>{t('ob.rent.link')}</TextAction>}
          >
            <div className="flow-pair">
              <LineField label={t('ob.ip')} value={host} onChange={(e) => (setHost(e.target.value), setBadHost(false), setError(''))} placeholder="203.0.113.10" bad={badHost} />
              {/* The login is almost always root, so it's filled in, in plain sight next to the address. */}
              <LineField label={t('ob.login')} value={user} onChange={(e) => (setUser(e.target.value), setError(''))} />
            </div>
            <LineField
              label={t('ob.password')}
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => (setPassword(e.target.value), setError(''))}
              placeholder={t('ob.passwordHint')}
              trailing={
                <button className="eye" type="button" aria-label={t('ob.showPassword')} aria-pressed={showPassword} onClick={() => setShowPassword((v) => !v)}>
                  {/* What the field shows now: an eye while the password is in sight, crossed out while it's hidden. */}
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    {showPassword ? (
                      <>
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                        <circle cx="12" cy="12" r="3" />
                      </>
                    ) : (
                      <>
                        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                        <path d="M1 1l22 22" />
                      </>
                    )}
                  </svg>
                </button>
              }
            />
          </FlowStep>
        );

      case 'rent':
        return (
          <FlowStep
            title={t('ob.rent.h')}
            sub={t('ob.rent.sub', { host: RENT.host })}
            note={found ? t('ob.rent.found', { ip: found.host }) : letter.trim() ? t('ob.rent.notFound') : undefined}
            onBack={back}
            onSubmit={takeLetter}
            actions={<FlowPrimary type="submit" disabled={!found}>{t('ob.next')}</FlowPrimary>}
            below={<TextAction onPress={() => go('server', true)}>{t('ob.rent.manual')}</TextAction>}
          >
            <ol className="rent">
              <li>
                <span className="grow">
                  <b>{t('ob.rent.signUp')}</b>
                  <small>{t('ob.rent.signUpSub', { host: RENT.host })}</small>
                </span>
                <TextAction onPress={() => setup.openExternal(RENT.url)}>{t('ob.rent.open')}</TextAction>
              </li>
              <li>
                <b>{t('ob.rent.topUp')}</b>
                <small>{t('ob.rent.topUpSub')}</small>
              </li>
              <li>
                <b>{t('ob.rent.create')}</b>
                <small>{t('ob.rent.createSub', { os: RENT.os })}</small>
              </li>
            </ol>
            <LineField label={t('ob.rent.letter')} value={letter} onChange={(e) => setLetter(e.target.value)} placeholder={t('ob.rent.letterHint')} />
          </FlowStep>
        );

      case 'address':
        return (
          <FlowStep title={t('ob.address.h')} sub={t('ob.address.sub')} onBack={back} onSubmit={() => go(way === 'free' ? 'free-name' : 'own')} actions={<FlowPrimary type="submit">{t('ob.next')}</FlowPrimary>}>
            <div role="radiogroup" aria-label={t('ob.address.aria')}>
              <RadioRow title={t('ob.free')} sub={t('ob.freeSub')} on={way === 'free'} onPress={() => setWay('free')} />
              <RadioRow title={t('ob.own')} sub={t('ob.ownSub')} on={way === 'own'} onPress={() => setWay('own')} last />
            </div>
          </FlowStep>
        );

      case 'free-name':
        return (
          <FlowStep
            title={t('ob.free')}
            sub={t('ob.free.sub')}
            error={error}
            onBack={back}
            onSubmit={register}
            actions={<FlowPrimary type="submit" busy={busy} disabled={!freeReady}>{t('ob.next')}</FlowPrimary>}
          >
            {savedDomain ? (
              <div>
                <KeptRow label={t('ob.savedName', { domain: savedDomain })} go={t('ob.useSaved')} onPress={takeSaved} />
                {savedError ? <p className="flow-error" role="alert">{savedError}</p> : null}
              </div>
            ) : null}
            <LineField label={t('ob.name')} value={name} onChange={(e) => (setName(freeName(e.target.value)), setError(''))} placeholder="podval" suffix=".dedyn.io" />
            <LineField label={t('ob.email')} type="email" value={email} onChange={(e) => (setEmail(e.target.value), setError(''))} placeholder="you@gmail.com" />
          </FlowStep>
        );

      case 'free-mail': {
        const box = mailboxOf(email);
        return (
          <FlowStep
            title={t('ob.mail.h')}
            sub={t('ob.mail.sub')}
            error={error}
            note={t('ob.mail.spam')}
            actions={box ? <FlowPrimary onPress={() => setup.openExternal(box.url)}>{t(`ob.mail.${box.id}`)}</FlowPrimary> : undefined}
            aside={<FlowSecondary onPress={() => leaveMail('free-name', true)}>{t('ob.mail.other')}</FlowSecondary>}
            below={mailLate ? <TextAction onPress={() => leaveMail('own')}>{t('ob.own')}</TextAction> : undefined}
          >
            <div>
              <p className="flow-big">{email.trim()}</p>
              {mail !== 'failed' ? (
                <p className={`wait${mail === 'confirmed' ? ' done' : ''}`}>
                  <span className="spinner" />
                  {mail === 'confirmed' ? t('ob.mail.confirmed') : t('ob.mail.waiting')}
                </p>
              ) : null}
              {mailLate ? <p className="late">{t('ob.mail.late')}</p> : null}
            </div>
          </FlowStep>
        );
      }

      case 'own':
        return (
          <FlowStep
            title={t('ob.own')}
            sub={t('ob.own.sub')}
            error={error}
            onBack={back}
            onSubmit={checkDomain}
            actions={<FlowPrimary type="submit" busy={busy} disabled={!domainOk(domainName)}>{t('ob.check')}</FlowPrimary>}
          >
            <LineField label={t('ob.domain')} value={domain} onChange={(e) => (setDomain(e.target.value), setError(''))} placeholder="chat.example.com" />
            {domainOk(domainName) ? <Records names={[domainName, `app.${domainName}`, `${turn}.${domainName}`]} ip={facts?.ip ?? ''} /> : null}
          </FlowStep>
        );

      case 'install':
        return (
          <FlowStep
            title={done ? t('ob.install.ready') : t('ob.install.title')}
            sub={done ? (open ? done.shown : t('ob.install.spreading')) : t('ob.install.sub')}
            error={failed}
            actions={
              failed ? (
                <FlowPrimary onPress={() => install()}>{t('ob.install.retry')}</FlowPrimary>
              ) : (
                <FlowPrimary disabled={!open} onPress={() => done && setup.openServer(done.url)}>{t('ob.install.open')}</FlowPrimary>
              )
            }
          >
            <Drum
              // The last row becomes the end of it all.
              items={TASKS.map((id, i) => ({ id, label: done && i === TASKS.length - 1 ? t('ob.install.all') : t(`ob.task.${id}`), state: rows[id] }))}
              current={done ? (TASKS.at(-1) ?? null) : current}
            />
          </FlowStep>
        );
    }
  }

  return (
    <FlowProvider labels={{ back: t('ob.back') }}>
      <FlowShell fill={fill} label={stage ? t('ob.stageOf', { stage: t(`ob.stage.${stage.part}`), n: stage.n, total: stage.total }) : undefined}>
        <div ref={box} key={step.n} className={step.back ? 'flow-swap back-in' : 'flow-swap'}>
          {screen()}
        </div>
      </FlowShell>
    </FlowProvider>
  );
}

const COPY = 'M8.5 8.5h12v12h-12zM15.5 8.5V6a2.5 2.5 0 0 0-2.5-2.5H6A2.5 2.5 0 0 0 3.5 6v7A2.5 2.5 0 0 0 6 15.5h2.5';
const DONE = 'M5 12.5l4.5 4.5L19 7.5';

/** The three A records a domain of one's own needs, each with its copy button. */
function Records({ names, ip }: { names: string[]; ip: string }) {
  const [copied, setCopied] = useState<string | null>(null);
  async function copy(name: string) {
    await navigator.clipboard.writeText(name).catch(() => undefined);
    setCopied(name);
    setTimeout(() => setCopied((c) => (c === name ? null : c)), 1200);
  }
  return (
    <div className="records">
      {names.map((name) => (
        <div className="row" key={name}>
          <span className="type">A</span>
          <code title={name}>{name}</code>
          <span className="to">{ip}</span>
          {/* A round icon, not a word: a long name needs the row's width. */}
          <button className="icon" type="button" title={t('ob.copy')} aria-label={t('ob.copy')} onClick={() => void copy(name)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d={copied === name ? DONE : COPY} />
            </svg>
          </button>
        </div>
      ))}
    </div>
  );
}
