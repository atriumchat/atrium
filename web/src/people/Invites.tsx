import { useEffect, useState } from 'react';
import { Button, Modal } from '@heroui/react';
import { api } from '../api';
import { showError, useStore } from '../store';
import { plural } from '../chat/format';
import { inviteLink, prettyCode } from './invite';
import type { MyInvite } from '../types';
import { Avatar } from '../ui/Avatar';
import { ConfirmDialog } from '../ui/Dialog';
import { Row, RowIcon } from '../ui/settings';
import { CheckIcon, UserPlusIcon, XIcon } from '../ui/icons';

const BANNER_HIDDEN = 'gomex_invite_banner_hidden';

// Your invite, kept between screens so the banner and the window show it at once instead of popping in after
// a request; refetched when someone signs up with it (inviteVersion) or after a reset.
let cached: { invite: MyInvite; version: number } | null = null;

/** Fetch your invite ahead of time, so the banner is there when home first shows. */
export function prefetchInvite() {
  if (cached) return;
  const version = useStore.getState().inviteVersion;
  api.myInvite().then(
    (i) => (cached = { invite: i, version }),
    () => undefined,
  );
}

export function useMyInvite(enabled = true) {
  const version = useStore((s) => s.inviteVersion);
  const [invite, setInvite] = useState<MyInvite | null>(cached?.invite ?? null);
  useEffect(() => {
    if (!enabled) return;
    if (cached && cached.version === version) {
      setInvite(cached.invite);
      return;
    }
    api.myInvite().then(
      (i) => {
        cached = { invite: i, version };
        setInvite(i);
      },
      (e) => (cached ? undefined : showError(e instanceof Error ? e.message : 'Не удалось загрузить приглашение')),
    );
  }, [version, enabled]);
  const replace = (i: MyInvite) => {
    cached = { invite: i, version };
    setInvite(i);
  };
  return [invite, replace] as const;
}

/**
 * "Bring your people" banner at the bottom of the DM list. It lives with people, not next to the channels,
 * so nobody reads it as Discord's "invite to this server": it invites into Gomex itself. Gone once every
 * place on the link is taken, or after it's closed.
 */
export function InviteBanner() {
  const users = useStore((s) => s.users);
  const [open, setOpen] = useState(false);
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem(BANNER_HIDDEN) === '1';
    } catch {
      return false;
    }
  });

  const [invite] = useMyInvite(!hidden);

  const limit = invite?.limit ?? null;
  const left = limit === null ? null : Math.max(0, limit - (invite?.invited.length ?? 0));
  if (hidden || !invite || left === 0) return open ? <InviteDialog onClose={() => setOpen(false)} /> : null;

  function close() {
    setHidden(true);
    try {
      localStorage.setItem(BANNER_HIDDEN, '1');
    } catch {
      // Private mode: it just comes back next time.
    }
  }

  return (
    <div className="relative mb-2 rounded-[24px] bg-default p-4">
      <button
        onClick={close}
        aria-label="Скрыть"
        className="absolute right-2.5 top-2.5 flex h-7 w-7 items-center justify-center rounded-full text-muted hover:bg-white/10 hover:text-foreground"
      >
        <XIcon size={14} />
      </button>
      <div className="pr-6 text-[15px] font-medium">Пригласить друзей</div>
      <p className="mt-0.5 text-[13px] leading-snug text-muted">
        Gomex — только по приглашениям.{' '}
        {left === null ? 'Ссылка без лимита.' : `Осталось ${left} ${plural(left, ['место', 'места', 'мест'])}.`}
      </p>
      <div className="mt-3 flex items-center gap-2">
        <span className="flex min-w-0 flex-1 gap-1 overflow-hidden">
          {invite.invited.slice(0, 5).map((id) => (
            <Avatar key={id} user={users[id]} size={28} ringBg="var(--default)" />
          ))}
          {Array.from({ length: Math.min(left ?? 3, Math.max(0, 5 - invite.invited.length)) }, (_, i) => (
            <span key={i} className="h-7 w-7 shrink-0 rounded-full border border-dashed border-white/25" />
          ))}
        </span>
        <Button onPress={() => setOpen(true)} className="h-9 shrink-0 rounded-full px-4 text-[14px] [--button-bg:white] [--button-bg-hover:#e7e7ea] [--button-fg:#0b0b0c]">
          Пригласить
        </Button>
      </div>
      {open && <InviteDialog onClose={() => setOpen(false)} />}
    </div>
  );
}

/** "Пригласить друзей" as a row of the phone's "Вы" tab: opens the invite window. */
export function InviteRow() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Row
        icon={
          <RowIcon>
            <UserPlusIcon />
          </RowIcon>
        }
        title="Пригласить друзей"
        onPress={() => setOpen(true)}
      />
      {open && <InviteDialog onClose={() => setOpen(false)} />}
    </>
  );
}

/**
 * Your personal invite, laid out like Fluxer's invite window: who it's for on top, the people who already
 * came through it in the middle, and the one link to send at the bottom with its copy button inside.
 */
