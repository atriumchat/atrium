import { useState, type FormEvent, type ReactNode } from 'react';
import { Button } from '@heroui/react';
import { api } from '../api';
import { showError, useStore } from '../store';
import { expectNewToken, switchToken } from '../socket';
import { Avatar } from '../ui/Avatar';
import { CheckIcon } from '../ui/icons';
import { AvatarPicker, BioEditor } from '../people/UserProfile';

/** The "Аккаунт" page of the settings: photo and about, nick, password, the recovery key and who you blocked. */
export function AccountSettings() {
  return (
    <>
      <ProfileSection />
      <NameSection />
      <PasswordSection />
      <RecoverySection />
      <BlockedSection />
    </>
  );
}

function Section({ title, hint, children }: { title: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <section className="mt-6">
      <h3 className="text-[15px] font-medium">{title}</h3>
      {hint && <p className="mt-0.5 text-[13px] leading-snug text-muted">{hint}</p>}
      <div className="mt-3 flex flex-col gap-2">{children}</div>
    </section>
  );
}

const field = 'h-11 w-full rounded-full bg-surface-tertiary px-4 text-[15px] outline-none placeholder:text-faint focus:ring-2 focus:ring-focus';
const white = 'h-11 rounded-full px-5 text-[15px] [--button-bg:white] [--button-bg-hover:#e7e7ea] [--button-fg:#0b0b0c]';

function ProfileSection() {
  const bio = useStore((s) => s.me?.bio ?? '');
  return (
    <Section title="Профиль">
      <div className="flex items-start gap-4">
        <AvatarPicker />
        <div className="min-w-0 flex-1">
          <BioEditor key={bio} initial={bio} />
        </div>
      </div>
    </Section>
  );
}

function NameSection() {
  const me = useStore((s) => s.me);
  const [name, setName] = useState(me?.name ?? '');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const changed = name.trim() !== '' && name.trim() !== me?.name;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const updated = await api.changeName(name, password);
      useStore.setState((s) => ({ me: updated, users: { ...s.users, [updated.id]: updated } }));
      setPassword('');
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Не удалось сменить ник');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title="Ник" hint="Упоминания и личка привязаны к аккаунту, а не к нику">
      <form onSubmit={submit} className="flex flex-col gap-2">
        <input value={name} maxLength={32} onChange={(e) => setName(e.target.value)} aria-label="Новый ник" className={field} />
        {changed && (
          <div className="flex gap-2">
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Пароль для подтверждения" aria-label="Пароль" className={field} autoComplete="current-password" />
            <Button type="submit" isPending={busy} isDisabled={!password} className={white}>
              Сменить
            </Button>
          </div>
        )}
      </form>
    </Section>
  );
}

function PasswordSection() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const mismatch = repeat !== '' && repeat !== next;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (next.length < 8) return showError('Пароль — от 8 символов');
    setBusy(true);
    expectNewToken();
    try {
      const { token } = await api.changePassword(current, next);
      switchToken(token);
      setCurrent('');
      setNext('');
      setRepeat('');
      setDone(true);
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Не удалось сменить пароль');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title="Пароль" hint="После смены остальные устройства выйдут из аккаунта">
      <form onSubmit={submit} className="flex flex-col gap-2">
        <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} placeholder="Текущий пароль" aria-label="Текущий пароль" className={field} autoComplete="current-password" />
        <input type="password" value={next} onChange={(e) => setNext(e.target.value)} placeholder="Новый пароль, от 8 символов" aria-label="Новый пароль" className={field} autoComplete="new-password" />
        <input type="password" value={repeat} onChange={(e) => setRepeat(e.target.value)} placeholder="Ещё раз" aria-label="Новый пароль ещё раз" className={field} autoComplete="new-password" />
        {mismatch && <p className="px-1 text-[13px] text-danger">Пароли не совпадают</p>}
        {done && (
          <p className="flex items-center gap-1.5 px-1 text-[13px] text-success">
            <CheckIcon size={14} /> Пароль сменён
          </p>
        )}
        <Button type="submit" isPending={busy} isDisabled={!current || !next || next !== repeat} className={`${white} self-start`}>
          Сменить пароль
        </Button>
      </form>
    </Section>
  );
}

/** The key is shown once; only its hash stays on the server. With it and the nick you can set a new password. */
function RecoverySection() {
  const has = useStore((s) => s.hasRecoveryKey);
  const [password, setPassword] = useState('');
  const [asking, setAsking] = useState(false);
  const [key, setKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  async function make(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api.makeRecoveryKey(password);
      setKey(r.key);
      setPassword('');
      setAsking(false);
      useStore.setState({ hasRecoveryKey: true });
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Не удалось создать ключ');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section
      title="Ключ восстановления"
      hint={
        key
          ? 'Показывается один раз: в менеджер паролей или на бумагу'
          : has
            ? 'Ключ есть. Новый заменит старый — старый перестанет работать.'
            : 'Нужен, если забудется пароль'
      }
    >
      {key ? (
        <div className="flex items-center gap-2 rounded-full bg-surface-tertiary py-1.5 pl-4 pr-1.5">
          <span className="min-w-0 flex-1 select-all break-all font-mono text-[14px] tracking-wide">{key}</span>
          <Button
            onPress={async () => {
              await navigator.clipboard.writeText(key).catch(() => undefined);
              setCopied(true);
            }}
            className="h-9 shrink-0 rounded-full px-4 text-[14px] [--button-bg:white] [--button-bg-hover:#e7e7ea] [--button-fg:#0b0b0c]"
          >
            {copied ? 'Скопировано' : 'Скопировать'}
          </Button>
        </div>
      ) : asking ? (
        <form onSubmit={make} className="flex gap-2">
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Пароль для подтверждения" aria-label="Пароль" className={field} autoComplete="current-password" autoFocus />
          <Button type="submit" isPending={busy} isDisabled={!password} className={white}>
            Создать
          </Button>
        </form>
      ) : (
        <Button onPress={() => setAsking(true)} className={`${white} self-start`}>
          {has ? 'Создать новый ключ' : 'Создать ключ'}
        </Button>
      )}
    </Section>
  );
}

function BlockedSection() {
  const blocked = useStore((s) => s.blocked);
  const users = useStore((s) => s.users);
  return (
    <Section title="Заблокированные" hint={blocked.length ? undefined : 'Никого. Заблокировать можно в профиле человека.'}>
      {blocked.map((id) => (
        <div key={id} className="-mx-2 flex h-12 items-center gap-3 rounded-full px-2">
          <Avatar user={users[id]} size={32} ringBg="var(--overlay)" />
          <span className="min-w-0 flex-1 truncate text-[15px]">{users[id]?.name ?? '…'}</span>
          <button
            onClick={() => api.unblock(id).then((list) => useStore.setState({ blocked: list }), (e) => showError(e instanceof Error ? e.message : 'Не получилось'))}
            className="rounded-full px-3 py-1.5 text-[13px] text-muted hover:bg-white/10 hover:text-foreground"
          >
            Разблокировать
          </button>
        </div>
      ))}
    </Section>
  );
}
