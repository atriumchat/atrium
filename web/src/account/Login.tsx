import { useEffect, useState } from 'react';
import { MIN_PASSWORD, signInFlow, type SignInStep as Step } from '@gomex/setup';
import { FlowPrimary, FlowShell, FlowStep, LineField, RadioRow, TextAction } from '@gomex/ui-web';
import { api, setToken } from '../api';
import { clearInviteFromUrl, inviteFromUrl, parseInvite } from '../people/invite';
import type { Session } from '../types';
import { useT } from '../i18n';
import { demo } from './demo';

/**
 * Getting in, in the flow look (DESIGN.md), as the phone app does it (mobile/app/login.tsx): what you're here for,
 * then the nickname and password; by invite, the link first (whose it is shows as soon as it's typed), then the
 * account; or the recovery key. The steps, their scale and the way back are @gomex/setup's signInFlow. The server is
 * the page's own, so there's nothing to choose.
 */

// Design work, development only (demo.ts): #signin opens this screen with no server behind it, whose invite made up.
const SIGN_IN_DEMO = demo === 'signin';

type Way = 'login' | 'invite';

export function Login({ onLoggedIn }: { onLoggedIn: (session: Session, signedUp: boolean) => void }) {
  const { t } = useT();
  // Opened from an invite link: the link is in, whose it is shows, Next goes on to the account.
  const [linkCode] = useState(inviteFromUrl);
  const [step, setStep] = useState<{ id: Step; back: boolean; n: number }>({ id: linkCode ? 'invite' : 'start', back: false, n: 0 });
  const [way, setWay] = useState<Way>('login');
  const [invite, setInvite] = useState(linkCode ?? '');
  const [inviter, setInviter] = useState<string | null>(null);
  const [inviteBad, setInviteBad] = useState(false);
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [key, setKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function go(id: Step, back = false) {
    setError(null);
    setStep((s) => ({ id, back, n: s.n + 1 }));
  }
  const back = (from: Step) => {
    const to = signInFlow.back(from, undefined);
    return to ? () => go(to, true) : undefined;
  };

  // Whose invite it is, as soon as the code is there.
  const code = parseInvite(invite);
  useEffect(() => {
    if (step.id !== 'invite') return;
    setInviter(null);
    setInviteBad(false);
    if (code.length < 6) return;
    let live = true;
    const check = SIGN_IN_DEMO ? Promise.resolve({ inviter: 'Тимур' }) : api.checkInvite(code);
    check.then(
      (r) => live && setInviter(r.inviter),
      () => live && setInviteBad(true),
    );
    return () => {
      live = false;
    };
  }, [step.id, code]);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      if (SIGN_IN_DEMO) throw new Error(t('account.login.failed'));
      const session =
        step.id === 'recover'
          ? await api.recover(name, key.replace(/[^a-zA-Z0-9]/g, '').toUpperCase(), password)
          : step.id === 'account'
            ? await api.register(code, name, password)
            : await api.login(name, password);
      setToken(session.token);
      clearInviteFromUrl();
      onLoggedIn(session, step.id === 'account');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('account.login.failed'));
    } finally {
      setBusy(false);
    }
  }

  const nickField = (
    <LineField
      label={t('account.login.name')}
      value={name}
      onChange={(e) => setName(e.target.value)}
      placeholder={t('setup.admin.nickPlaceholder')}
      maxLength={32}
      autoComplete="username"
      autoCapitalize="off"
    />
  );

  function screen() {
    switch (step.id) {
      case 'start':
        return (
          <FlowStep title="Gomex" sub={t('account.login.tagline')} onSubmit={() => go(way)} actions={<FlowPrimary type="submit">{t('setup.next')}</FlowPrimary>}>
            <div role="radiogroup">
              <RadioRow title={t('account.start.have')} sub={t('account.start.haveSub')} on={way === 'login'} onPress={() => setWay('login')} />
              <RadioRow title={t('account.start.invited')} sub={t('account.login.invitePlaceholder')} on={way === 'invite'} onPress={() => setWay('invite')} last />
            </div>
          </FlowStep>
        );

      case 'login': {
        const ready = !!name.trim() && !!password;
        return (
          <FlowStep
            title={t('account.login.tabLogin')}
            sub={t('account.start.haveSub')}
            error={error}
            onBack={back('login')}
            onSubmit={() => ready && void submit()}
            actions={<FlowPrimary type="submit" busy={busy} disabled={!ready}>{t('account.login.submitLogin')}</FlowPrimary>}
            below={<TextAction onPress={() => go('recover')}>{t('account.login.forgotPassword')}</TextAction>}
          >
            {nickField}
            <LineField label={t('account.login.password')} type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" autoComplete="current-password" />
          </FlowStep>
        );
      }

      case 'invite':
        return (
          <FlowStep
            title={t('account.login.inviteLabel')}
            sub={t('account.invite.sub')}
            note={inviter ? t('account.login.invitedBy', { name: inviter }) : undefined}
            onBack={back('invite')}
            onSubmit={() => inviter && go('account')}
            actions={<FlowPrimary type="submit" disabled={!inviter}>{t('setup.next')}</FlowPrimary>}
          >
            <LineField
              label={t('account.invite.field')}
              value={invite}
              onChange={(e) => setInvite(e.target.value)}
              placeholder={t('account.login.invitePlaceholder')}
              error={inviteBad && t('account.login.inviteFailed')}
            />
          </FlowStep>
        );

      case 'account': {
        const ready = !!name.trim() && password.length >= MIN_PASSWORD;
        return (
          <FlowStep
            title={t('account.account')}
            sub={inviter ? t('account.login.invitedBy', { name: inviter }) : undefined}
            error={error}
            onBack={back('account')}
            onSubmit={() => ready && void submit()}
            actions={<FlowPrimary type="submit" busy={busy} disabled={!ready}>{t('account.login.submitRegister')}</FlowPrimary>}
          >
            {nickField}
            <LineField label={t('account.login.password')} type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={t('setup.admin.passwordHint')} autoComplete="new-password" />
          </FlowStep>
        );
      }

      case 'recover': {
        const ready = !!name.trim() && !!key.trim() && password.length >= MIN_PASSWORD;
        return (
          <FlowStep
            title={t('account.login.recoverTitle')}
            sub={t('account.login.recoverHint')}
            error={error}
            onBack={back('recover')}
            onSubmit={() => ready && void submit()}
            actions={<FlowPrimary type="submit" busy={busy} disabled={!ready}>{t('account.recoverGo')}</FlowPrimary>}
          >
            {nickField}
            <LineField label={t('account.keyInput.label')} value={key} onChange={(e) => setKey(e.target.value.toUpperCase())} placeholder="XXXX-XXXX-…" maxLength={64} autoComplete="off" />
            <LineField label={t('account.login.newPassword')} type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={t('setup.admin.passwordHint')} autoComplete="new-password" />
          </FlowStep>
        );
      }
    }
  }

  const stage = signInFlow.stage(step.id);
  const parts = { invite: t('account.login.inviteLabel'), account: t('account.account') };
  return (
    <FlowShell fill={signInFlow.fill(step.id)} label={stage ? t('setup.stageOf', { stage: parts[stage.part], n: stage.n, total: stage.total }) : undefined}>
      <div key={step.n} className={step.back ? 'flow-swap back-in' : 'flow-swap'}>
        {screen()}
      </div>
    </FlowShell>
  );
}
