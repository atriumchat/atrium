import { useEffect, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import { InputOTP, REGEXP_ONLY_DIGITS_AND_CHARS } from '@heroui/react';
import { api, setToken } from '../api';
import { useT } from '../i18n';
import { inviteLink } from '../people/invite';
import { CopyButton } from '../ui/CopyButton';
import { GomexMark } from '../ui/Logo';
import { CheckIcon, UserPlusIcon } from '../ui/icons';
import { IconCropper, centred, cropToBlob, cropToUrl, loadImage, type Crop } from '../ui/IconCropper';
import { SetupScenes, type Facts, type SceneName } from './SetupScenes';
import './setup.css';

/**
 * First run on a fresh server, shown while it has no accounts. The desktop app's "Your own server" sets the server up and
 * opens this page with the setup code in the address (?setup=CODE), in the same window: this is the second half of
 * that setup and looks the same (setup.css, after desktop/onboarding.css). The server's name and icon, the admin,
 * their recovery key, the first invite link, and done.
 */

type StepId = 'code' | 'server' | 'crop' | 'admin' | 'key' | 'invite' | 'done';

// The picture on the right for each step (SetupScenes).
const SCENE: Record<StepId, SceneName> = { code: 'code', server: 'server', crop: 'server', admin: 'admin', key: 'key', invite: 'invite', done: 'room' };

// install.sh makes the code 10 letters and digits (INVITE_CODE in .env).
const CODE_LENGTH = 10;

const EYE = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);
const DONE = <CheckIcon size={14} strokeWidth={2.5} />;

/** The code out of anything pasted: the whole link from the installer, or the code itself. */
function codeFrom(text: string) {
  let value = text.trim();
  try {
    value = new URL(value).searchParams.get('setup') ?? value;
  } catch {
    // Not a link: the code itself.
  }
  return value.replace(/[^a-zA-Z0-9]/g, '').slice(0, CODE_LENGTH);
}

const letter = (name: string) => name.trim().charAt(0).toUpperCase() || '?';

/** The key in two lines of groups (a long one), each breakable only between groups. */
function keyLines(key: string) {
  const groups = key.split('-');
  const half = groups.length > 4 ? Math.ceil(groups.length / 2) : groups.length;
  return [groups.slice(0, half), groups.slice(half)].filter((g) => g.length).map((g) => g.join('-'));
}

/** A long file name loses the middle of its name, never the extension: "32-351-785…jpg". */
function FileName({ name }: { name: string }) {
  const dot = name.lastIndexOf('.');
  const cut = dot > 0 && name.length - dot <= 6 ? dot : name.length;
  return (
    <span className="file-name">
      <span>{name.slice(0, cut)}</span>
      {name.slice(cut)}
    </span>
  );
}

function useWide() {
  const query = '(min-width: 821px)';
  const [wide, setWide] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query);
    const sync = () => setWide(media.matches);
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);
  return wide;
}

function Primary({
  busy = false,
  disabled = false,
  type = 'button',
  onClick,
  children,
}: {
  busy?: boolean;
  disabled?: boolean;
  type?: 'button' | 'submit';
  onClick?: () => void;
  children: ReactNode;
}) {
  return (
    <button type={type} className={`primary${busy ? ' busy' : ''}`} disabled={disabled || busy} onClick={onClick}>
      {children}
    </button>
  );
}

// Design work, development only: #step=server (or code, admin, key, invite, done) opens that step with made-up answers
// and nothing sent to the server, as desktop/onboarding.html does; #t=7000 also stops the cameras then (SetupScenes).
export const DEMO = import.meta.env.DEV ? (window.location.hash.match(/step=(code|server|admin|key|invite|done)\b/)?.[1] as StepId | undefined) : undefined;
const ORDER: StepId[] = ['code', 'server', 'crop', 'admin', 'key', 'invite', 'done'];
const past = (id: StepId) => !!DEMO && ORDER.indexOf(DEMO) > ORDER.indexOf(id);

