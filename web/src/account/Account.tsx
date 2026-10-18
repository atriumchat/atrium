import { useEffect, useId, useState, type FormEvent } from 'react';
import { toast } from '@heroui/react';
import { api } from '../api';
import { showError, useStore } from '../store';
import { expectNewToken, switchToken } from '../socket';
import { Avatar } from '../ui/Avatar';
import { CheckIcon } from '../ui/icons';
import { Primary, Row, RowValue, Rows, Secondary, SubPage, field, fieldArea, fieldLabel, useSub } from '../ui/settings';
import { AvatarPicker, BioEditor } from '../people/UserProfile';
import { downloadKey } from './RecoveryKey';

/**
 * The "Аккаунт" page of the settings: photo and about, the nick, then a row each for the password, the recovery key
 * and who's blocked; their forms open only from there. On the phone it is one group of the settings page, the nick
 * a row like the rest (the photo and about are on the "Вы" tab).
 */
export function AccountSettings() {
  const isMobile = useStore((s) => s.isMobile);
  if (isMobile) {
    return (
      <Rows title="Аккаунт" className="mt-6">
        <NickRow />
        <PasswordRow />
        <RecoveryRow />
        <BlockedRow />
      </Rows>
    );
  }
  return (
    <>
      <ProfileBlock />
      <NameField className="mt-6" />
      <Rows className="mt-8">
        <PasswordRow />
        <RecoveryRow />
        <BlockedRow />
      </Rows>
    </>
  );
}

function ProfileBlock() {
  const bio = useStore((s) => s.me?.bio ?? '');
  return (
    <div className="mt-6 flex items-start gap-5">
      <AvatarPicker />
      <div className="min-w-0 flex-1">
        <BioEditor key={bio} initial={bio} className={fieldArea} />
      </div>
    </div>
  );
}

function NickRow() {
  const name = useStore((s) => s.me?.name);
  const sub = useSub();
  return (
    <>
      <Row title="Ник" onPress={sub.show}>
        <RowValue>{name}</RowValue>
      </Row>
      <SubPage key={sub.key} open={sub.open} title="Ник" onClose={sub.hide}>
        <NameField onSaved={sub.hide} className="mt-2" />
      </SubPage>
    </>
  );
}

function NameField({ onSaved, className = '' }: { onSaved?: () => void; className?: string }) {
  const me = useStore((s) => s.me);
  const id = useId();
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
      onSaved?.();
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Не удалось сменить ник');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className={className}>
      {/* On the phone this is a page of its own, titled the same. */}
      <label htmlFor={id} className={`${fieldLabel} max-md:sr-only`}>
        Ник
      </label>
      <input id={id} value={name} maxLength={32} onChange={(e) => setName(e.target.value)} className={field} autoComplete="username" autoFocus={!!onSaved} />
      {/* A new nick is confirmed with the password, right under it. */}
      {changed && (
        <div className="mt-2 flex gap-2 max-md:flex-col">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Пароль для подтверждения"
            aria-label="Пароль"
            className={field}
            autoComplete="current-password"
          />
          <Primary type="submit" isPending={busy} isDisabled={!password} className="shrink-0">
            Сохранить
          </Primary>
        </div>
      )}
    </form>
  );
}

function PasswordRow() {
  const sub = useSub();
  return (
    <>
      <Row title="Пароль" action="Сменить" onPress={sub.show} />
      <PasswordPage key={sub.key} open={sub.open} onClose={sub.hide} />
    </>
  );
}

function PasswordPage({ open, onClose }: { open: boolean; onClose: () => void }) {
  const isMobile = useStore((s) => s.isMobile);
  const form = useId();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [busy, setBusy] = useState(false);
  const mismatch = repeat !== '' && repeat !== next;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (next.length < 8) return showError('Пароль — от 8 символов');
    setBusy(true);
    expectNewToken();
    try {
      const { token } = await api.changePassword(current, next);
      switchToken(token);
      toast('Пароль сменён');
      onClose();
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Не удалось сменить пароль');
    } finally {
      setBusy(false);
    }
  }

  return (
    <SubPage
      open={open}
      title="Смена пароля"
      onClose={onClose}
      footer={
        <Primary type="submit" form={form} isPending={busy} isDisabled={!current || !next || next !== repeat}>
          {isMobile ? 'Готово' : 'Сменить пароль'}
        </Primary>
      }
    >
      <form id={form} onSubmit={submit} className="flex flex-col gap-2 max-md:mt-2">
        <input
          type="password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          placeholder="Текущий пароль"
          aria-label="Текущий пароль"
          className={field}
          autoComplete="current-password"
          autoFocus
        />
        <input
          type="password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          placeholder="Новый пароль, от 8 символов"
          aria-label="Новый пароль"
          className={field}
          autoComplete="new-password"
        />
        <input
          type="password"
          value={repeat}
          onChange={(e) => setRepeat(e.target.value)}
          placeholder="Ещё раз"
          aria-label="Новый пароль ещё раз"
          className={field}
          autoComplete="new-password"
        />
        <p className={`pt-1 text-[13px] ${mismatch ? 'text-danger' : 'text-muted'}`}>
          {mismatch ? 'Пароли не совпадают' : 'Остальные устройства выйдут из аккаунта'}
        </p>
      </form>
    </SubPage>
  );
}

