import { useEffect, useState, type FormEvent } from 'react';
import { Button, Input, Label, TextField } from '@heroui/react';
import { api, setToken } from '../api';
import { clearInviteFromUrl, inviteFromUrl, parseInvite } from '../people/invite';
import type { Session } from '../types';
import { SignInArt } from '../ui/Illustrations';
import { GomexMark } from '../ui/Logo';
import { RecoveryKeyInput } from './RecoveryKeyInput';
import { useT } from '../i18n';

type Mode = 'login' | 'register' | 'recover';

export function Login({ onLoggedIn }: { onLoggedIn: (session: Session, signedUp: boolean) => void }) {
  const { t } = useT();
  // Opened from an invite link: straight to sign-up with the code filled in.
  const [linkCode] = useState(inviteFromUrl);
  const [mode, setMode] = useState<Mode>(linkCode ? 'register' : 'login');
  const [invite, setInvite] = useState(linkCode ?? '');
  const [inviter, setInviter] = useState<string | null>(null);
  const [linkProblem, setLinkProblem] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [recoveryKey, setRecoveryKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!linkCode) return;
    api.checkInvite(linkCode).then(
      (r) => setInviter(r.inviter),
      (e) => setLinkProblem(e instanceof Error ? e.message : t('account.login.inviteFailed')),
    );
  }, [linkCode, t]);

  // A valid link means the code field isn't needed at all.
  const showInviteField = mode === 'register' && !(linkCode && inviter);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const session =
        mode === 'login'
          ? await api.login(name, password)
          : mode === 'recover'
            ? await api.recover(name, recoveryKey, password)
            : await api.register(parseInvite(invite), name, password);
      setToken(session.token);
      clearInviteFromUrl();
      onLoggedIn(session, mode === 'register');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('account.login.failed'));
    } finally {
      setBusy(false);
    }
  }

  // The bold nick sits inside the sentence: split around a marker so word order stays the dictionary's.
  const invitedBy = t('account.login.invitedBy', { name: '\u0000' }).split('\u0000');

  const tab = (id: Mode, label: string) => (
    <button
      type="button"
      onClick={() => {
        setMode(id);
        setError(null);
      }}
      aria-pressed={mode === id}
      className={`h-9 flex-1 rounded-full text-[14px] font-medium transition-colors ${
        mode === id ? 'bg-white text-black' : 'text-muted hover:text-foreground'
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="flex h-full overflow-y-auto bg-background">
      <div className="m-auto flex w-full flex-col items-center pb-8">
        {/* The drawing is a phone thing; on a computer, the mark alone. */}
        <SignInArt className="md:hidden" />
        <div className="mb-5 max-md:hidden">
          <GomexMark size={72} />
        </div>
        <h1 className="mt-1 px-4 text-center text-[34px] font-medium leading-[1.12] tracking-[-0.02em] max-md:text-[28px]">
          Gomex.
          <br />
          {t('account.login.tagline')}
        </h1>
      <form onSubmit={submit} className="mt-8 flex w-full max-w-[380px] flex-col gap-4 px-4">

        {mode === 'recover' ? (
          <div>
            <h2 className="text-[18px] font-medium">{t('account.login.recoverTitle')}</h2>
            <p className="mt-1 text-[14px] leading-snug text-muted">{t('account.login.recoverHint')}</p>
          </div>
        ) : (
          <div className="flex gap-1 rounded-full bg-default p-1">
            {tab('login', t('account.login.tabLogin'))}
            {tab('register', t('account.login.tabRegister'))}
          </div>
        )}

        {mode === 'register' && linkCode && inviter && (
          <p className="rounded-[12px] bg-accent/15 px-4 py-3 text-[15px]">
            {invitedBy[0]}
            <b>{inviter}</b>
            {invitedBy[1]}
          </p>
        )}
        {mode === 'register' && linkCode && linkProblem && (
          <p className="rounded-[12px] bg-danger/15 px-4 py-3 text-[14px] text-danger">{t('account.login.askNewLink', { problem: linkProblem })}</p>
        )}
        {showInviteField && (
          <TextField isRequired fullWidth value={invite} onChange={setInvite}>
            <Label>{t('account.login.inviteLabel')}</Label>
            <Input className="h-11 bg-default text-[16px]" placeholder={t('account.login.invitePlaceholder')} />
          </TextField>
        )}
        <TextField isRequired fullWidth value={name} onChange={setName} maxLength={32} autoComplete="username" autoFocus>
          <Label>{t('account.login.name')}</Label>
          <Input className="h-11 bg-default text-[16px]" />
        </TextField>
        {mode === 'recover' && (
          <RecoveryKeyInput value={recoveryKey} onChange={setRecoveryKey} />
        )}
        <TextField
          isRequired
          fullWidth
          type="password"
          value={password}
          onChange={setPassword}
          minLength={mode === 'login' ? undefined : 8}
          autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
        >
          <Label>{mode === 'recover' ? t('account.login.newPassword') : t('account.login.password')}</Label>
          <Input className="h-11 bg-default text-[16px]" />
        </TextField>

        {error ? (
          <p className="text-[14px] text-danger">{error}</p>
        ) : (
          mode === 'register' && (
            <p className="text-[13px] text-muted">{t('account.login.registerHint')}</p>
          )
        )}

        <Button type="submit" fullWidth isPending={busy} className="mt-1 h-12 rounded-full text-[16px]">
          {mode === 'login' ? t('account.login.submitLogin') : mode === 'recover' ? t('account.login.submitRecover') : t('account.login.submitRegister')}
        </Button>
        {mode !== 'register' && (
          <button
            type="button"
            onClick={() => {
              setMode(mode === 'recover' ? 'login' : 'recover');
              setError(null);
            }}
            className="self-center text-[14px] text-muted hover:text-foreground hover:underline"
          >
            {mode === 'recover' ? t('account.login.rememberedPassword') : t('account.login.forgotPassword')}
          </button>
        )}
      </form>
      </div>
    </div>
  );
}
