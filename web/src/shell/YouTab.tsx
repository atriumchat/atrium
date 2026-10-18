import { useState } from 'react';
import { api } from '../api';
import { logout } from '../account/session';
import { showError, useStore } from '../store';
import type { MyStatus } from '../types';
import { AvatarPicker } from '../people/UserProfile';
import { InviteRow } from '../people/Invites';
import { Avatar } from '../ui/Avatar';
import { PushPage } from '../ui/PushPage';
import { Primary, Row, RowIcon, RowValue, Rows, field, fieldArea, fieldLabel } from '../ui/settings';
import { CheckIcon, ChevronRightIcon, LogoutIcon, PencilIcon, UserIcon } from '../ui/icons';
import { GomexMark } from '../ui/Logo';
import { AccountSettings, NickRow } from '../account/Account';
import { CallsGroup } from '../voice/VoiceSettings';
import { ServerSettings } from './ServerSettings';
import { DURATIONS, STATUS_LABEL, StatusDot, saveStatus, untilText } from './MeCard';

type Page = 'profile' | 'status' | 'bio' | 'account' | 'server';

/**
 * The phone's "Вы" tab, sorted by how often things are touched, on one screen without scrolling: the profile card
 * (photo, nick, about on its page), the status and the invite; the calls' settings, touched when friends hear noise;
 * then «Аккаунт» and the admin's «Сервер», rarely, a page each; «Выйти» last, at the foot.
 */
export function YouTab() {
  const me = useStore((s) => s.me);
  const status = useStore((s) => s.myStatus);
  const statusText = useStore((s) => s.myStatusText);
  const isAdmin = useStore((s) => s.isAdmin);
  const [page, setPage] = useState<Page | null>(null);
  const close = () => setPage(null);
  const back = () => setPage('profile');
  if (!me) return null;

  return (
    <div className="flex min-h-full flex-1 flex-col overflow-y-auto px-4 pb-6 pt-4">
      {/* The profile as a card of its own, roomier than the rows under it, as in Discord's and iOS's settings. */}
      <button
        type="button"
        onClick={() => setPage('profile')}
        className="flex w-full items-center gap-3.5 rounded-[20px] bg-default px-4 py-3.5 text-left active:bg-white/[0.05]"
      >
        <Avatar user={me} size={48} ringBg="var(--default)" />
        <span className="min-w-0 flex-1">
          <b className="block truncate text-[17px] font-semibold">{me.name}</b>
          <small className="mt-0.5 block truncate text-[14px] text-muted">{me.bio || 'Фото и о себе'}</small>
        </span>
        <ChevronRightIcon size={18} className="shrink-0 text-faint" />
      </button>
      <Rows className="mt-3">
        <Row
          icon={
            <RowIcon>
              <StatusDot status={status} />
            </RowIcon>
          }
          title="Статус"
          value={statusText || undefined}
          onPress={() => setPage('status')}
        >
          <RowValue>{STATUS_LABEL[status]}</RowValue>
        </Row>
        <InviteRow />
      </Rows>
      <CallsGroup className="mt-5" />
      {/* Rarely touched, a page each. */}
      <Rows className="mt-3">
        <Row
          icon={
            <RowIcon>
              <UserIcon />
            </RowIcon>
          }
          title="Аккаунт"
          onPress={() => setPage('account')}
        />
        {isAdmin && (
          <Row
            icon={
              <RowIcon>
                <GomexMark size={18} />
              </RowIcon>
            }
            title="Сервер"
            onPress={() => setPage('server')}
          />
        )}
      </Rows>

      {/* Last on the tab, at its foot. */}
      <button
        type="button"
        onClick={logout}
        className="mt-auto flex h-12 w-full shrink-0 items-center justify-center gap-2 rounded-full bg-white text-[16px] font-medium text-danger active:opacity-80 [&_svg]:size-5"
      >
        <LogoutIcon />
        Выйти
      </button>

      {/* Stays under the about page it opens, so "Назад" there comes back to it. */}
      <PushPage open={page === 'profile' || page === 'bio'} title="Профиль" onBack={close}>
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
            title="О себе"
            value={me.bio || undefined}
            onPress={() => setPage('bio')}
          />
        </Rows>
      </PushPage>
      <PushPage open={page === 'status'} title="Статус" onBack={close}>
        <StatusPage />
      </PushPage>
      <PushPage open={page === 'bio'} title="О себе" onBack={back}>
        <BioPage onSaved={back} />
      </PushPage>
      <PushPage open={page === 'account'} title="Аккаунт" onBack={close}>
        <AccountSettings />
      </PushPage>
      <PushPage open={page === 'server'} title="Сервер" onBack={close}>
        <ServerSettings />
      </PushPage>
    </div>
  );
}

const HINT: Record<MyStatus, string> = { online: '', dnd: 'Без звуков и уведомлений', invisible: 'Для остальных — не в сети' };

/** Online, do not disturb or invisible (the last two for how long, on a page of their own), and a line of your own. */
function StatusPage() {
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
            title={STATUS_LABEL[id]}
            value={status === id && id !== 'online' && until ? untilText(until) : HINT[id] || undefined}
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
        Свой статус
      </label>
      <input
        id="my-status-text"
        value={text}
        maxLength={64}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => text.trim() !== saved && saveStatus(status, text)}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        placeholder="Катаю, сплю, на паре…"
        className={field}
      />
      <PushPage open={timing} title={STATUS_LABEL[timed]} onBack={() => setTiming(false)}>
        <Rows className="mt-2">
          {DURATIONS.map(([minutes, label]) => (
            <Row
              key={minutes}
              title={label}
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
      showError(e instanceof Error ? e.message : 'Не удалось сохранить');
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
        placeholder="Игры, когда онлайн"
        aria-label="О себе"
        className={`${fieldArea} mt-2`}
      />
      <div className="mt-6">
        <Primary isPending={busy} isDisabled={bio.trim() === saved} onPress={save}>
          Сохранить
        </Primary>
      </div>
    </>
  );
}
