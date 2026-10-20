import { useRef, useState, type ReactNode } from 'react';
import { Button, Dropdown, Label, Popover } from '@heroui/react';
import { api } from '../api';
import { messageUser, showError, useStore } from '../store';
import type { MyStatus, User } from '../types';
import { Avatar } from '../ui/Avatar';
import { ConfirmDialog } from '../ui/Dialog';
import { ResetLinkButton } from './ResetLink';
import { useT, type Key } from '../i18n';
import { dateOnly } from '../chat/format';
import { BubbleIcon, CameraIcon, CheckIcon, PencilIcon, PhoneIcon, UserPlusIcon } from '../ui/icons';
import { joinVoice } from '../voice/voice';

type Placement = 'top' | 'bottom' | 'left' | 'right' | 'right top' | 'left top' | 'top start' | 'bottom start';

/** Wrap any avatar or name: clicking it opens the person's profile card. */
export function UserProfile(props: { userId: string; children: ReactNode; placement?: Placement; className?: string }) {
  const [open, setOpen] = useState(false);
  const { t } = useT();
  const name = useStore((s) => s.users[props.userId]?.name ?? '');
  return (
    <Popover isOpen={open} onOpenChange={setOpen}>
      <Popover.Trigger aria-label={t('people.profile.label', { name })} className={props.className ?? 'cursor-pointer'}>
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
  const { t } = useT();
  const user = useStore((s) => s.users[userId]);
  const inviter = useStore((s) => (s.users[userId]?.invitedBy ? s.users[s.users[userId].invitedBy!] : undefined));
  const isMe = useStore((s) => s.me?.id === userId);
  const online = useStore((s) => s.online.includes(userId));
  const isAdmin = useStore((s) => s.isAdmin);
  const room = useStore((s) => {
    const entry = s.voiceState.find((v) => v.userId === userId);
    return entry ? s.channels.find((c) => c.id === entry.channelId)?.name : undefined;
  });
  const blocked = useStore((s) => s.blocked.includes(userId));
  if (!user) return null;

  if (isMe) {
    return (
      <div>
        {/* The banner is your own photo, blurred down to a mood; graphite when there's no photo. */}
        <div className="relative h-20 overflow-hidden bg-surface-tertiary">
          {user.avatarUrl && <img src={user.avatarUrl} alt="" className="h-full w-full scale-150 object-cover opacity-70 blur-2xl" />}
        </div>
        <div className="px-5 pb-5">
          <div className="-mt-11">
            <AvatarPicker />
          </div>
          <h2 className="mt-2 text-[20px] font-bold leading-7">{user.name}</h2>
          <StatusPicker />
          <div className="my-3 h-px bg-separator" />
          <h3 className="text-[12px] text-faint">{t('people.profile.about')}</h3>
          <BioEditor initial={user.bio} />
          <h3 className="mt-3 text-[12px] text-faint">{t('people.profile.since')}</h3>
          <p className="mt-1 text-[14px]">{dateOnly(user.createdAt, { day: 'numeric', month: 'long', year: 'numeric' })}</p>
        </div>
      </div>
    );
  }

  const presence = room ? t('people.profile.inRoom', { room }) : online ? (user.status === 'dnd' ? t('people.profile.dnd') : t('people.profile.online')) : t('people.profile.offline');
  const dot = room || (online && user.status !== 'dnd') ? 'bg-success' : online ? 'bg-danger' : 'bg-faint';
  // Someone else's card, top to bottom (as in the native app): who they are and where they are now; what you can
  // do as three equal tiles; what there is to know about them in one group; blocking apart at the foot.
  return (
    <div className="pb-4">
      <div className="relative h-24 overflow-hidden bg-surface-tertiary">
        {user.avatarUrl && <img src={user.avatarUrl} alt="" className="h-full w-full scale-150 object-cover opacity-70 blur-2xl" />}
      </div>
      <div className="flex flex-col items-center px-5">
        <div className="-mt-12 w-fit rounded-full bg-overlay p-1.5">
          <Avatar user={user} size={88} ringBg="var(--overlay)" />
        </div>
        <h2 className="mt-1.5 max-w-full truncate text-[22px] font-bold leading-7">{user.name}</h2>
        <p className={`mt-0.5 flex items-center gap-1.5 text-[14px] ${room ? 'text-success' : 'text-muted'}`}>
          <span className={`size-2 rounded-full ${dot}`} />
          {presence}
        </p>
        {user.statusText && <p className="mt-1.5 text-center text-[15px] leading-5">{user.statusText}</p>}
      </div>

      <div className="mt-4 flex flex-col gap-3 px-3">
        <div className="flex gap-2">
          <Tile label={t('people.friends.message')} disabled={blocked} onPress={() => { onClose(); void messageUser(userId); }}>
            <BubbleIcon size={21} />
          </Tile>
          <Tile label={t('voice.call.start')} disabled={blocked} onPress={async () => { onClose(); const dm = await messageUser(userId); if (dm) void joinVoice(dm.id); }}>
            <PhoneIcon size={21} />
          </Tile>
          <FriendTile userId={userId} name={user.name} disabled={blocked} />
        </div>

        <div className="overflow-hidden rounded-[18px] bg-default">
          <Fact label={t('people.profile.about')}>
            <span className={`whitespace-pre-wrap break-words ${user.bio ? '' : 'text-muted'}`}>{user.bio || t('people.profile.noBio')}</span>
          </Fact>
          <div className="ml-4 h-px bg-white/[0.08]" />
          <Fact label={t('people.profile.since')}>{dateOnly(user.createdAt, { day: 'numeric', month: 'long', year: 'numeric' })}</Fact>
          {inviter && (
            <>
              <div className="ml-4 h-px bg-white/[0.08]" />
              <Fact label={t('people.profile.invitedBy')}>
                <span className="flex items-center gap-2">
                  <Avatar user={inviter} size={22} ringBg="var(--default)" />
                  <span className="truncate">{inviter.name}</span>
                </span>
              </Fact>
            </>
          )}
        </div>

        <div className="overflow-hidden rounded-[18px] bg-default">
          <BlockButton userId={userId} name={user.name} />
        </div>
        {isAdmin && <ResetLinkButton userId={userId} name={user.name} />}
      </div>
    </div>
  );
}

/** A fact about them: its name small and grey, the fact under it, as in Contacts. */
function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="px-4 py-2.5">
      <div className="text-[13px] text-muted">{label}</div>
      <div className="mt-0.5 text-[15px] leading-5">{children}</div>
    </div>
  );
}

