import { useRef, useState, type ReactNode, type RefObject } from 'react';
import { Popover } from '@heroui/react';
import { Menu, MenuItem, MenuSeparator, SubMenu } from '../ui/Menu';
import { api } from '../api';
import { showError, useStore } from '../store';
import { localeOf, t, useT, type Key } from '../i18n';
import type { MyStatus } from '../types';
import { AvatarPicker } from '../people/UserProfile';
import { SettingsDialog } from './SettingsDialog';
import { ChevronRightIcon, PencilIcon, PlusIcon, XIcon } from '../ui/icons';

/** Callers re-render on a language change through their own useT(). */
export const statusLabel = (status: MyStatus) => t(`shell.status.${status}`);

export const DURATIONS: [number, Key][] = [
  [15, 'shell.duration.m15'],
  [60, 'shell.duration.h1'],
  [8 * 60, 'shell.duration.h8'],
  [24 * 60, 'shell.duration.h24'],
  [3 * 24 * 60, 'shell.duration.d3'],
  [0, 'shell.duration.forever'],
];

export async function saveStatus(status: MyStatus, text: string, minutes?: number) {
  try {
    const r = await api.setStatus(status, text.trim(), minutes);
    useStore.setState({ myStatus: r.status, myStatusText: r.text, myStatusUntil: r.until });
  } catch (e) {
    showError(e instanceof Error ? e.message : t('shell.status.changeFailed'));
  }
}

