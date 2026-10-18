import { Fragment, useState } from 'react';
import { api } from '../api';
import { logout } from '../account/session';
import { showError, useStore } from '../store';
import type { MyStatus } from '../types';
import { AvatarPicker } from '../people/UserProfile';
import { InviteRow } from '../people/Invites';
import { PushPage } from '../ui/PushPage';
import { Primary, Row, RowIcon, RowValue, Rows, field, fieldArea, fieldLabel } from '../ui/settings';
import { CheckIcon, GearIcon, LogoutIcon, PencilIcon } from '../ui/icons';
import { DURATIONS, STATUS_LABEL, StatusDot, saveStatus, untilText } from './MeCard';
import { useSettingsPages } from './SettingsDialog';

type Page = 'status' | 'bio' | 'settings';

/**
 * The phone's "Вы" tab, iOS's "me" screen: the photo and nick in the middle, then rows for the status, the about
 * line, the invite and the settings, each opening a page of its own, and "Выйти" apart at the foot.
 */
export function YouTab() {
  const me = useStore((s) => s.me);
  const status = useStore((s) => s.myStatus);
  const statusText = useStore((s) => s.myStatusText);
  const [page, setPage] = useState<Page | null>(null);
  const close = () => setPage(null);
  if (!me) return null;

  return (
    <div className="flex-1 overflow-y-auto px-4 pb-6">
      {/* The photo's ring is drawn in the overlay tone; here it is the window's. */}
      <header className="flex flex-col items-center pt-8 [--overlay:var(--app-window)]">
        <AvatarPicker size={96} />
        <h1 className="mt-2 max-w-full truncate text-[24px] font-bold">{me.name}</h1>
      </header>

      <Rows className="mt-6">
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
      <Rows className="mt-4">
        <InviteRow />
        <Row
          icon={
            <RowIcon>
              <GearIcon />
            </RowIcon>
          }
          title="Настройки"
          onPress={() => setPage('settings')}
        />
      </Rows>
      <Rows className="mt-4">
        <Row
          icon={
            <RowIcon className="text-danger">
              <LogoutIcon />
            </RowIcon>
          }
          title={<span className="text-danger">Выйти</span>}
          chevron={false}
          onPress={logout}
        />
      </Rows>

      <PushPage open={page === 'status'} title="Статус" onBack={close}>
        <StatusPage />
      </PushPage>
      <PushPage open={page === 'bio'} title="О себе" onBack={close}>
        <BioPage onSaved={close} />
      </PushPage>
      <PushPage open={page === 'settings'} title="Настройки" onBack={close}>
        <SettingsPage />
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

/** Every section of the settings on one page, a group each, as iOS's Settings. */
function SettingsPage() {
  const pages = useSettingsPages();
  return (
    <>
      {pages.map((page) => (
        <Fragment key={page.id}>{page.content}</Fragment>
      ))}
    </>
  );
}