/** One of the three actions under the name: an icon over its word, all three the same size. */
function Tile({ label, onPress, children, disabled, accent, busy }: { label: string; onPress: () => void; children: ReactNode; disabled?: boolean; accent?: boolean; busy?: boolean }) {
  return (
    <button
      type="button"
      onClick={onPress}
      disabled={disabled || busy}
      className={`flex h-16 min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-2xl transition-[background-color,transform,opacity] duration-150 active:scale-[0.97] disabled:opacity-40 ${accent ? 'bg-white text-black hover:bg-[#e7e7ea]' : 'bg-default hover:bg-[#28282d]'}`}
    >
      {children}
      <span className="max-w-full truncate px-1 text-[13px] font-medium">{label}</span>
    </button>
  );
}

/**
 * The friendship as a tile: "Add", "Accept" (white: it's waiting for you), or what already is — "Friends",
 * "Requested" — where undoing it asks first instead of happening on a stray click.
 */
function FriendTile({ userId, name, disabled }: { userId: string; name: string; disabled?: boolean }) {
  const { t } = useT();
  const status = useStore((s) => s.friends.find((f) => f.userId === userId)?.status);
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    try {
      useStore.setState({ friends: (await action()) as never });
    } catch (e) {
      showError(e instanceof Error ? e.message : t('people.failed'));
    } finally {
      setBusy(false);
    }
  }
  const undo = status === 'friend' || status === 'outgoing';
  return (
    <>
      {status === 'incoming' ? (
        <Tile label={t('people.friends.accept')} accent busy={busy} disabled={disabled} onPress={() => void run(() => api.acceptFriend(userId))}>
          <CheckIcon size={21} />
        </Tile>
      ) : status === 'friend' ? (
        <Tile label={t('people.profile.isFriend')} busy={busy} disabled={disabled} onPress={() => setAsking(true)}>
          <CheckIcon size={21} />
        </Tile>
      ) : status === 'outgoing' ? (
        <Tile label={t('people.profile.requested')} busy={busy} disabled={disabled} onPress={() => setAsking(true)}>
          <UserPlusIcon size={21} />
        </Tile>
      ) : (
        <Tile label={t('people.profile.add')} busy={busy} disabled={disabled} onPress={() => void run(() => api.addFriend(name))}>
          <UserPlusIcon size={21} />
        </Tile>
      )}
      {asking && undo && (
        <ConfirmDialog
          title={status === 'friend' ? t('people.profile.removeFriendTitle', { name }) : t('people.profile.cancelRequestTitle', { name })}
          text=""
          confirmLabel={status === 'friend' ? t('people.profile.removeFriend') : t('people.friends.cancelRequest')}
          onConfirm={() => run(() => api.removeFriend(userId))}
          onClose={() => setAsking(false)}
        />
      )}
    </>
  );
}