/** "until 18:30", or with the day when it isn't today. */
export function untilText(until: number) {
  const d = new Date(until);
  const time = d.toLocaleTimeString(localeOf(), { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === new Date().toDateString()) return t('shell.status.until', { time });
  return t('shell.status.untilDate', { date: d.toLocaleDateString(localeOf(), { day: 'numeric', month: 'short' }), time });
}

/**
 * Your own card, Discord's: your row at the bottom opens it above the whole bottom panel, flush with its
 * left edge (`anchor`). Photo, your line of status in a bubble, and the two things you come here for:
 * editing the profile and the status, with "do not disturb" and "invisible" for a while or for good.
 */
export function MeCard({ anchor, children, className, placement = 'top start' }: { anchor?: RefObject<HTMLElement | null>; children: ReactNode; className?: string; placement?: 'top start' | 'right' }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState(false);
  return (
    <>
      <Popover isOpen={open} onOpenChange={setOpen}>
        <Popover.Trigger aria-label={t('shell.me.profile')} className={className}>
          {children}
        </Popover.Trigger>
        <Popover.Content triggerRef={anchor} placement={placement} offset={8} className="w-[300px] overflow-hidden p-0">
          <Popover.Dialog aria-label={t('shell.me.profile')} className="p-0 outline-none">
            <Card
              onEdit={() => {
                setOpen(false);
                setSettings(true);
              }}
            />
          </Popover.Dialog>
        </Popover.Content>
      </Popover>
      {settings && <SettingsDialog onClose={() => setSettings(false)} />}
    </>
  );
}

function Card({ onEdit }: { onEdit: () => void }) {
  const { t } = useT();
  const me = useStore((s) => s.me);
  if (!me) return null;
  return (
    <div>
      {/* The banner is your own photo, blurred down to a mood; graphite when there's no photo. */}
      <div className="relative h-[88px] overflow-hidden bg-surface-tertiary">
        {me.avatarUrl && <img src={me.avatarUrl} alt="" className="h-full w-full scale-150 object-cover opacity-70 blur-2xl" />}
      </div>
      <div className="px-4">
        <div className="-mt-11 flex items-end gap-2">
          <AvatarPicker />
          <StatusBubble />
        </div>
        <h2 className="mt-2 truncate text-[20px] font-bold leading-7">{me.name}</h2>
        {me.bio && <p className="mt-0.5 line-clamp-3 whitespace-pre-wrap break-words text-[14px] leading-5 text-muted">{me.bio}</p>}
      </div>
      <div className="p-3 pt-4">
        <div className="flex flex-col rounded-row bg-white/[0.05] p-1">
          <Row icon={<PencilIcon size={16} />} onPress={onEdit}>
            {t('shell.me.edit')}
          </Row>
          <div className="mx-3 h-px bg-separator" />
          <StatusRow />
        </div>
      </div>
    </div>
  );
}

function Row({ icon, children, onPress }: { icon: ReactNode; children: ReactNode; onPress?: () => void }) {
  return (
    <button onClick={onPress} className="flex h-10 w-full items-center gap-3 rounded-fine px-3 text-left text-[14px] transition-colors hover:bg-white/[0.06]">
      <span className="flex w-4 shrink-0 justify-center text-muted">{icon}</span>
      {children}
    </button>
  );
}

/** Discord's status dots: green, red with a bar, grey ring. */
export function StatusDot({ status }: { status: MyStatus }) {
  if (status === 'invisible') return <span className="block h-3 w-3 shrink-0 rounded-full border-[3px] border-[#8e8e93]" />;
  if (status === 'dnd')
    return (
      <span className="flex h-3 w-3 shrink-0 items-center justify-center rounded-full bg-danger">
        <span className="h-[2px] w-1.5 rounded-full bg-black/80" />
      </span>
    );
  return <span className="block h-3 w-3 shrink-0 rounded-full bg-success" />;
}

function StatusRow() {
  const { t } = useT();
  const status = useStore((s) => s.myStatus);
  const until = useStore((s) => s.myStatusUntil);
  const text = useStore((s) => s.myStatusText);

  function choose(next: MyStatus, minutes?: number) {
    void saveStatus(next, text, next === 'online' ? undefined : (minutes ?? 0));
  }

  return (
    <Menu
      label={t('shell.status.title')}
      placement="right top"
      offset={12}
      triggerClassName="flex h-10 w-full items-center gap-3 rounded-fine px-3 text-left text-[14px] outline-none transition-colors hover:bg-white/[0.06] data-[focus-visible=true]:ring-2 data-[focus-visible=true]:ring-focus"
      trigger={
        <>
          <span className="flex w-4 shrink-0 justify-center">
            <StatusDot status={status} />
          </span>
          <span className="min-w-0 flex-1 truncate">
            {statusLabel(status)}
            {until && status !== 'online' && <span className="text-muted"> · {untilText(until)}</span>}
          </span>
          <ChevronRightIcon size={16} className="shrink-0 text-muted" />
        </>
      }
      onAction={(key) => key === 'online' && choose('online')}
    >
      <MenuItem id="online" label={t('shell.status.online')} icon={<StatusDot status="online" />} check={status === 'online'} />
      <MenuSeparator />
      <Timed status="dnd" current={status} hint={t('shell.status.dndHint')} onPick={choose} />
      <Timed status="invisible" current={status} hint={t('shell.status.invisibleHint')} onPick={choose} />
    </Menu>
  );
}

function Timed({ status, current, hint, onPick }: { status: MyStatus; current: MyStatus; hint: string; onPick: (status: MyStatus, minutes: number) => void }) {
  const { t } = useT();
  return (
    <SubMenu id={status} label={statusLabel(status)} description={hint} icon={<StatusDot status={status} />} check={current === status} onAction={(key) => onPick(status, Number(key))}>
      {DURATIONS.map(([minutes, key]) => (
        <MenuItem key={minutes} id={String(minutes)} label={t(key)} />
      ))}
    </SubMenu>
  );
}

/** Your line of status next to the photo, as Discord's thought bubble: click to write, Enter to keep. */
function StatusBubble() {
  const { t } = useT();
  const status = useStore((s) => s.myStatus);
  const saved = useStore((s) => s.myStatusText);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(saved);
  const input = useRef<HTMLInputElement>(null);

  function finish() {
    setEditing(false);
    if (text.trim() !== saved) void saveStatus(status, text);
  }

  return (
    <div className="mb-3 flex min-w-0 flex-1 items-center rounded-surface bg-surface-tertiary px-3 py-2 text-[13px] leading-[18px]">
      {editing ? (
        <input
          ref={input}
          autoFocus
          value={text}
          maxLength={64}
          onChange={(e) => setText(e.target.value)}
          onBlur={finish}
          onKeyDown={(e) => {
            if (e.key === 'Enter') input.current?.blur();
            if (e.key === 'Escape') {
              e.stopPropagation();
              setText(saved);
              setEditing(false);
            }
          }}
          placeholder={t('shell.status.placeholder')}
          aria-label={t('shell.status.own')}
          className="w-full bg-transparent outline-none placeholder:text-faint"
        />
      ) : (
        <button
          onClick={() => {
            setText(saved);
            setEditing(true);
          }}
          className={`flex w-full min-w-0 items-center gap-1.5 text-left ${saved ? 'text-foreground' : 'text-muted hover:text-foreground'}`}
        >
          {!saved && <PlusIcon size={14} className="shrink-0" />}
          <span className="line-clamp-2 min-w-0 flex-1 break-words">{saved || t('shell.status.own')}</span>
        </button>
      )}
      {!editing && saved && (
        <button type="button" onClick={() => void saveStatus(status, '')} aria-label={t('shell.you.clearStatus')} title={t('shell.you.clearStatus')} className="-mr-1 ml-1 flex size-6 shrink-0 items-center justify-center rounded-full text-muted hover:bg-white/10 hover:text-foreground">
          <XIcon size={13} />
        </button>
      )}
    </div>
  );
}
