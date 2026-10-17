import { useRef, useState, type ReactNode } from 'react';
import { Button, Dropdown, Label, Popover } from '@heroui/react';
import { api } from '../api';
import { messageUser, showError, useStore } from '../store';
import type { MyStatus, User } from '../types';
import { Avatar } from '../ui/Avatar';
import { ConfirmDialog } from '../ui/Dialog';
import { CameraIcon, PencilIcon } from '../ui/icons';

type Placement = 'top' | 'bottom' | 'left' | 'right' | 'right top' | 'left top' | 'top start' | 'bottom start';

/** Wrap any avatar or name: clicking it opens the person's profile card. */
export function UserProfile(props: { userId: string; children: ReactNode; placement?: Placement; className?: string }) {
  const [open, setOpen] = useState(false);
  const name = useStore((s) => s.users[props.userId]?.name ?? '');
  return (
    <Popover isOpen={open} onOpenChange={setOpen}>
      <Popover.Trigger aria-label={`Профиль: ${name}`} className={props.className ?? 'cursor-pointer'}>
        {props.children}
      </Popover.Trigger>
      <Popover.Content placement={props.placement ?? 'right top'} className="w-80 overflow-hidden p-0">
        <Popover.Dialog className="p-0 outline-none">
          <ProfileCard userId={props.userId} onClose={() => setOpen(false)} />
        </Popover.Dialog>
      </Popover.Content>
    </Popover>
  );
}

export function ProfileCard({ userId, onClose }: { userId: string; onClose: () => void }) {
  const user = useStore((s) => s.users[userId]);
  const inviter = useStore((s) => (s.users[userId]?.invitedBy ? s.users[s.users[userId].invitedBy!] : undefined));
  const isMe = useStore((s) => s.me?.id === userId);
  const online = useStore((s) => s.online.includes(userId));
  const room = useStore((s) => {
    const entry = s.voiceState.find((v) => v.userId === userId);
    return entry ? s.channels.find((c) => c.id === entry.channelId)?.name : undefined;
  });
  if (!user) return null;

  return (
    <div>
      {/* The banner is their own photo, blurred down to a mood; graphite when there's no photo. */}
      <div className="relative h-20 overflow-hidden bg-surface-tertiary">
        {user.avatarUrl && <img src={user.avatarUrl} alt="" className="h-full w-full scale-150 object-cover opacity-70 blur-2xl" />}
      </div>
      <div className="px-5 pb-5">
        <div className="-mt-11">
          {isMe ? (
            <AvatarPicker />
          ) : (
            <div className="w-fit rounded-full bg-overlay p-1.5">
              <Avatar user={user} size={80} online={online} ringBg="var(--overlay)" />
            </div>
          )}
        </div>
        <h2 className="mt-2 text-[20px] font-bold leading-7">{user.name}</h2>
        <p className="text-[13px] text-muted">
          {room ? (
            <span className="text-success">В комнате «{room}»</span>
          ) : online ? (
            user.status === 'dnd' ? 'Не беспокоить' : 'В сети'
          ) : (
            'Не в сети'
          )}
        </p>
        {!isMe && user.statusText && <p className="mt-1 text-[14px]">{user.statusText}</p>}
        {isMe && <StatusPicker />}

        <div className="my-3 h-px bg-separator" />

        <h3 className="text-[12px] text-faint">О себе</h3>
        {isMe ? (
          <BioEditor initial={user.bio} />
        ) : (
          <p className="mt-1 whitespace-pre-wrap break-words text-[14px]">{user.bio || <span className="text-muted">Пока ничего не написал</span>}</p>
        )}

        <h3 className="mt-3 text-[12px] text-faint">На сервере с</h3>
        <p className="mt-1 text-[14px]">{new Date(user.createdAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}</p>

        {inviter && (
          <>
            <h3 className="mt-3 text-[12px] text-faint">Пригласил(а)</h3>
            <p className="mt-1 text-[14px]">{inviter.name}</p>
          </>
        )}

        {!isMe && (
          <div className="mt-4 flex gap-2">
            <Button
              size="sm"
              className="flex-1 rounded-full"
              onPress={() => {
                onClose();
                messageUser(userId);
              }}
            >
              Написать
            </Button>
            <FriendButton userId={userId} name={user.name} />
          </div>
        )}
        {!isMe && <BlockButton userId={userId} name={user.name} />}
      </div>
    </div>
  );
}

const STATUSES: { id: MyStatus; label: string }[] = [
  { id: 'online', label: 'В сети' },
  { id: 'dnd', label: 'Не беспокоить' },
  { id: 'invisible', label: 'Невидимка' },
];

/** Your status: online, do not disturb (no sounds or notifications), invisible (you look offline), plus a line. */
function StatusPicker() {
  const status = useStore((s) => s.myStatus);
  const saved = useStore((s) => s.myStatusText);
  const [text, setText] = useState(saved);

  async function save(next: MyStatus, nextText = text) {
    try {
      const r = await api.setStatus(next, nextText.trim());
      useStore.setState({ myStatus: r.status, myStatusText: r.text });
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Не удалось сменить статус');
    }
  }

  return (
    <div className="mt-3">
      <div className="flex gap-1 rounded-full bg-surface-tertiary p-1">
        {STATUSES.map((o) => (
          <button
            key={o.id}
            onClick={() => save(o.id)}
            aria-pressed={status === o.id}
            className={`h-8 flex-auto whitespace-nowrap rounded-full px-2 text-[12px] font-medium transition-colors ${status === o.id ? 'bg-white text-black' : 'text-muted hover:text-foreground'}`}
          >
            {o.label}
          </button>
        ))}
      </div>
      <input
        value={text}
        maxLength={64}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => text.trim() !== saved && save(status)}
        onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
        placeholder="Свой статус: катаю, сплю, на паре…"
        aria-label="Свой статус"
        className="mt-2 h-10 w-full rounded-full bg-surface-tertiary px-4 text-[14px] outline-none placeholder:text-faint focus:ring-2 focus:ring-focus"
      />
      {status === 'dnd' && <p className="mt-1.5 px-1 text-[12px] text-faint">Звуки и уведомления о сообщениях выключены.</p>}
      {status === 'invisible' && <p className="mt-1.5 px-1 text-[12px] text-faint">Для остальных — не в сети</p>}
    </div>
  );
}