const STATUSES: { id: MyStatus; label: Key }[] = [
  { id: 'online', label: 'people.profile.online' },
  { id: 'dnd', label: 'people.profile.dnd' },
  { id: 'invisible', label: 'people.profile.invisible' },
];

/** Your status: online, do not disturb (no sounds or notifications), invisible (you look offline), plus a line. */
function StatusPicker() {
  const { t } = useT();
  const status = useStore((s) => s.myStatus);
  const saved = useStore((s) => s.myStatusText);
  const [text, setText] = useState(saved);

  async function save(next: MyStatus, nextText = text) {
    try {
      const r = await api.setStatus(next, nextText.trim());
      useStore.setState({ myStatus: r.status, myStatusText: r.text });
    } catch (e) {
      showError(e instanceof Error ? e.message : t('people.profile.statusFailed'));
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
            {t(o.label)}
          </button>
        ))}
      </div>
      <input
        value={text}
        maxLength={64}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => text.trim() !== saved && save(status)}
        onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
        placeholder={t('people.profile.statusPlaceholder')}
        aria-label={t('people.profile.statusLabel')}
        className="mt-2 h-10 w-full rounded-full bg-surface-tertiary px-4 text-[14px] outline-none placeholder:text-faint focus:ring-2 focus:ring-focus"
      />
      {status === 'dnd' && <p className="mt-1.5 px-1 text-[12px] text-faint">{t('people.profile.dndNote')}</p>}
      {status === 'invisible' && <p className="mt-1.5 px-1 text-[12px] text-faint">{t('people.profile.invisibleNote')}</p>}
    </div>
  );
}

