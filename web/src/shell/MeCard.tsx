import { useRef, useState, type ReactNode, type RefObject } from 'react';
import { Description, Dropdown, Label, Popover, Separator } from '@heroui/react';
import { api } from '../api';
import { showError, useStore } from '../store';
import type { MyStatus } from '../types';
import { AvatarPicker } from '../people/UserProfile';
import { SettingsDialog } from './SettingsDialog';
import { ChevronRightIcon, PencilIcon, PlusIcon } from '../ui/icons';

export const STATUS_LABEL: Record<MyStatus, string> = { online: 'В сети', dnd: 'Не беспокоить', invisible: 'Невидимка' };

const DURATIONS: [number, string][] = [
  [15, '15 минут'],
  [60, '1 час'],
  [8 * 60, '8 часов'],
  [24 * 60, '24 часа'],
  [3 * 24 * 60, '3 дня'],
  [0, 'Навсегда'],
];

async function saveStatus(status: MyStatus, text: string, minutes?: number) {
  try {
    const r = await api.setStatus(status, text.trim(), minutes);
    useStore.setState({ myStatus: r.status, myStatusText: r.text, myStatusUntil: r.until });
  } catch (e) {
    showError(e instanceof Error ? e.message : 'Не удалось сменить статус');
  }
}

/** "до 18:30", or with the day when it isn't today. */
function untilText(until: number) {
  const d = new Date(until);
  const time = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === new Date().toDateString()) return `до ${time}`;
  return `до ${d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}, ${time}`;
}

/**
 * Your own card, Discord's: your row at the bottom opens it above the whole bottom panel, flush with its
 * left edge (`anchor`). Photo, your line of status in a bubble, and the two things you come here for:
 * editing the profile and the status, with "do not disturb" and "invisible" for a while or for good.
 */
export function MeCard({ anchor, children, className }: { anchor: RefObject<HTMLElement | null>; children: ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState(false);
  return (
    <>
      <Popover isOpen={open} onOpenChange={setOpen}>
        <Popover.Trigger aria-label="Мой профиль" className={className}>
          {children}
        </Popover.Trigger>
        <Popover.Content triggerRef={anchor} placement="top start" offset={8} className="w-[300px] overflow-hidden p-0">
          <Popover.Dialog aria-label="Мой профиль" className="p-0 outline-none">
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
        <div className="flex flex-col rounded-[12px] bg-white/[0.05] p-1">
          <Row icon={<PencilIcon size={16} />} onPress={onEdit}>
            Редактировать профиль
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
    <button onClick={onPress} className="flex h-10 w-full items-center gap-3 rounded-[8px] px-3 text-left text-[14px] transition-colors hover:bg-white/[0.06]">
      <span className="flex w-4 shrink-0 justify-center text-muted">{icon}</span>
      {children}
    </button>
  );
}

/** Discord's status dots: green, red with a bar, grey ring. */
function StatusDot({ status }: { status: MyStatus }) {
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
  const status = useStore((s) => s.myStatus);
  const until = useStore((s) => s.myStatusUntil);
  const text = useStore((s) => s.myStatusText);

  function choose(next: MyStatus, minutes?: number) {
    void saveStatus(next, text, next === 'online' ? undefined : (minutes ?? 0));
  }

  return (
    <Dropdown>
      <Dropdown.Trigger className="flex h-10 w-full items-center gap-3 rounded-[8px] px-3 text-left text-[14px] outline-none transition-colors hover:bg-white/[0.06] data-[focus-visible=true]:ring-2 data-[focus-visible=true]:ring-focus">
        <span className="flex w-4 shrink-0 justify-center">
          <StatusDot status={status} />
        </span>
        <span className="min-w-0 flex-1 truncate">
          {STATUS_LABEL[status]}
          {until && status !== 'online' && <span className="text-muted"> · {untilText(until)}</span>}
        </span>
        <ChevronRightIcon size={16} className="shrink-0 text-muted" />
      </Dropdown.Trigger>
      <Dropdown.Popover placement="right top" offset={12} className="min-w-64">
        <Dropdown.Menu aria-label="Статус" onAction={(key) => key === 'online' && choose('online')}>
          <Dropdown.Item id="online" textValue="В сети">
            <StatusDot status="online" />
            <Label>В сети</Label>
          </Dropdown.Item>
          <Separator />
          <Timed status="dnd" hint="Без звуков и уведомлений" onPick={choose} />
          <Timed status="invisible" hint="Для остальных — не в сети" onPick={choose} />
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  );
}

function Timed({ status, hint, onPick }: { status: MyStatus; hint: string; onPick: (status: MyStatus, minutes: number) => void }) {
  return (
    <Dropdown.SubmenuTrigger>
      <Dropdown.Item id={status} textValue={STATUS_LABEL[status]}>
        <span className="flex self-start pt-1">
          <StatusDot status={status} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <Label>{STATUS_LABEL[status]}</Label>
          <Description className="text-[12px] text-muted">{hint}</Description>
        </span>
        <Dropdown.SubmenuIndicator />
      </Dropdown.Item>
      <Dropdown.Popover offset={8} className="min-w-44">
        <Dropdown.Menu aria-label={`${STATUS_LABEL[status]}: на сколько`} onAction={(key) => onPick(status, Number(key))}>
          {DURATIONS.map(([minutes, label]) => (
            <Dropdown.Item key={minutes} id={String(minutes)} textValue={label}>
              <Label>{label}</Label>
            </Dropdown.Item>
          ))}
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown.SubmenuTrigger>
  );
}

/** Your line of status next to the photo, as Discord's thought bubble: click to write, Enter to keep. */
function StatusBubble() {
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
    <div className="mb-3 min-w-0 flex-1 rounded-[16px] bg-surface-tertiary px-3 py-2 text-[13px] leading-[18px]">
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
          placeholder="Катаю, сплю, на паре…"
          aria-label="Свой статус"
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
          <span className="line-clamp-2 break-words">{saved || 'Свой статус'}</span>
        </button>
      )}
    </div>
  );
}
