import { useEffect, useRef, useState } from 'react';
import { api, setToken } from '../api';
import { useT } from '../i18n';
import { inviteLink } from '../people/invite';
import { GomexMark } from '../ui/Logo';
import { IconCropper, centred, cropToBlob, cropToUrl, loadImage, type Crop } from '../ui/IconCropper';
import { FlowPrimary, FlowSecondary, FlowShell, FlowStep, LineField, TextAction } from '../ui/flow/Flow';

/**
 * First run on a fresh server, shown while it has no accounts, in the flow look (DESIGN.md) as the phone app does it
 * in "Your own server" (mobile/app/own.tsx). The desktop app's "Your own server" and the installer open it with the
 * setup code in the address (?setup=CODE). The server's name and icon, the admin, their recovery key, the first
 * invite link; then the app.
 */

type StepId = 'code' | 'server' | 'crop' | 'admin' | 'key' | 'invite';

// install.sh makes the code 10 letters and digits (INVITE_CODE in .env).
const CODE_LENGTH = 10;
// The edge (EdgeTicks) at each step, and the part of the way it belongs to.
const FILL: Record<StepId, number> = { code: 0.1, server: 0.25, crop: 0.3, admin: 0.5, key: 0.72, invite: 0.9 };
const PART: Record<StepId, 0 | 1 | 2> = { code: 0, server: 0, crop: 0, admin: 1, key: 1, invite: 2 };

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

// Design work, development only: #step=server (or code, admin, key, invite) opens that step with made-up answers and
// nothing sent to the server.
const DEMO_HASH = import.meta.env.DEV ? window.location.hash.match(/step=(intro|code|server|admin|key|invite|done)\b/)?.[1] : undefined;
export const DEMO = (DEMO_HASH === 'intro' ? 'server' : DEMO_HASH === 'done' ? 'invite' : DEMO_HASH) as StepId | undefined;
const ORDER: StepId[] = ['code', 'server', 'crop', 'admin', 'key', 'invite'];
const past = (id: StepId) => !!DEMO && ORDER.indexOf(DEMO) > ORDER.indexOf(id);