/** Block or unblock: no DMs or calls between you, no friend requests, their messages folded away. */
function BlockButton({ userId, name }: { userId: string; name: string }) {
  const { t } = useT();
  const blocked = useStore((s) => s.blocked.includes(userId));
  const [asking, setAsking] = useState(false);

  async function run(action: () => Promise<string[]>) {
    try {
      useStore.setState({ blocked: await action() });
    } catch (e) {
      showError(e instanceof Error ? e.message : t('people.failed'));
    }
  }

  return (
    <>
      <button
        onClick={() => (blocked ? run(() => api.unblock(userId)) : setAsking(true))}
        className={`w-full px-4 py-3 text-left text-[15px] transition-colors hover:bg-white/[0.06] ${blocked ? 'text-foreground' : 'text-danger'}`}
      >
        {blocked ? t('people.profile.unblock') : t('people.profile.block')}
      </button>
      {asking && (
        <ConfirmDialog
          title={t('people.profile.blockTitle', { name })}
          text={t('people.profile.blockText')}
          confirmLabel={t('people.profile.block')}
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
export function AvatarPicker({ size = 80 }: { size?: number }) {
  const { t } = useT();
  const me = useStore((s) => s.me);
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function upload(file: File | undefined) {
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) return showError(t('people.profile.imageTooBig'));
    setBusy(true);
    try {
      applyMe(await api.uploadAvatar(file));
    } catch (e) {
      showError(e instanceof Error ? e.message : t('people.profile.uploadFailed'));
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
      showError(e instanceof Error ? e.message : t('people.profile.removeFailed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative w-fit rounded-full bg-overlay p-1.5">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        aria-label={t('people.profile.uploadPhoto')}
        className="group relative block rounded-full outline-none focus-visible:ring-2 focus-visible:ring-focus"
      >
        <Avatar user={me ?? undefined} size={size} ringBg="var(--overlay)" />
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
          aria-label={t('people.profile.photo')}
          className="absolute bottom-1.5 right-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-default text-foreground outline-none ring-[3px] ring-[var(--overlay)] transition-colors hover:bg-default/80 data-[focus-visible=true]:ring-focus"
        >
          <PencilIcon size={14} strokeWidth={2.2} />
        </Dropdown.Trigger>
        <Dropdown.Popover placement="bottom start" className="min-w-48">
          <Dropdown.Menu aria-label={t('people.profile.photo')} onAction={(key) => (key === 'remove' ? remove() : inputRef.current?.click())}>
            <Dropdown.Item id="upload" textValue={t('people.profile.uploadPhoto')}>
              <Label>{t('people.profile.uploadPhoto')}</Label>
            </Dropdown.Item>
            {me?.avatarUrl ? (
              <Dropdown.Item id="remove" textValue={t('people.profile.removePhoto')} variant="danger">
                <Label>{t('people.profile.removePhoto')}</Label>
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

export function BioEditor({ initial, className }: { initial: string; className?: string }) {
  const { t } = useT();
  const [bio, setBio] = useState(initial);
  const [saving, setSaving] = useState(false);
  const changed = bio.trim() !== initial;

  async function save() {
    setSaving(true);
    try {
      const me = await api.updateMe(bio);
      useStore.setState((s) => ({ me, users: { ...s.users, [me.id]: me } }));
    } catch (e) {
      showError(e instanceof Error ? e.message : t('people.profile.saveFailed'));
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
        placeholder={t('people.profile.bioPlaceholder')}
        aria-label={t('people.profile.about')}
        className={className ?? 'w-full resize-none rounded-[18px] bg-surface-tertiary px-4 py-2.5 text-[14px] outline-none placeholder:text-faint focus:ring-2 focus:ring-focus'}
      />
      {changed && (
        <Button size="sm" isPending={saving} onPress={save} className="mt-1.5 rounded-full">
          {t('people.profile.save')}
        </Button>
      )}
    </div>
  );
}

/** Add / accept / cancel / remove, depending on the current relationship. */
export function FriendButton({ userId, name }: { userId: string; name: string }) {
  const { t } = useT();
  const status = useStore((s) => s.friends.find((f) => f.userId === userId)?.status);
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    try {
      useStore.setState({ friends: (await action()) as never });
    } catch (e) {
      showError(e instanceof Error ? e.message : t('people.failed'));
    } finally {
      setBusy(false);
    }
  }

  const common = { size: 'sm' as const, isPending: busy, className: 'flex-1 rounded-full' };
  if (status === 'friend') {
    return (
      <Button {...common} variant="tertiary" onPress={() => run(() => api.removeFriend(userId))}>
        {t('people.profile.removeFriend')}
      </Button>
    );
  }
  if (status === 'incoming') {
    return (
      <Button {...common} onPress={() => run(() => api.acceptFriend(userId))}>
        {t('people.profile.acceptRequest')}
      </Button>
    );
  }
  if (status === 'outgoing') {
    return (
      <Button {...common} variant="tertiary" onPress={() => run(() => api.removeFriend(userId))}>
        {t('people.friends.cancelRequest')}
      </Button>
    );
  }
  return (
    <Button {...common} variant="tertiary" onPress={() => run(() => api.addFriend(name))}>
      {t('people.friends.add')}
    </Button>
  );
}
