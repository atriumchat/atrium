import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Button } from '@heroui/react';
import { api, setToken } from '../api';
import { inviteLink } from '../people/invite';
import { ConnectionCheck } from '../voice/ConnectionCheck';
import { GomexMark } from '../ui/Logo';
import { CheckIcon } from '../ui/icons';

/**
 * First run on a fresh server, after Fluxer's setup: the code from .env, the server's name, the admin
 * account, a check that calls get through, and the first invite link. Shown while the server has no accounts.
 */

const STEPS = ['Код', 'Сервер', 'Админ', 'Связь', 'Приглашение'] as const;

const field = 'h-12 w-full rounded-full bg-default px-5 text-[16px] outline-none placeholder:text-faint focus:ring-2 focus:ring-focus';
const primary = 'h-12 w-full rounded-full text-[16px] [--button-bg:white] [--button-bg-hover:#e7e7ea] [--button-fg:#0b0b0c]';

function codeFromUrl() {
  return new URLSearchParams(window.location.search).get('setup') ?? '';
}

export function SetupWizard({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(0);
  const [code, setCode] = useState(codeFromUrl);
  const [serverName, setServerName] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [checked, setChecked] = useState(false);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не получилось');
    } finally {
      setBusy(false);
    }
  }

  const next = () => setStep((s) => s + 1);

  function submitCode(e: FormEvent) {
    e.preventDefault();
    run(async () => {
      await api.setupCheck(code);
      next();
    });
  }

  function submitServer(e: FormEvent) {
    e.preventDefault();
    if (serverName.trim()) next();
  }

  function submitAdmin(e: FormEvent) {
    e.preventDefault();
    if (password !== repeat) return setError('Пароли не совпадают');
    run(async () => {
      const { token } = await api.setup(code, serverName, name, password);
      setToken(token);
      // The code did its job; don't leave it in the address bar or the history.
      window.history.replaceState(null, '', window.location.pathname);
      next();
    });
  }

  return (
    <div className="flex h-full overflow-y-auto bg-background">
      <div className="m-auto w-full max-w-[440px] px-4 py-10">
        <div className="mb-8 flex items-center gap-3">
          <GomexMark size={40} />
          <span className="text-[15px] text-muted">Настройка сервера</span>
        </div>
        <ol className="mb-8 flex gap-1.5" aria-label="Шаги">
          {STEPS.map((label, i) => (
            <li key={label} className="flex-1" aria-current={i === step ? 'step' : undefined}>
              <span className={`block h-1 rounded-full transition-colors ${i <= step ? 'bg-white' : 'bg-white/15'}`} />
              <span className={`mt-1.5 block text-[11px] ${i === step ? 'text-foreground' : 'text-faint'}`}>{label}</span>
            </li>
          ))}
        </ol>

        {step === 0 && (
          <Step title="Привет! Это новый сервер" text="Чтобы настроить его, нужен код установки. Скрипт установки показал ссылку с ним; ещё он лежит в файле .env на сервере, строка INVITE_CODE.">
            <form onSubmit={submitCode} className="flex flex-col gap-3">
              <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Код установки" aria-label="Код установки" autoFocus className={`${field} font-mono`} />
              <Button type="submit" isPending={busy} isDisabled={!code.trim()} className={primary}>
                Дальше
              </Button>
            </form>
          </Step>
        )}

        {step === 1 && (
          <Step title="Как назовём сервер?" text="Это имя увидят все в шапке и в приглашениях. Поменять можно и потом.">
            <form onSubmit={submitServer} className="flex flex-col gap-3">
              <input value={serverName} onChange={(e) => setServerName(e.target.value)} maxLength={40} placeholder="Например, Подвал" aria-label="Имя сервера" autoFocus className={field} />
              <Button type="submit" isDisabled={!serverName.trim()} className={primary}>
                Дальше
              </Button>
            </form>
          </Step>
        )}

        {step === 2 && (
          <Step title="Аккаунт админа" text="Админ создаёт каналы, управляет сервером и приглашает людей без лимита.">
            <form onSubmit={submitAdmin} className="flex flex-col gap-3">
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={32} placeholder="Ник" aria-label="Ник" autoComplete="username" autoFocus className={field} />
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Пароль, от 8 символов" aria-label="Пароль" autoComplete="new-password" className={field} />
              <input type="password" value={repeat} onChange={(e) => setRepeat(e.target.value)} placeholder="Ещё раз" aria-label="Пароль ещё раз" autoComplete="new-password" className={field} />
              <Button type="submit" isPending={busy} isDisabled={!name.trim() || password.length < 8 || !repeat} className={primary}>
                Создать сервер
              </Button>
            </form>
          </Step>
        )}

        {step === 3 && (
          <Step title="Проверим связь" text="Пробуем позвонить на свой же сервер: как получится сам и через запасной путь на 443.">
            <ConnectionCheck onDone={() => setChecked(true)} />
            <Button onPress={next} className={`${primary} mt-3`}>
              {checked ? 'Дальше' : 'Пропустить'}
            </Button>
          </Step>
        )}

        {step === 4 && (
          <Step title="Готово" text="Ссылка-приглашение: по ней люди регистрируются и сразу попадают в друзья. Она всегда внизу слева, в «Пригласить друзей».">
            <InviteLink />
            <Button onPress={onDone} className={`${primary} mt-3`}>
              Войти в Gomex
            </Button>
          </Step>
        )}

        {error && <p className="mt-3 px-1 text-[14px] text-danger">{error}</p>}
        {step > 0 && step < 3 && (
          <button onClick={() => setStep((s) => s - 1)} className="mx-auto mt-4 block text-[14px] text-muted hover:text-foreground">
            Назад
          </button>
        )}
      </div>
    </div>
  );
}

function Step({ title, text, children }: { title: string; text: string; children: ReactNode }) {
  return (
    <section>
      <h1 className="text-[28px] font-medium leading-9 tracking-[-0.01em]">{title}</h1>
      <p className="mb-6 mt-2 text-[15px] leading-snug text-muted">{text}</p>
      {children}
    </section>
  );
}

function InviteLink() {
  const [link, setLink] = useState('');
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    api.myInvite().then((i) => setLink(inviteLink(i.code)), () => setLink(''));
  }, []);
  return (
    <div className="flex h-12 items-center gap-2 rounded-full bg-default pl-5 pr-1.5">
      <span className="min-w-0 flex-1 truncate text-[14px]">{link.replace(/^https?:\/\//, '') || 'Загружаем…'}</span>
      <Button
        isDisabled={!link}
        onPress={async () => {
          await navigator.clipboard.writeText(link).catch(() => undefined);
          setCopied(true);
        }}
        className="h-9 shrink-0 rounded-full px-4 text-[14px] [--button-bg:white] [--button-bg-hover:#e7e7ea] [--button-fg:#0b0b0c]"
      >
        {copied && <CheckIcon size={16} strokeWidth={2.5} />}
        {copied ? 'Скопировано' : 'Скопировать'}
      </Button>
    </div>
  );
}