/** Block or unblock: no DMs or calls between you, no friend requests, their messages folded away. */
function BlockButton({ userId, name }: { userId: string; name: string }) {
  const blocked = useStore((s) => s.blocked.includes(userId));
  const [asking, setAsking] = useState(false);

  async function run(action: () => Promise<string[]>) {
    try {
      useStore.setState({ blocked: await action() });
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Не получилось');
    }
  }

  return (
    <>
      <button
        onClick={() => (blocked ? run(() => api.unblock(userId)) : setAsking(true))}
        className={`mt-2 w-full rounded-full py-2 text-[13px] transition-colors hover:bg-white/[0.06] ${blocked ? 'text-muted' : 'text-danger'}`}
      >
        {blocked ? 'Разблокировать' : 'Заблокировать'}
      </button>
      {asking && (
        <ConfirmDialog
          title={`Заблокировать ${name}?`}
          text="Вы перестанете быть друзьями, личка и звонки между вами закроются, а его сообщения на сервере свернутся."
          confirmLabel="Заблокировать"
          onConfirm={() => run(() => api.block(userId))}
          onClose={() => setAsking(false)}
        />
      )}
    </>
  );
}

function applyMe(me: User) {
  useStore.setState((s) => ({ me, users: { ...s.users, [me.id]: me } }));
}