function InviteDialog({ onClose }: { onClose: () => void }) {
  const users = useStore((s) => s.users);
  const isMobile = useStore((s) => s.isMobile);
  const [invite, setInvite] = useMyInvite();
  const [copied, setCopied] = useState(false);
  const [resetting, setResetting] = useState(false);


  const link = invite ? inviteLink(invite.code) : '';
  const used = invite?.invited.length ?? 0;
  const limit = invite?.limit ?? null;
  const left = limit === null ? null : Math.max(0, limit - used);
  const full = left === 0;

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      showError('Не удалось скопировать ссылку');
    }
  }

  async function shareOrCopy() {
    // On a phone, the system share sheet (Telegram, WhatsApp, …); on a computer, just copy.
    if (isMobile && navigator.share) {
      try {
        await navigator.share({ title: 'Gomex', text: 'Залетай в Gomex — это моё приглашение', url: link });
      } catch {
        // Closed the sheet: nothing to do.
      }
    } else {
      await copy();
    }
  }

  return (
    <Modal.Backdrop isOpen onOpenChange={(open) => !open && onClose()}>
      <Modal.Container size={isMobile ? 'full' : 'sm'} placement={isMobile ? 'top' : 'center'}>
        <Modal.Dialog aria-label="Пригласить друзей" className="max-w-[440px] p-0 max-md:max-w-none max-md:pt-[env(safe-area-inset-top)]">
          <Modal.CloseTrigger className="z-10 max-md:top-[max(16px,env(safe-area-inset-top))]" />

          <div className="px-6 pr-14 pt-6">
            <h2 className="text-[20px] font-medium leading-7">Пригласить друзей</h2>
            <p className="mt-1 text-[14px] leading-snug text-muted">
              {limit === null
                ? 'Gomex — только по приглашениям. Ссылка админа без лимита.'
                : `Gomex — только по приглашениям. По ссылке зарегистрируются ${limit} ${plural(limit, ['человек', 'человека', 'человек'])} и сразу попадут в друзья.`}
            </p>
          </div>

          <div className="px-6 pt-5">
            <div className="flex items-center justify-between pb-1">
              <span className="text-[12px] text-faint">Пришли по ссылке</span>
              {invite && limit !== null && (
                <span className="text-[12px] tabular-nums text-faint">
                  {used} из {limit}
                </span>
              )}
            </div>
            {!invite ? (
              <p className="py-8 text-center text-[14px] text-muted">Загружаем…</p>
            ) : used === 0 ? (
              <div className="flex items-center gap-3 py-3">
                <EmptySeats count={Math.min(left ?? 3, 5)} />
                <span className="text-[14px] text-muted">Пока никто не пришёл</span>
              </div>
            ) : (
              <ul className="-mx-2 max-h-[240px] overflow-y-auto">
                {invite.invited.map((id) => (
                  <li key={id} className="flex h-12 items-center gap-3 rounded-full px-2">
                    <Avatar user={users[id]} size={32} ringBg="var(--overlay)" />
                    <span className="min-w-0 flex-1 truncate text-[15px]">{users[id]?.name ?? '…'}</span>
                    <span className="text-[13px] text-faint">в друзьях</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="px-6 pb-6 pt-5 max-md:pb-[max(24px,env(safe-area-inset-bottom))]">
            <div className="pb-2 text-[14px] text-muted">Ссылка-приглашение</div>
            <div className="flex h-12 items-center gap-2 rounded-full bg-surface-tertiary pl-4 pr-1.5">
              <span className={`min-w-0 flex-1 truncate text-[14px] ${full ? 'text-faint' : ''}`}>{link.replace(/^https?:\/\//, '')}</span>
              <Button
                isDisabled={!invite || full}
                onPress={shareOrCopy}
                className="h-9 shrink-0 rounded-full px-4 text-[14px] [--button-bg:white] [--button-bg-hover:#e7e7ea] [--button-fg:#0b0b0c]"
              >
                {copied && <CheckIcon size={16} strokeWidth={2.5} />}
                {copied ? 'Скопировано' : isMobile ? 'Поделиться' : 'Скопировать'}
              </Button>
            </div>
            {invite && (
              <p className="mt-2 px-1 text-[12px] leading-5 text-faint">
                {full ? `Все ${limit} ${plural(limit ?? 0, ['место занято', 'места заняты', 'мест заняты'])}. ` : left !== null ? `Осталось ${left} ${plural(left, ['место', 'места', 'мест'])}. ` : ''}
                Код для входа: <span className="font-mono text-muted">{prettyCode(invite.code)}</span> ·{' '}
                <button onClick={() => setResetting(true)} className="text-muted hover:text-foreground hover:underline">
                  Сбросить ссылку
                </button>
              </p>
            )}
          </div>
        </Modal.Dialog>
      </Modal.Container>
      {resetting && (
        <ConfirmDialog
          title="Сбросить ссылку?"
          text="Старая перестанет работать, а уже приглашённые останутся."
          confirmLabel="Сбросить"
          onConfirm={async () => setInvite(await api.resetInvite())}
          onClose={() => setResetting(false)}
        />
      )}
    </Modal.Backdrop>
  );
}

/** Empty places as faint circles, so it's clear how many people the link still lets in. */
function EmptySeats({ count }: { count: number }) {
  return (
    <span className="flex gap-1">
      {Array.from({ length: count }, (_, i) => (
        <span key={i} className="h-8 w-8 rounded-full border border-dashed border-white/20" />
      ))}
    </span>
  );
}