export function SetupWizard({ onDone }: { onDone: () => void }) {
  const { t } = useT();
  const [fromUrl] = useState(() => codeFrom(new URLSearchParams(window.location.search).get('setup') ?? ''));
  // The code step is only on the way when the address didn't bring the code (or brought a wrong one).
  const [askCode, setAskCode] = useState(DEMO ? DEMO === 'code' : !fromUrl);
  const [code, setCode] = useState(fromUrl);

  const [step, setStep] = useState<{ id: StepId; back: boolean; n: number }>({ id: DEMO ?? (fromUrl ? 'server' : 'code'), back: false, n: 0 });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const [defaultName, setDefaultName] = useState('Gomex');
  const [serverName, setServerName] = useState(past('code') ? t('setup.server.namePlaceholder') : '');
  const fileInput = useRef<HTMLInputElement>(null);
  // The icon as chosen, and the picture being cropped right now (a new one, or the chosen one again).
  const [icon, setIcon] = useState<{ image: HTMLImageElement; crop: Crop; name: string } | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ image: HTMLImageElement; crop: Crop; name: string } | null>(null);

  const [nick, setNick] = useState(past('crop') ? t('setup.admin.nickPlaceholder') : '');
  const [password, setPassword] = useState(nick && 'password');
  const [repeat, setRepeat] = useState(password);
  // What's already done on the server, so a retry after an error doesn't do it twice.
  const [account, setAccount] = useState<{ serverName: string } | null>(past('admin') ? { serverName: t('setup.server.namePlaceholder') } : null);
  const [iconSent, setIconSent] = useState(false);

  const [key, setKey] = useState(account ? 'K7QM-2XPA-9DHR-T4WC-8NBE-3VLY' : '');
  const [keyKept, setKeyKept] = useState<'copied' | 'downloaded' | null>(null);
  const [link, setLink] = useState(account ? `${window.location.origin}/?invite=7F3K9QAB` : '');
  const [linkSent, setLinkSent] = useState<'copied' | 'shared' | null>(null);

  const name = serverName.trim() || defaultName;

  function go(id: StepId, back = false, problem = '') {
    setError(problem);
    setStep((s) => ({ id, back, n: s.n + 1 }));
  }

  useEffect(() => {
    if (DEMO) return;
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

  /* ---------- the code ---------- */

  function checkCode() {
    if (!code || busy) return;
    if (DEMO) return go('server');
    void run(async () => {
      await api.setupCheck(code);
      go('server');
    });
  }

  /* ---------- name and icon ---------- */

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

  /* ---------- the admin ---------- */

  const mismatch = repeat !== '' && repeat.length >= password.length && repeat !== password;
  const adminReady = !!nick.trim() && password.length >= 8 && repeat === password;

  function submitAdmin() {
    if (!adminReady || busy) return;
    if (DEMO) {
      // Walked through on made-up answers: made-up results too.
      setKey((k) => k || 'K7QM-2XPA-9DHR-T4WC-8NBE-3VLY');
      setLink((l) => l || `${window.location.origin}/?invite=7F3K9QAB`);
      return go('key');
    }
    void run(async () => {
      let made = account;
      if (!made) {
        const { token } = await api.setup(code, name, nick, password);
        setToken(token);
        // The code did its job; don't leave it in the address bar or the history.
        window.history.replaceState(null, '', window.location.pathname);
        made = { serverName: name };
        setAccount(made);
        api.myInvite().then(
          (i) => setLink(inviteLink(i.code)),
          () => undefined,
        );
      } else if (made.serverName !== name) {
        // Back to the name after the account was made: the name changes the admin's way.
        await api.renameServer(name);
        made = { serverName: name };
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

  /* ---------- the recovery key ---------- */

  async function copyKey() {
    await navigator.clipboard.writeText(key).catch(() => undefined);
    setKeyKept('copied');
  }

  function downloadKey() {
    const text = [`Gomex · ${name}`, window.location.origin, t('setup.key.fileNick', { nick: nick.trim() }), t('setup.key.fileKey', { key }), ''].join('\n');
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: `gomex-${window.location.hostname}-key.txt` });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setKeyKept('downloaded');
  }

  /* ---------- the invite ---------- */

  useEffect(() => {
    if (step.id !== 'invite' || link || DEMO) return;
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

  async function copyLink() {
    await navigator.clipboard.writeText(link).catch(() => undefined);
    setLinkSent((sent) => sent ?? 'copied');
  }

  /* ---------- the steps ---------- */

  function render(id: StepId) {
    switch (id) {
      case 'code':
        return (
          <FlowStep
            title={t('setup.code.title')}
            sub={t('setup.code.sub')}
            error={error}
            onSubmit={checkCode}
            actions={<FlowPrimary type="submit" busy={busy} disabled={code.length < CODE_LENGTH}>{t('setup.next')}</FlowPrimary>}
          >
            <LineField
              label={t('setup.code.label')}
              value={code}
              onChange={(e) => (setCode(codeFrom(e.target.value)), setError(''))}
              placeholder="A1B2C3D4E5"
              autoFocus
              style={{ letterSpacing: '2px', textTransform: 'uppercase' }}
            />
          </FlowStep>
        );

      case 'server':
        return (
          <FlowStep
            title={t('setup.server.title')}
            sub={t('setup.server.sub')}
            error={error}
            onBack={askCode ? () => go('code', true) : undefined}
            onSubmit={() => serverName.trim() && go('admin')}
            actions={
              <>
                <FlowPrimary type="submit" disabled={!serverName.trim()}>{t('setup.next')}</FlowPrimary>
                <FlowSecondary onClick={skipServer}>{t('setup.server.skip')}</FlowSecondary>
              </>
            }
          >
            <LineField label={t('setup.server.nameLabel')} value={serverName} onChange={(e) => setServerName(e.target.value)} maxLength={40} placeholder={t('setup.server.namePlaceholder')} />
            <div className="flow-actions" style={{ alignItems: 'center' }}>
              <button type="button" className="flow-icon-row" onClick={() => (icon ? (setDraft(icon), go('crop')) : fileInput.current?.click())}>
                {preview ? <img src={preview} alt="" /> : <span className="mark"><GomexMark size={56} /></span>}
                <span>
                  <b>{t('setup.server.icon')}</b>
                  <u>{icon ? t('setup.server.another') : t('setup.server.choose')}</u>
                </span>
              </button>
              {icon ? <TextAction onClick={dropIcon}>{t('setup.server.remove')}</TextAction> : null}
            </div>
            <input ref={fileInput} type="file" accept="image/*" hidden onChange={(e) => void pick(e.target.files?.[0])} />
          </FlowStep>
        );

      case 'crop':
        if (!draft) return null;
        return (
          <FlowStep
            title={t('setup.server.icon')}
            sub={draft.name}
            onBack={() => go('server', true)}
            onSubmit={keepCrop}
            actions={
              <>
                <FlowPrimary type="submit">{t('setup.server.cropDone')}</FlowPrimary>
                <FlowSecondary onClick={() => fileInput.current?.click()}>{t('setup.server.another')}</FlowSecondary>
              </>
            }
          >
            <IconCropper image={draft.image} crop={draft.crop} onChange={(crop) => setDraft((d) => d && { ...d, crop })} className="flow-crop" />
            <input ref={fileInput} type="file" accept="image/*" hidden onChange={(e) => void pick(e.target.files?.[0])} />
          </FlowStep>
        );

      case 'admin':
        return (
          <FlowStep
            title={t('setup.admin.title')}
            sub={t('setup.admin.sub')}
            error={error}
            onBack={() => go('server', true)}
            onSubmit={submitAdmin}
            actions={<FlowPrimary type="submit" busy={busy} disabled={!adminReady}>{t('setup.admin.create')}</FlowPrimary>}
          >
            <LineField label={t('setup.admin.nick')} value={nick} onChange={(e) => (setNick(e.target.value), setError(''))} maxLength={32} placeholder={t('setup.admin.nickPlaceholder')} autoComplete="username" autoCapitalize="off" readOnly={!!account} />
            <div className="flow-pair">
              <LineField label={t('setup.admin.password')} type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={t('setup.admin.passwordHint')} autoComplete="new-password" readOnly={!!account} />
              <LineField label={t('setup.admin.repeat')} type="password" value={repeat} onChange={(e) => setRepeat(e.target.value)} placeholder={t('setup.admin.repeatHint')} autoComplete="new-password" readOnly={!!account} error={mismatch && t('setup.admin.mismatch')} />
            </div>
          </FlowStep>
        );

      case 'key':
        return (
          <FlowStep
            title={t('setup.key.title')}
            sub={t('setup.key.sub')}
            error={error}
            onSubmit={() => keyKept && go('invite')}
            actions={<FlowPrimary type="submit" disabled={!keyKept}>{t('setup.next')}</FlowPrimary>}
          >
            <p className="flow-big">{key}</p>
            {/* "Next" opens once the key has been copied or downloaded; the action used says so. */}
            <div className="flow-actions">
              <TextAction left onClick={() => void copyKey()}>{keyKept === 'copied' ? t('common.copy.done') : t('common.copy.label')}</TextAction>
              <TextAction left onClick={downloadKey}>{keyKept === 'downloaded' ? t('setup.key.downloaded') : t('setup.key.download')}</TextAction>
            </div>
          </FlowStep>
        );

      case 'invite':
        return (
          <FlowStep
            title={t('setup.invite.title')}
            sub={t('setup.invite.sub')}
            error={error}
            actions={
              linkSent ? (
                <FlowPrimary onClick={onDone}>{t('setup.done.start')}</FlowPrimary>
              ) : (
                <>
                  {canShare ? (
                    <FlowPrimary disabled={!link} onClick={() => void shareLink()}>{t('setup.invite.share')}</FlowPrimary>
                  ) : (
                    <FlowPrimary disabled={!link} onClick={() => void copyLink()}>{t('setup.invite.copy')}</FlowPrimary>
                  )}
                  <FlowSecondary onClick={onDone}>{t('setup.invite.later')}</FlowSecondary>
                </>
              )
            }
          >
            <p className="flow-big" style={{ fontSize: 22, lineHeight: '28px', letterSpacing: 0 }}>{link.replace(/^https?:\/\//, '') || t('setup.invite.loading')}</p>
            {canShare ? <TextAction left onClick={() => void copyLink()}>{linkSent === 'copied' ? t('common.copy.done') : t('common.copy.label')}</TextAction> : null}
          </FlowStep>
        );
    }
  }

  const parts = [t('setup.done.server'), t('setup.progress.account'), t('setup.progress.friends')];
  const part = PART[step.id];
  return (
    <FlowShell fill={FILL[step.id]} label={t('setup.stageOf', { stage: parts[part]!, n: part + 1, total: parts.length })}>
      <div key={step.n} className={step.back ? 'flow-swap back-in' : 'flow-swap'}>
        {render(step.id)}
      </div>
    </FlowShell>
  );
}
