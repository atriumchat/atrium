import { useEffect, useId, useState, type FormEvent } from 'react';
import { toast } from '@heroui/react';
import { api } from '../api';
import { showError, useStore } from '../store';
import { expectNewToken, switchToken } from '../socket';
import { Avatar } from '../ui/Avatar';
import { CheckIcon, GlobeIcon } from '../ui/icons';
import { ChoiceRow, Primary, RowIcon, Row, RowValue, Rows, Secondary, SubPage, field, fieldArea, fieldLabel, useSub } from '../ui/settings';
import { AvatarPicker, BioEditor } from '../people/UserProfile';
import { downloadKey } from './RecoveryKey';
import { CopyButton } from '../ui/CopyButton';
import { LANGS, setLang, useT, type Lang } from '../i18n';

/**
 * The "Account" page of the settings: photo and about, the nick, then a row each for the password, the recovery key
 * and who's blocked; their forms open only from there. On the phone it is one group of the settings page, the nick
 * a row like the rest (the photo and about are on the "You" tab).
 */
/** Per device (not part of the account), so it is shown by the phone's "You" tab too. */
export function LanguageRow() {
  const { t, choice } = useT();
  const options: [Lang | 'system', string][] = [['system', t('account.language.system')], ...LANGS.map((l): [Lang, string] => [l.id, l.label])];
  return (
    <ChoiceRow<Lang | 'system'>
      icon={
        <RowIcon>
          <GlobeIcon />
        </RowIcon>
      }
      title={t('account.language')}
      value={choice ?? 'system'}
      options={options}
      onChange={(v) => setLang(v === 'system' ? null : v)}
    />
  );
}

