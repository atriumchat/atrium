import { useState, type ReactNode } from 'react';
import { api } from '../api';
import { logout } from '../account/session';
import { openFriends, showError, useStore } from '../store';
import { useT } from '../i18n';
import type { MyStatus } from '../types';
import { AvatarPicker } from '../people/UserProfile';
import { InviteRow } from '../people/Invites';
import { Avatar } from '../ui/Avatar';
import { PushPage } from '../ui/PushPage';
import { Primary, Row, RowIcon, Rows, field, fieldArea, fieldLabel } from '../ui/settings';
import { CheckIcon, ChevronRightIcon, GearIcon, LogoutIcon, PencilIcon, UserIcon, XIcon } from '../ui/icons';
import { RoundButton } from '../ui/ui';
import { Badge } from './HomeSidebar';
import { dateOnly } from '../chat/format';
import { GomexMark } from '../ui/Logo';
import { AccountSettings, LanguageRow, NickRow } from '../account/Account';
import { CallsGroup } from '../voice/VoiceSettings';
import { ServerSettings } from './ServerSettings';
import { DURATIONS, statusLabel, StatusDot, saveStatus, untilText } from './MeCard';

type Page = 'profile' | 'status' | 'bio' | 'account' | 'server' | 'settings';

/**
 * The phone's "You" tab is your own card, as others see it (the native app's): your face and status (with when it
 * ends, and a cross to drop it), the two things you change most, what's on your profile, and your friends. The
 * rest — invite, calls, account, language, the server, logging out — is rarely touched: Settings, behind the gear.
 */