/** The key is shown once; only its hash stays on the server. With it and the nick a new password can be set. */
function RecoveryRow() {
  const has = useStore((s) => s.hasRecoveryKey);
  const sub = useSub();
  return (
    <>
      <Row title="Ключ восстановления" value={has ? 'Создан' : 'Не создан'} action={has ? 'Новый ключ' : 'Создать'} onPress={sub.show} />
      <RecoveryPage key={sub.key} open={sub.open} onClose={sub.hide} />
    </>
  );
}

// Done: the word changes and turns green, with a tick before it (as in the setup wizard).
const KEPT = 'text-here [--button-fg:var(--room-here)] [&_svg]:size-3.5';

/** Asks for the password, then shows the new key to copy or download: the old one stops working at that moment. */
function RecoveryPage({ open, onClose }: { open: boolean; onClose: () => void }) {
  const name = useStore((s) => s.me?.name ?? '');
  const serverName = useStore((s) => s.serverName);
  const form = useId();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState<string | null>(null);
  const [kept, setKept] = useState<'copied' | 'downloaded' | null>(null);

  async function make(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api.makeRecoveryKey(password);
      setKey(r.key);
      setPassword('');
      useStore.setState({ hasRecoveryKey: true });
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Не удалось создать ключ');
    } finally {
      setBusy(false);
    }
  }

  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setKept('copied');
    } catch {
      showError('Не получилось скопировать — ключ можно выделить вручную');
    }
  }

  const done = <CheckIcon size={14} strokeWidth={2.5} />;
  return (
    <SubPage
      open={open}
      title="Ключ восстановления"
      onClose={onClose}
      footer={
        key ? (
          <Primary onPress={onClose}>Готово</Primary>
        ) : (
          <Primary type="submit" form={form} isPending={busy} isDisabled={!password}>
            Создать
          </Primary>
        )
      }
    >
      {key ? (
        <div className="max-md:mt-2">
          <p className="select-all break-all rounded-[12px] border border-white/[0.07] bg-white/[0.03] px-4 py-3.5 text-center font-mono text-[17px] font-medium leading-[1.7] tracking-[0.04em]">
            {key}
          </p>
          <div className="mt-3 flex gap-2">
            <Secondary onPress={() => copy(key)} className={`max-md:h-11 max-md:flex-1 ${kept === 'copied' ? KEPT : ''}`}>
              {kept === 'copied' && done}
              {kept === 'copied' ? 'Скопирован' : 'Скопировать'}
            </Secondary>
            <Secondary
              onPress={() => {
                downloadKey({ key, name, serverName });
                setKept('downloaded');
              }}
              className={`max-md:h-11 max-md:flex-1 ${kept === 'downloaded' ? KEPT : ''}`}
            >
              {kept === 'downloaded' && done}
              {kept === 'downloaded' ? 'Скачан' : 'Скачать'}
            </Secondary>
          </div>
        </div>
      ) : (
        <form id={form} onSubmit={make} className="max-md:mt-2">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Пароль"
            aria-label="Пароль"
            className={field}
            autoComplete="current-password"
            autoFocus
          />
        </form>
      )}
    </SubPage>
  );
}

/** Only while someone is blocked: the count on the row, the people inside. */
function BlockedRow() {
  const blocked = useStore((s) => s.blocked);
  const users = useStore((s) => s.users);
  const sub = useSub();
  const { open, hide } = sub;
  // The last one unblocked takes the row away, and the list with it.
  useEffect(() => {
    if (open && blocked.length === 0) hide();
  }, [open, blocked.length, hide]);

  return (
    <>
      {blocked.length > 0 && (
        <Row title="Заблокированные" onPress={sub.show}>
          <RowValue>{blocked.length}</RowValue>
        </Row>
      )}
      <SubPage open={open} title="Заблокированные" onClose={hide}>
        <Rows className="max-md:mt-2">
          {blocked.map((id) => (
            <Row key={id} icon={<Avatar user={users[id]} size={34} />} title={users[id]?.name ?? '…'}>
              <Secondary
                onPress={() => api.unblock(id).then((list) => useStore.setState({ blocked: list }), (e) => showError(e instanceof Error ? e.message : 'Не получилось'))}
              >
                Разблокировать
              </Secondary>
            </Row>
          ))}
        </Rows>
      </SubPage>
    </>
  );
}
