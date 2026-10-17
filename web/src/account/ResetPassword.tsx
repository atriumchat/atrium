import { useEffect, useState, type FormEvent } from 'react';
import { Button, Input, Label, TextField } from '@heroui/react';
import { api, setToken } from '../api';
import type { Session } from '../types';
import { GomexMark } from '../ui/Logo';
import { clearResetFromUrl } from './resetLink';

/**
 * The page a reset link opens: a new password, twice. The link belongs to one person (the admin made it for them);
 * it works once, ends their other sessions and signs this one in.
 */
export function ResetPassword({ token, onDone, onCancel }: { token: string; onDone: (session: Session) => void; onCancel: () => void }) {
  const [name, setName] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const mismatch = repeat !== '' && repeat !== password;

  useEffect(() => {
    api.checkReset(token).then(
      (r) => setName(r.name),
      (e) => setProblem(e instanceof Error ? e.message : 'Ссылка не подошла'),
    );
  }, [token]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (password !== repeat) return setError('Пароли не совпадают');
    setBusy(true);
    setError(null);
    try {
      const session = await api.reset(token, password);
      setToken(session.token);
      clearResetFromUrl();
      onDone(session);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не получилось');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full overflow-y-auto bg-background">
      <div className="m-auto flex w-full max-w-[380px] flex-col items-center gap-5 px-4 py-8">
        <GomexMark size={56} />
        <h1 className="text-[24px] font-medium leading-tight">Новый пароль</h1>
        {problem ? (
          <>
            <p className="w-full rounded-[12px] bg-danger/15 px-4 py-3 text-[14px] text-danger">{problem}. Попроси новую ссылку.</p>
            <Button fullWidth onPress={onCancel} className="h-12 rounded-full text-[16px]">
              На страницу входа
            </Button>
          </>
        ) : (
          <form onSubmit={submit} className="flex w-full flex-col gap-4">
            {name && (
              <p className="text-center text-[15px] text-muted">
                Для <b className="text-foreground">{name}</b>
              </p>
            )}
            {/* So a password manager saves the new password under the right nick. */}
            <input type="text" value={name ?? ''} readOnly autoComplete="username" tabIndex={-1} aria-hidden className="sr-only" />
            <TextField isRequired fullWidth type="password" value={password} onChange={setPassword} minLength={8} autoComplete="new-password" autoFocus>
              <Label>Новый пароль</Label>
              <Input className="h-11 bg-default text-[16px]" />
            </TextField>
            <TextField isRequired fullWidth type="password" value={repeat} onChange={setRepeat} minLength={8} autoComplete="new-password">
              <Label>Ещё раз</Label>
              <Input className="h-11 bg-default text-[16px]" />
            </TextField>
            {error || mismatch ? (
              <p className="text-[14px] text-danger">{error ?? 'Пароли не совпадают'}</p>
            ) : (
              <p className="text-[13px] text-muted">Пароль — от 8 символов.</p>
            )}
            <Button type="submit" fullWidth isPending={busy} isDisabled={!name} className="h-12 rounded-full text-[16px]">
              Сохранить и войти
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