export function YouTab() {
  const { t } = useT();
  const me = useStore((s) => s.me);
  const status = useStore((s) => s.myStatus);
  const statusText = useStore((s) => s.myStatusText);
  const until = useStore((s) => s.myStatusUntil);
  const isAdmin = useStore((s) => s.isAdmin);
  const [page, setPage] = useState<Page | null>(null);
  const close = () => setPage(null);
  const back = () => setPage('profile');
  const toSettings = () => setPage('settings');
  if (!me) return null;
  const custom = status !== 'online' || !!statusText;

  return (
    <div className="flex min-h-full flex-1 flex-col overflow-y-auto px-4 pb-6 pt-2">
      {/* Your photo, blurred, behind the top of the card: the same banner others see on your profile. */}
      <div className="relative h-[120px] shrink-0 overflow-hidden rounded-[24px] bg-surface-tertiary">
        {me.avatarUrl && <img src={me.avatarUrl} alt="" className="h-full w-full scale-150 object-cover opacity-70 blur-2xl" />}
        <button type="button" onClick={toSettings} aria-label={t('shell.you.settings')} className="absolute right-2.5 top-2.5 flex h-10 w-10 items-center justify-center rounded-full bg-black/45 transition-transform duration-150 active:scale-95">
          <GearIcon size={20} />
        </button>
      </div>
      <div className="relative -mt-12 ml-3 w-fit rounded-full bg-window p-1.5">
        <Avatar user={me} size={92} online status={status} ringBg="var(--app-window)" />
      </div>

      <div className="mt-3 flex flex-col gap-3 rounded-[20px] bg-default p-4">
        <h2 className="truncate text-[26px] font-bold leading-8">{me.name}</h2>
        {custom && (
          <div className="flex items-center gap-3 rounded-2xl bg-white/[0.05] py-2.5 pl-3.5 pr-2">
            <StatusDot status={status} />
            <span className="min-w-0 flex-1">
              <span className="line-clamp-2 block text-[16px]">{statusText || statusLabel(status)}</span>
              {until ? <span className="mt-0.5 block text-[14px] text-muted">{untilText(until)}</span> : null}
            </span>
            <RoundButton size="sm" tone="ghost" label={t('shell.you.clearStatus')} onPress={() => void saveStatus('online', '')}>
              <XIcon />
            </RoundButton>
          </div>
        )}
        <div className="flex gap-2">
          <Pill onPress={() => setPage('status')}>
            <StatusDot status={status} />
            {t('shell.you.editStatus')}
          </Pill>
          <Pill onPress={() => setPage('profile')}>
            <PencilIcon size={17} />
            {t('people.profile.edit')}
          </Pill>
        </div>
      </div>

      <div className="mt-3 overflow-hidden rounded-[20px] bg-default">
        <button type="button" onClick={() => setPage('bio')} className="block w-full px-4 py-3 text-left active:bg-white/[0.05]">
          <span className="block text-[14px] text-muted">{t('people.profile.about')}</span>
          <span className={`mt-0.5 block whitespace-pre-wrap break-words text-[17px] leading-[23px] ${me.bio ? '' : 'text-muted'}`}>{me.bio || t('shell.you.bioPlaceholder')}</span>
        </button>
        <div className="ml-4 h-px bg-white/[0.08]" />
        <div className="px-4 py-3">
          <span className="block text-[14px] text-muted">{t('people.profile.since')}</span>
          <span className="mt-0.5 block text-[17px]">{dateOnly(me.createdAt, { day: 'numeric', month: 'long', year: 'numeric' })}</span>
        </div>
      </div>

      <FriendsRow />

      <PushPage open={page === 'settings' || page === 'account' || page === 'server'} title={t('shell.you.settings')} onBack={close}>
        <Rows className="mt-2">
          <InviteRow />
        </Rows>
        <CallsGroup className="mt-5" />
        <Rows className="mt-3">
          <Row
            icon={
              <RowIcon>
                <UserIcon />
              </RowIcon>
            }
            title={t('shell.you.account')}
            onPress={() => setPage('account')}
          />
          <LanguageRow />
          {isAdmin && (
            <Row
              icon={
                <RowIcon>
                  <GomexMark size={18} />
                </RowIcon>
              }
              title={t('shell.you.server')}
              onPress={() => setPage('server')}
            />
          )}
        </Rows>
        {/* A red row, not a white button: logging out is rare and shouldn't be the loudest thing on the page. */}
        <Rows className="mt-3">
          <button type="button" onClick={logout} className="flex min-h-[52px] w-full items-center gap-3.5 px-4 text-left text-[16px] text-danger active:bg-white/[0.05] [&_svg]:size-5">
            <LogoutIcon />
            {t('shell.you.logout')}
          </button>
        </Rows>
      </PushPage>

      {/* Stays under the about page it opens, so "Back" there comes back to it. */}
      <PushPage open={page === 'profile' || page === 'bio'} title={t('shell.you.profile')} onBack={close}>
        {/* The photo's ring is drawn in the overlay tone; here it is the window's. */}
        <div className="flex flex-col items-center pt-4 [--overlay:var(--app-window)]">
          <AvatarPicker size={96} />
          <h2 className="mt-2 max-w-full truncate text-[22px] font-bold">{me.name}</h2>
        </div>
        <Rows className="mt-6">
          <NickRow />
          <Row
            icon={
              <RowIcon>
                <PencilIcon />
              </RowIcon>
            }
            title={t('shell.you.bio')}
            value={me.bio || undefined}
            onPress={() => setPage('bio')}
          />
        </Rows>
      </PushPage>
      <PushPage open={page === 'status'} title={t('shell.status.title')} onBack={close}>
        <StatusPage />
      </PushPage>
      <PushPage open={page === 'bio'} title={t('shell.you.bio')} onBack={back}>
        <BioPage onSaved={back} />
      </PushPage>
      <PushPage open={page === 'account'} title={t('shell.you.account')} onBack={toSettings}>
        <AccountSettings />
      </PushPage>
      <PushPage open={page === 'server'} title={t('shell.you.server')} onBack={toSettings}>
        <ServerSettings />
      </PushPage>
    </div>
  );
}