export function AccountSettings() {
  const isMobile = useStore((s) => s.isMobile);
  // A demo's guest has no password to change and nothing to recover.
  const guest = useStore((s) => s.isGuest);
  if (isMobile) {
    return (
      // The nick is on the "Profile" page with the photo; here only what's rarely touched.
      <Rows className="mt-2">
        {!guest && <PasswordRow />}
        {!guest && <RecoveryRow />}
        <BlockedRow />
      </Rows>
    );
  }
  return (
    <>
      <ProfileBlock />
      <NameField className="mt-6" />
      <Rows className="mt-8">
        <LanguageRow />
        {!guest && <PasswordRow />}
        {!guest && <RecoveryRow />}
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

export function NickRow() {
  const { t } = useT();
  const name = useStore((s) => s.me?.name);
  const sub = useSub();
  return (
    <>
      <Row title={t('account.nick.title')} onPress={sub.show}>
        <RowValue>{name}</RowValue>
      </Row>
      <SubPage key={sub.key} open={sub.open} title={t('account.nick.title')} onClose={sub.hide}>
        <NameField onSaved={sub.hide} className="mt-2" />
      </SubPage>
    </>
  );
}

function NameField({ onSaved, className = '' }: { onSaved?: () => void; className?: string }) {
  const { t } = useT();
  const me = useStore((s) => s.me);
  const guest = useStore((s) => s.isGuest);
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
      showError(err instanceof Error ? err.message : t('account.nick.failed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className={className}>
      {/* On the phone this is a page of its own, titled the same. */}
      <label htmlFor={id} className={`${fieldLabel} max-md:sr-only`}>
        {t('account.nick.title')}
      </label>
      <input id={id} value={name} maxLength={32} onChange={(e) => setName(e.target.value)} className={field} autoComplete="username" autoFocus={!!onSaved} />
      {/* A new nick is confirmed with the password, right under it; a demo's guest has none and just saves. */}
      {changed && guest && (
        <div className="mt-2 flex gap-2 max-md:flex-col">
          <Primary type="submit" isPending={busy} className="shrink-0">
            {t('account.nick.save')}
          </Primary>
        </div>
      )}
      {changed && !guest && (
        <div className="mt-2 flex gap-2 max-md:flex-col">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={t('account.nick.passwordPlaceholder')}
            aria-label={t('account.nick.passwordLabel')}
            className={field}
            autoComplete="current-password"
          />
          <Primary type="submit" isPending={busy} isDisabled={!password} className="shrink-0">
            {t('account.nick.save')}
          </Primary>
        </div>
      )}
    </form>
  );
}

function PasswordRow() {
  const { t } = useT();
  const sub = useSub();
  return (
    <>
      <Row title={t('account.password.title')} action={t('account.password.change')} onPress={sub.show} />
      <PasswordPage key={sub.key} open={sub.open} onClose={sub.hide} />
    </>
  );
}

function PasswordPage({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useT();
  const isMobile = useStore((s) => s.isMobile);
  const form = useId();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [busy, setBusy] = useState(false);
  const mismatch = repeat !== '' && repeat !== next;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (next.length < 8) return showError(t('account.password.tooShort'));
    setBusy(true);
    expectNewToken();
    try {
      const { token } = await api.changePassword(current, next);
      switchToken(token);
      toast(t('account.password.changed'));
      onClose();
    } catch (err) {
      showError(err instanceof Error ? err.message : t('account.password.failed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SubPage
      open={open}
      title={t('account.password.pageTitle')}
      onClose={onClose}
      footer={
        <Primary type="submit" form={form} isPending={busy} isDisabled={!current || !next || next !== repeat}>
          {isMobile ? t('account.password.done') : t('account.password.submit')}
        </Primary>
      }
    >
      <form id={form} onSubmit={submit} className="flex flex-col gap-2 max-md:mt-2">
        <input
          type="password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          placeholder={t('account.password.current')}
          aria-label={t('account.password.current')}
          className={field}
          autoComplete="current-password"
          autoFocus
        />
        <input
          type="password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          placeholder={t('account.password.newPlaceholder')}
          aria-label={t('account.password.newLabel')}
          className={field}
          autoComplete="new-password"
        />
        <input
          type="password"
          value={repeat}
          onChange={(e) => setRepeat(e.target.value)}
          placeholder={t('account.password.repeatPlaceholder')}
          aria-label={t('account.password.repeatLabel')}
          className={field}
          autoComplete="new-password"
        />
        <p className={`pt-1 text-[13px] ${mismatch ? 'text-danger' : 'text-muted'}`}>
          {mismatch ? t('account.password.mismatch') : t('account.password.othersSignOut')}
        </p>
      </form>
    </SubPage>
  );
}

/** The key is shown once; only its hash stays on the server. With it and the nick a new password can be set. */
function RecoveryRow() {
  const { t } = useT();
  const has = useStore((s) => s.hasRecoveryKey);
  const sub = useSub();
  return (
    <>
      <Row
        title={t('account.recovery.title')}
        value={has ? t('account.recovery.exists') : t('account.recovery.missing')}
        action={has ? t('account.recovery.renew') : t('account.recovery.create')}
        onPress={sub.show}
      />
      <RecoveryPage key={sub.key} open={sub.open} onClose={sub.hide} />
    </>
  );
}

// Done: the word changes and turns green, with a tick before it (as in the setup wizard).
const KEPT = 'text-here [--button-fg:var(--room-here)] [&_svg]:size-3.5';

/** Asks for the password, then shows the new key to copy or download: the old one stops working at that moment. */
function RecoveryPage({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useT();
  const name = useStore((s) => s.me?.name ?? '');
  const serverName = useStore((s) => s.serverName);
  const form = useId();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState<string | null>(null);
  const [kept, setKept] = useState<'downloaded' | null>(null);

  async function make(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api.makeRecoveryKey(password);
      setKey(r.key);
      setPassword('');
      useStore.setState({ hasRecoveryKey: true });
    } catch (err) {
      showError(err instanceof Error ? err.message : t('account.recovery.failed'));
    } finally {
      setBusy(false);
    }
  }

  const done = <CheckIcon size={14} strokeWidth={2.5} />;
  return (
    <SubPage
      open={open}
      title={t('account.recovery.title')}
      onClose={onClose}
      footer={
        key ? (
          <Primary onPress={onClose}>{t('account.recovery.done')}</Primary>
        ) : (
          <Primary type="submit" form={form} isPending={busy} isDisabled={!password}>
            {t('account.recovery.create')}
          </Primary>
        )
      }
    >
      {key ? (
        <div className="max-md:mt-2">
          <div className="flex items-center rounded-[12px] border border-white/[0.07] bg-white/[0.03] py-1.5 pl-11 pr-1.5">
            <p className="flex-1 select-all break-all py-2 text-center font-mono text-[17px] font-medium leading-[1.7] tracking-[0.04em]">{key}</p>
            <CopyButton text={key} />
          </div>
          <div className="mt-3 flex gap-2">
            <Secondary
              onPress={() => {
                downloadKey({ key, name, serverName });
                setKept('downloaded');
              }}
              className={`max-md:h-11 max-md:flex-1 ${kept === 'downloaded' ? KEPT : ''}`}
            >
              {kept === 'downloaded' && done}
              {kept === 'downloaded' ? t('account.recovery.downloaded') : t('account.recovery.download')}
            </Secondary>
          </div>
        </div>
      ) : (
        <form id={form} onSubmit={make} className="max-md:mt-2">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={t('account.recovery.password')}
            aria-label={t('account.recovery.password')}
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
  const { t } = useT();
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
        <Row title={t('account.blocked.title')} onPress={sub.show}>
          <RowValue>{blocked.length}</RowValue>
        </Row>
      )}
      <SubPage open={open} title={t('account.blocked.title')} onClose={hide}>
        <Rows className="max-md:mt-2">
          {blocked.map((id) => (
            <Row key={id} icon={<Avatar user={users[id]} size={34} />} title={users[id]?.name ?? '…'}>
              <Secondary
                onPress={() => api.unblock(id).then((list) => useStore.setState({ blocked: list }), (e) => showError(e instanceof Error ? e.message : t('account.blocked.failed')))}
              >
                {t('account.blocked.unblock')}
              </Secondary>
            </Row>
          ))}
        </Rows>
      </SubPage>
    </>
  );
}