/** Your own avatar in the card: click to pick a picture, with a remove option once one is set. */
export function AvatarPicker() {
  const me = useStore((s) => s.me);
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function upload(file: File | undefined) {
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) return showError('Картинка больше 8 МБ');
    setBusy(true);
    try {
      applyMe(await api.uploadAvatar(file));
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Не удалось загрузить аватар');
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  async function remove() {
    setBusy(true);
    try {
      applyMe(await api.deleteAvatar());
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Не удалось удалить аватар');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative w-fit rounded-full bg-overlay p-1.5">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        aria-label="Загрузить фото"
        className="group relative block rounded-full outline-none focus-visible:ring-2 focus-visible:ring-focus"
      >
        <Avatar user={me ?? undefined} size={80} ringBg="var(--overlay)" />
        <span
          className={`absolute inset-0 flex items-center justify-center rounded-full bg-black/50 text-white transition-opacity ${
            busy ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100'
          }`}
        >
          {busy ? <span className="h-5 w-5 animate-spin rounded-full border-2 border-white/40 border-t-white" /> : <CameraIcon size={24} />}
        </span>
      </button>
      {/* iOS contact-photo style edit badge: upload or remove. */}
      <Dropdown>
        <Dropdown.Trigger
          aria-label="Фото профиля"
          className="absolute bottom-1.5 right-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-default text-foreground outline-none ring-[3px] ring-[var(--overlay)] transition-colors hover:bg-default/80 data-[focus-visible=true]:ring-focus"
        >
          <PencilIcon size={14} strokeWidth={2.2} />
        </Dropdown.Trigger>
        <Dropdown.Popover placement="bottom start" className="min-w-48">
          <Dropdown.Menu aria-label="Фото профиля" onAction={(key) => (key === 'remove' ? remove() : inputRef.current?.click())}>
            <Dropdown.Item id="upload" textValue="Загрузить фото">
              <Label>Загрузить фото</Label>
            </Dropdown.Item>
            {me?.avatarUrl ? (
              <Dropdown.Item id="remove" textValue="Удалить фото" variant="danger">
                <Label>Удалить фото</Label>
              </Dropdown.Item>
            ) : null}
          </Dropdown.Menu>
        </Dropdown.Popover>
      </Dropdown>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="hidden"
        onChange={(e) => upload(e.target.files?.[0])}
      />
    </div>
  );
}

export function BioEditor({ initial }: { initial: string }) {
  const [bio, setBio] = useState(initial);
  const [saving, setSaving] = useState(false);
  const changed = bio.trim() !== initial;

  async function save() {
    setSaving(true);
    try {
      const me = await api.updateMe(bio);
      useStore.setState((s) => ({ me, users: { ...s.users, [me.id]: me } }));
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Не удалось сохранить');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-1.5">
      <textarea
        value={bio}
        onChange={(e) => setBio(e.target.value)}
        maxLength={190}
        rows={3}
        placeholder="О себе: игры, когда онлайн"
        aria-label="О себе"
        className="w-full resize-none rounded-[18px] bg-surface-tertiary px-4 py-2.5 text-[14px] outline-none placeholder:text-faint focus:ring-2 focus:ring-focus"
      />
      {changed && (
        <Button size="sm" isPending={saving} onPress={save} className="mt-1.5 rounded-full">
          Сохранить
        </Button>
      )}
    </div>
  );
}

/** Add / accept / cancel / remove, depending on the current relationship. */
export function FriendButton({ userId, name }: { userId: string; name: string }) {
  const status = useStore((s) => s.friends.find((f) => f.userId === userId)?.status);
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    try {
      useStore.setState({ friends: (await action()) as never });
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Не получилось');
    } finally {
      setBusy(false);
    }
  }

  const common = { size: 'sm' as const, isPending: busy, className: 'flex-1 rounded-full' };
  if (status === 'friend') {
    return (
      <Button {...common} variant="tertiary" onPress={() => run(() => api.removeFriend(userId))}>
        Удалить из друзей
      </Button>
    );
  }
  if (status === 'incoming') {
    return (
      <Button {...common} onPress={() => run(() => api.acceptFriend(userId))}>
        Принять заявку
      </Button>
    );
  }
  if (status === 'outgoing') {
    return (
      <Button {...common} variant="tertiary" onPress={() => run(() => api.removeFriend(userId))}>
        Отменить заявку
      </Button>
    );
  }
  return (
    <Button {...common} variant="tertiary" onPress={() => run(() => api.addFriend(name))}>
      Добавить в друзья
    </Button>
  );
}