export function SetupWizard({ onDone }: { onDone: () => void }) {
  const { t } = useT();
  const [fromUrl] = useState(() => codeFrom(new URLSearchParams(window.location.search).get('setup') ?? ''));
  // The code step is only on the way when the address didn't bring the code (or brought a wrong one).
  const [askCode, setAskCode] = useState(DEMO ? DEMO === 'code' : !fromUrl);
  const [code, setCode] = useState(fromUrl);

  const [step, setStep] = useState<{ id: StepId; back: boolean; n: number }>({ id: DEMO ?? (fromUrl ? 'server' : 'code'), back: false, n: 0 });
  const current = useRef(step);
  current.current = step;
  const [leaving, setLeaving] = useState<{ id: StepId; n: number } | null>(null);
  const leaveTimer = useRef(0);
  const stepRef = useRef<HTMLElement>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const [defaultName, setDefaultName] = useState('Gomex');
  const [serverName, setServerName] = useState(past('code') ? t('setup.server.namePlaceholder') : '');
  const fileInput = useRef<HTMLInputElement>(null);
  // The icon as chosen, and the picture being cropped right now (a new one, or the chosen one again).
  const [icon, setIcon] = useState<{ image: HTMLImageElement; crop: Crop; name: string } | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ image: HTMLImageElement; crop: Crop; name: string } | null>(null);
  const [draftPreview, setDraftPreview] = useState<string | null>(null);

  const [nick, setNick] = useState(past('crop') ? t('setup.admin.nickPlaceholder') : '');
  const [password, setPassword] = useState(nick && 'password');
  const [repeat, setRepeat] = useState(password);
  const [showPassword, setShowPassword] = useState(false);
  // What's already done on the server, so a retry after an error doesn't do it twice.
  const [account, setAccount] = useState<{ color: string; serverName: string } | null>(past('admin') ? { color: '#5865f2', serverName: t('setup.server.namePlaceholder') } : null);
  const [iconSent, setIconSent] = useState(false);

  const [key, setKey] = useState(account ? 'K7QM-2XPA-9DHR-T4WC' : '');
  const [keyKept, setKeyKept] = useState<'copied' | 'downloaded' | 'kept' | null>(past('key') ? 'copied' : null);
  const [link, setLink] = useState(account ? `${window.location.origin}/?invite=7F3K9QAB` : '');
  const [linkSent, setLinkSent] = useState<'copied' | 'shared' | null>(past('invite') ? 'copied' : null);

  const wide = useWide();
  const name = serverName.trim() || defaultName;
  const host = window.location.host;

  // The step before goes out first, then this one comes in (setup.css): the two never show at once.
  function go(id: StepId, back = false, problem = '') {
    const from = current.current;
    current.current = { id, back, n: from.n + 1 };
    setError(problem);
    setLeaving({ id: from.id, n: from.n });
    setStep(current.current);
    clearTimeout(leaveTimer.current);
    leaveTimer.current = window.setTimeout(() => setLeaving(null), 160);
  }

  // Focus once the step has settled, and without scrolling: a field focused mid-animation drags the step to it.
  useEffect(() => {
    const timer = setTimeout(
      () => stepRef.current?.querySelector<HTMLElement>('input:not([disabled]):not([readonly]):not([type="file"])')?.focus({ preventScroll: true }),
      560,
    );
    return () => clearTimeout(timer);
  }, [step.n]);

  useEffect(() => {
    api.setupStatus().then(
      (s) => setDefaultName(s.serverName),
      () => undefined,
    );
    // The code from the address is checked quietly while the first step is already up; a wrong one asks for it.
    if (fromUrl) {
      api.setupCheck(fromUrl).catch((e) => {
        setAskCode(true);
        setCode('');
        go('code', false, e instanceof Error ? e.message : t('setup.code.invalid'));
      });
    }
  }, []);

  // The crop as it will look, in the picture on the right while it's being made.
  useEffect(() => {
    if (!draft) return;
    const frame = requestAnimationFrame(() => setDraftPreview(cropToUrl(draft.image, draft.crop)));
    return () => cancelAnimationFrame(frame);
  }, [draft]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('setup.error.failed'));
    } finally {
      setBusy(false);
    }
  }

  /* ---------- 1. code ---------- */

  function checkCode(value = code) {
    if (!value || busy) return;
    run(async () => {
      await api.setupCheck(value);
      go('server');
    });
  }

  /* ---------- 2. name and icon ---------- */

  async function pick(file: File | undefined) {
    if (fileInput.current) fileInput.current.value = '';
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) return setError(t('setup.server.tooBig'));
    try {
      const image = await loadImage(file);
      if (draft && draft.image !== icon?.image) URL.revokeObjectURL(draft.image.src);
      setDraft({ image, crop: centred(image), name: file.name });
      go('crop');
    } catch (e) {
      setError(e instanceof Error ? e.message : t('setup.server.openFailed'));
    }
  }

  function keepCrop() {
    if (!draft) return;
    if (icon && icon.image !== draft.image) URL.revokeObjectURL(icon.image.src);
    setIcon(draft);
    setPreview(cropToUrl(draft.image, draft.crop));
    setIconSent(false);
    go('server', true);
  }

  function dropIcon() {
    if (icon && icon.image !== draft?.image) URL.revokeObjectURL(icon.image.src);
    setIcon(null);
    setPreview(null);
    setIconSent(false);
  }

  function skipServer() {
    setServerName('');
    dropIcon();
    go('admin');
  }

  /* ---------- 3. admin ---------- */

  const mismatch = repeat !== '' && repeat.length >= password.length && repeat !== password;

  function submitAdmin(e: FormEvent) {
    e.preventDefault();
    if (password !== repeat) return setError(t('setup.admin.mismatch'));
    run(async () => {
      let made = account;
      if (!made) {
        const { token, user } = await api.setup(code, name, nick, password);
        setToken(token);
        // The code did its job; don't leave it in the address bar or the history.
        window.history.replaceState(null, '', window.location.pathname);
        made = { color: user.color, serverName: name };
        setAccount(made);
        api.myInvite().then(
          (i) => setLink(inviteLink(i.code)),
          () => undefined,
        );
      } else if (made.serverName !== name) {
        // Back to the name after the account was made: the name changes the admin's way.
        await api.renameServer(name);
        made = { ...made, serverName: name };
        setAccount(made);
      }
      if (icon && !iconSent) {
        await api.uploadServerIcon(await cropToBlob(icon.image, icon.crop));
        setIconSent(true);
      }
      if (!key) setKey((await api.makeRecoveryKey(password)).key);
      go('key');
    });
  }

  /* ---------- 4. recovery key ---------- */

  function downloadKey() {
    const text = [`Gomex · ${name}`, window.location.origin, t('setup.key.fileNick', { nick: nick.trim() }), t('setup.key.fileKey', { key }), ''].join('\n');
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: `gomex-${window.location.hostname}-key.txt` });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setKeyKept('downloaded');
  }

  /* ---------- 5. invite ---------- */

  useEffect(() => {
    if (step.id !== 'invite' || link) return;
    api.myInvite().then(
      (i) => setLink(inviteLink(i.code)),
      (e) => setError(e instanceof Error ? e.message : t('setup.invite.loadFailed')),
    );
  }, [step.id, link]);

  const canShare = typeof navigator.share === 'function';

  async function shareLink() {
    try {
      await navigator.share({ title: name, url: link });
      setLinkSent('shared');
    } catch {
      // The sheet was closed: nothing sent.
    }
  }

  /* ---------- the steps ---------- */

  function render(id: StepId) {
    switch (id) {
      case 'code':
        return (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              checkCode();
            }}
          >
            <h1>{t('setup.code.title')}</h1>
            <p className="sub">{t('setup.code.sub')}</p>
            <label className="field-label" htmlFor="setup-code">
              {t('setup.code.label')}
            </label>
            <InputOTP
              id="setup-code"
              maxLength={CODE_LENGTH}
              pattern={REGEXP_ONLY_DIGITS_AND_CHARS}
              value={code}
              onChange={(value) => {
                setCode(value);
                setError('');
              }}
              onComplete={(value: string) => checkCode(value)}
              pasteTransformer={codeFrom}
              isInvalid={!!error}
              spellCheck={false}
              autoComplete="off"
              className="otp"
            >
              <InputOTP.Group>
                {[0, 1, 2, 3, 4].map((i) => (
                  <InputOTP.Slot key={i} index={i} />
                ))}
              </InputOTP.Group>
              <InputOTP.Separator />
              <InputOTP.Group>
                {[5, 6, 7, 8, 9].map((i) => (
                  <InputOTP.Slot key={i} index={i} />
                ))}
              </InputOTP.Group>
            </InputOTP>
            <p className="error" role="alert">
              {error}
            </p>
            <div className="actions">
              <Primary type="submit" busy={busy} disabled={!code}>
                {t('setup.next')}
              </Primary>
            </div>
          </form>
        );

      case 'server':
        return (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (serverName.trim()) go('admin');
            }}
          >
            <h1>{t('setup.server.title')}</h1>
            <p className="sub">{t('setup.server.sub')}</p>
            <div className="rows">
              <div className="row">
                <button
                  type="button"
                  className="logo icon-button"
                  aria-label={t('setup.server.icon')}
                  onClick={() => (icon ? (setDraft(icon), go('crop')) : fileInput.current?.click())}
                >
                  {preview ? <img src={preview} alt="" /> : <GomexMark size={18} />}
                </button>
                <span className="grow">
                  <b>{t('setup.server.icon')}</b>
                  <small>{icon ? <FileName name={icon.name} /> : t('setup.server.defaultIcon')}</small>
                </span>
                {icon && (
                  <button type="button" className="quiet" onClick={dropIcon}>
                    {t('setup.server.remove')}
                  </button>
                )}
                <button type="button" className="secondary" onClick={() => fileInput.current?.click()}>
                  {icon ? t('setup.server.another') : t('setup.server.choose')}
                </button>
              </div>
            </div>
            <input ref={fileInput} type="file" accept="image/*" hidden onChange={(e) => pick(e.target.files?.[0])} />
            <label className="field-label gap" htmlFor="setup-name">
              {t('setup.server.nameLabel')}
            </label>
            <input
              id="setup-name"
              className="field"
              value={serverName}
              onChange={(e) => setServerName(e.target.value)}
              maxLength={40}
              placeholder={t('setup.server.namePlaceholder')}
              spellCheck={false}
              autoComplete="off"
            />
            <p className="error" role="alert">
              {error}
            </p>
            <div className="actions">
              {askCode && (
                <button type="button" className="quiet" onClick={() => go('code', true)}>
                  {t('setup.back')}
                </button>
              )}
              <span className="pair">
                <button type="button" className="quiet" onClick={skipServer}>
                  {t('setup.server.skip')}
                </button>
                <Primary type="submit" disabled={!serverName.trim()}>
                  {t('setup.next')}
                </Primary>
              </span>
            </div>
          </form>
        );

      case 'crop':
        if (!draft) return null;
        return (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              keepCrop();
            }}
          >
            <h1>{t('setup.server.icon')}</h1>
            <p className="sub">{draft.name}</p>
            <IconCropper image={draft.image} crop={draft.crop} onChange={(crop) => setDraft((d) => d && { ...d, crop })} className="crop" />
            <div className="actions">
              <button type="button" className="quiet" onClick={() => go('server', true)}>
                {t('setup.back')}
              </button>
              <Primary type="submit">{t('setup.server.cropDone')}</Primary>
            </div>
          </form>
        );

      case 'admin':
        return (
          <form onSubmit={submitAdmin}>
            <h1>{t('setup.admin.title')}</h1>
            <p className="sub">{t('setup.admin.sub')}</p>
            <label className="field-label" htmlFor="setup-nick">
              {t('setup.admin.nick')}
            </label>
            <input
              id="setup-nick"
              className="field"
              value={nick}
              onChange={(e) => {
                setNick(e.target.value);
                setError('');
              }}
              maxLength={32}
              placeholder={t('setup.admin.nickPlaceholder')}
              autoComplete="username"
              spellCheck={false}
              autoCapitalize="off"
              readOnly={!!account}
            />
            <label className="field-label" htmlFor="setup-password">
              {t('setup.admin.password')}
            </label>
            <span className="with-eye">
              <input
                id="setup-password"
                className="field"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t('setup.admin.passwordHint')}
                autoComplete="new-password"
                readOnly={!!account}
              />
              <button type="button" className="eye" aria-label={showPassword ? t('setup.admin.hide') : t('setup.admin.show')} onClick={() => setShowPassword((s) => !s)}>
                {EYE}
              </button>
            </span>
            <label className="field-label" htmlFor="setup-repeat">
              {t('setup.admin.repeat')}
            </label>
            <input
              id="setup-repeat"
              className={`field${mismatch ? ' bad' : ''}`}
              type={showPassword ? 'text' : 'password'}
              value={repeat}
              onChange={(e) => setRepeat(e.target.value)}
              autoComplete="new-password"
              readOnly={!!account}
            />
            <p className="error" role="alert">
              {error || (mismatch ? t('setup.admin.mismatch') : '')}
            </p>
            <div className="actions">
              <button type="button" className="quiet" onClick={() => go('server', true)}>
                {t('setup.back')}
              </button>
              <Primary type="submit" busy={busy} disabled={!nick.trim() || password.length < 8 || repeat !== password}>
                {t('setup.admin.create')}
              </Primary>
            </div>
          </form>
        );

      case 'key':
        return (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              go('invite');
            }}
          >
            <h1>{t('setup.key.title')}</h1>
            <p className="sub">{t('setup.key.sub')}</p>
            <div className="relative">
              <p className="key pr-12">
                {keyLines(key).map((line) => (
                  <span key={line} className="block">
                    {line}
                  </span>
                ))}
              </p>
              <CopyButton text={key} onCopied={() => setKeyKept((k) => k ?? 'copied')} className="absolute right-2 top-2" />
            </div>
            <div className="tools">
              <button type="button" className={`secondary${keyKept === 'downloaded' ? ' did' : ''}`} onClick={downloadKey}>
                {keyKept === 'downloaded' && DONE}
                {keyKept === 'downloaded' ? t('setup.key.downloaded') : t('setup.key.download')}
              </button>
            </div>
            <p className="error" role="alert" style={{ marginTop: 10 }}>
              {error}
            </p>
            {/* Ticked by itself once the key is copied or downloaded; "Next" waits for it. */}
            <label className="check">
              <input type="checkbox" checked={!!keyKept} onChange={(e) => setKeyKept(e.target.checked ? 'kept' : null)} />
              <span>{t('setup.key.kept')}</span>
            </label>
            <div className="actions">
              <span className="pair">
                <Primary type="submit" disabled={!keyKept}>
                  {t('setup.next')}
                </Primary>
              </span>
            </div>
          </form>
        );

      case 'invite':
        return (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              go('done');
            }}
          >
            <h1>{t('setup.invite.title')}</h1>
            <p className="sub">{t('setup.invite.sub')}</p>
            <label className="field-label" htmlFor="setup-link">
              {t('setup.invite.label')}
            </label>
            <div className="relative">
              <input
                id="setup-link"
                className="field pr-12"
                readOnly
                value={link.replace(/^https?:\/\//, '') || t('setup.invite.loading')}
                onFocus={(e) => e.currentTarget.select()}
              />
              <CopyButton text={link} onCopied={() => setLinkSent('copied')} className="absolute right-[5px] top-[5px]" />
            </div>
            <div className="tools">
              {canShare && (
                <button type="button" className={`secondary${linkSent === 'shared' ? ' did' : ''}`} disabled={!link} onClick={shareLink}>
                  {linkSent === 'shared' && DONE}
                  {t('setup.invite.share')}
                </button>
              )}
            </div>
            <p className="error" role="alert" style={{ marginTop: 10 }}>
              {error}
            </p>
            <div className="actions">
              <button type="button" className="quiet" onClick={() => go('key', true)}>
                {t('setup.back')}
              </button>
              <span className="pair">
                {!linkSent && (
                  <button type="button" className="quiet" onClick={() => go('done')}>
                    {t('setup.invite.later')}
                  </button>
                )}
                <Primary type="submit" disabled={!linkSent}>
                  {t('setup.next')}
                </Primary>
              </span>
            </div>
          </form>
        );

      case 'done':
        return (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              onDone();
            }}
          >
            <h1>{t('setup.done.title')}</h1>
            <p className="sub">{host}</p>
            <div className="rows">
              <div className="row">
                <span className="logo">{preview ? <img src={preview} alt="" /> : <GomexMark size={18} />}</span>
                <span className="grow">
                  <b>{name}</b>
                  <small>{t('setup.done.server')}</small>
                </span>
              </div>
              <div className="row">
                <span className="logo person" style={{ background: account?.color }}>
                  {letter(nick)}
                </span>
                <span className="grow">
                  <b>{nick.trim()}</b>
                  <small>{t('setup.done.admin')}</small>
                </span>
              </div>
              <div className="row">
                <span className="logo ok">{DONE}</span>
                <span className="grow">
                  <b>{t('setup.key.title')}</b>
                  <small>{keyKept === 'copied' ? t('setup.done.copied') : keyKept === 'downloaded' ? t('setup.key.downloaded') : t('setup.done.saved')}</small>
                </span>
              </div>
              <div className="row">
                <span className={`logo${linkSent ? ' ok' : ''}`}>{linkSent ? DONE : <UserPlusIcon size={18} />}</span>
                <span className="grow">
                  <b>{t('setup.done.invite')}</b>
                  <small>{linkSent === 'copied' ? t('setup.done.linkCopied') : linkSent === 'shared' ? t('setup.done.linkSent') : t('setup.invite.later')}</small>
                </span>
              </div>
            </div>
            <div className="actions">
              <button type="button" className="quiet" onClick={() => go('invite', true)}>
                {t('setup.back')}
              </button>
              <Primary type="submit">{t('setup.done.start')}</Primary>
            </div>
          </form>
        );
    }
  }

  // The three bars: the server was set up in the desktop app (or by the installer), so it's full; the account
  // fills over its steps, friends with the link and the end.
  const at = step.id === 'crop' ? 'server' : step.id;
  const accountSteps: StepId[] = askCode ? ['code', 'server', 'admin', 'key'] : ['server', 'admin', 'key'];
  const onAccount = accountSteps.includes(at);
  const fill = {
    server: 1,
    account: onAccount ? accountSteps.indexOf(at) / accountSteps.length : 1,
    friends: at === 'done' ? 1 : at === 'invite' && linkSent ? 0.5 : 0,
  };
  const now = onAccount ? 'account' : 'friends';

  const facts: Facts = {
    host,
    code,
    serverName: name,
    icon: step.id === 'crop' ? draftPreview : preview,
    nick: nick.trim(),
    color: account?.color ?? '#5865f2',
    passwordLength: password.length,
    key,
    link: link.replace(/^https?:\/\//, ''),
  };

  return (
    <div className="setup">
      <div className="left">
        <GomexMark size={26} className="mark" />
        <main className="steps">
          {leaving && (
            <section key={leaving.n} className="step leaving" aria-hidden="true">
              {render(leaving.id)}
            </section>
          )}
          <section key={step.n} ref={stepRef} className={`step${step.back ? ' back-in' : ''}`}>
            {render(step.id)}
          </section>
        </main>
        <nav className="progress" aria-label={t('setup.steps')}>
          {(
            [
              ['server', t('setup.done.server')],
              ['account', t('setup.progress.account')],
              ['friends', t('setup.progress.friends')],
            ] as const
          ).map(([part, label]) => (
            <span key={part} className={`part${now === part ? ' now' : ''}`}>
              <span className="track">
                <i style={{ '--fill': fill[part] } as CSSProperties} />
              </span>
              <span className="name">{label}</span>
            </span>
          ))}
        </nav>
      </div>
      {wide && <SetupScenes scene={SCENE[step.id]} facts={facts} />}
    </div>
  );
}