/** Online, do not disturb or invisible (the last two for how long, on a page of their own), and a line of your own. */
function StatusPage() {
  const { t } = useT();
  const hint: Record<MyStatus, string> = { online: '', dnd: t('shell.status.dndHint'), invisible: t('shell.status.invisibleHint') };
  const status = useStore((s) => s.myStatus);
  const until = useStore((s) => s.myStatusUntil);
  const saved = useStore((s) => s.myStatusText);
  const [text, setText] = useState(saved);
  // Kept apart from `timing`, so the durations' page keeps its title while it slides away.
  const [timed, setTimed] = useState<MyStatus>('dnd');
  const [timing, setTiming] = useState(false);

  return (
    <>
      <Rows className="mt-2">
        {(['online', 'dnd', 'invisible'] as const).map((id) => (
          <Row
            key={id}
            icon={
              <RowIcon>
                <StatusDot status={id} />
              </RowIcon>
            }
            title={statusLabel(id)}
            value={status === id && id !== 'online' && until ? untilText(until) : hint[id] || undefined}
            chevron={false}
            onPress={() => {
              if (id === 'online') return void saveStatus('online', text);
              setTimed(id);
              setTiming(true);
            }}
          >
            {status === id && <CheckIcon size={20} className="shrink-0" />}
          </Row>
        ))}
      </Rows>
      <label htmlFor="my-status-text" className={`${fieldLabel} mt-6 px-4`}>
        {t('shell.status.own')}
      </label>
      <input
        id="my-status-text"
        value={text}
        maxLength={64}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => text.trim() !== saved && saveStatus(status, text)}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        placeholder={t('shell.status.placeholder')}
        className={field}
      />
      <PushPage open={timing} title={statusLabel(timed)} onBack={() => setTiming(false)}>
        <Rows className="mt-2">
          {DURATIONS.map(([minutes, key]) => (
            <Row
              key={minutes}
              title={t(key)}
              chevron={false}
              onPress={async () => {
                await saveStatus(timed, text, minutes);
                setTiming(false);
              }}
            />
          ))}
        </Rows>
      </PushPage>
    </>
  );
}

function BioPage({ onSaved }: { onSaved: () => void }) {
  const { t } = useT();
  const saved = useStore((s) => s.me?.bio ?? '');
  const [bio, setBio] = useState(saved);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      const me = await api.updateMe(bio);
      useStore.setState((s) => ({ me, users: { ...s.users, [me.id]: me } }));
      onSaved();
    } catch (e) {
      showError(e instanceof Error ? e.message : t('shell.you.saveFailed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <textarea
        value={bio}
        onChange={(e) => setBio(e.target.value)}
        maxLength={190}
        rows={5}
        placeholder={t('shell.you.bioPlaceholder')}
        aria-label={t('shell.you.bio')}
        className={`${fieldArea} mt-2`}
      />
      <div className="mt-6">
        <Primary isPending={busy} isDisabled={bio.trim() === saved} onPress={save}>
          {t('shell.you.save')}
        </Primary>
      </div>
    </>
  );
}

/** One of the two buttons on your card. */
function Pill({ children, onPress }: { children: ReactNode; onPress: () => void }) {
  return (
    <button type="button" onClick={onPress} className="flex h-11 min-w-0 flex-1 items-center justify-center gap-2 rounded-full bg-white/[0.09] px-2.5 text-[16px] font-medium transition-[background-color,transform] duration-150 active:scale-[0.97] active:bg-white/[0.16]">
      {children}
    </button>
  );
}

/** Your friends as a row of faces; the red number is requests waiting for you. */
function FriendsRow() {
  const { t } = useT();
  const friends = useStore((s) => s.friends);
  const users = useStore((s) => s.users);
  const online = useStore((s) => s.online);
  const incoming = friends.filter((f) => f.status === 'incoming').length;
  const faces = friends.filter((f) => f.status === 'friend').map((f) => f.userId).sort((a, b) => Number(online.includes(b)) - Number(online.includes(a))).slice(0, 5);
  return (
    <button type="button" onClick={openFriends} className="mt-3 flex min-h-[60px] w-full items-center gap-3 rounded-[20px] bg-default px-4 text-left active:bg-white/[0.05]">
      <span className="flex-1 text-[17px] font-medium">{t('shell.you.friends')}</span>
      {incoming > 0 && <Badge count={incoming} />}
      <span className="flex -space-x-2.5">
        {faces.map((id) => (
          <span key={id} className="rounded-full ring-2 ring-[var(--default)]">
            <Avatar user={users[id]} size={28} />
          </span>
        ))}
      </span>
      <ChevronRightIcon size={18} className="shrink-0 text-faint" />
    </button>
  );
}
