import { useEffect, useState } from 'react';
import { Button } from '@heroui/react';
import { api } from '../api';
import { showError, useStore } from '../store';
import { useT } from '../i18n';
import { inviteLink, prettyCode } from './invite';
import type { MyInvite } from '../types';
import { Avatar } from '../ui/Avatar';
import { ConfirmDialog, Window } from '../ui/Dialog';
import { Row, RowIcon } from '../ui/settings';
import { CopyButton } from '../ui/CopyButton';
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
  const { t } = useT();
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
      (e) => (cached ? undefined : showError(e instanceof Error ? e.message : t('people.invite.loadFailed'))),
    );
  }, [version, enabled, t]);
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
  const { t } = useT();
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
        aria-label={t('people.invite.hide')}
        className="absolute right-2.5 top-2.5 flex h-7 w-7 items-center justify-center rounded-full text-muted hover:bg-white/10 hover:text-foreground"
      >
        <XIcon size={14} />
      </button>
      <div className="pr-6 text-[15px] font-medium">{t('people.invite.title')}</div>
      <p className="mt-0.5 text-[13px] leading-snug text-muted">
        {left === null ? t('people.invite.bannerNoLimit') : t('people.invite.bannerLeft', { n: left })}
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
          {t('people.invite.button')}
        </Button>
      </div>
      {open && <InviteDialog onClose={() => setOpen(false)} />}
    </div>
  );
}

/** "Invite friends" as a row of the phone's "You" tab: opens the invite window. */
export function InviteRow() {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Row
        icon={
          <RowIcon>
            <UserPlusIcon />
          </RowIcon>
        }
        title={t('people.invite.title')}
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
  const { t } = useT();
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
      showError(t('people.invite.copyFailed'));
    }
  }

  async function shareOrCopy() {
    // On a phone, the system share sheet (Telegram, WhatsApp, …); on a computer, just copy.
    if (isMobile && navigator.share) {
      try {
        await navigator.share({ title: 'Gomex', text: t('people.invite.shareText'), url: link });
      } catch {
        // Closed the sheet: nothing to do.
      }
    } else {
      await copy();
    }
  }

  return (
    // On the phone the link sits at the sheet's foot, under the thumb.
    <Window
      label={t('people.invite.title')}
      onClose={onClose}
      className="max-w-[440px] p-0"
      footer={
        <div className="px-6 pb-6 pt-5">
          <div className="pb-2 text-[14px] text-muted">{t('people.invite.link')}</div>
          <div className="flex h-12 items-center gap-2 rounded-full bg-surface-tertiary pl-4 pr-1.5">
            <span className={`min-w-0 flex-1 truncate text-[14px] ${full ? 'text-faint' : ''}`}>{link.replace(/^https?:\/\//, '')}</span>
            {/* On the computer copying is an icon in the field; on the phone the share sheet is the way, a button. */}
            {isMobile ? (
              <Button
                isDisabled={!invite || full}
                onPress={shareOrCopy}
                className="h-9 shrink-0 rounded-full px-4 text-[14px] [--button-bg:white] [--button-bg-hover:#e7e7ea] [--button-fg:#0b0b0c]"
              >
                {copied && <CheckIcon size={16} strokeWidth={2.5} />}
                {copied ? t('people.invite.copied') : t('people.invite.share')}
              </Button>
            ) : (
              <CopyButton text={invite && !full ? link : ''} />
            )}
          </div>
          {invite && (
            <p className="mt-2 px-1 text-[12px] leading-5 text-faint">
              {full ? t('people.invite.taken', { n: limit ?? 0 }) : left !== null ? t('people.invite.left', { n: left }) : ''}
              {t('people.invite.code')} <span className="font-mono text-muted">{prettyCode(invite.code)}</span> ·{' '}
              <button onClick={() => setResetting(true)} className="text-muted hover:text-foreground hover:underline">
                {t('people.invite.reset')}
              </button>
            </p>
          )}
        </div>
      }
    >
      <div className="px-6 pr-14 pt-6 max-md:pt-3">
        <h2 className="text-[20px] font-medium leading-7">{t('people.invite.title')}</h2>
        <p className="mt-1 text-[14px] leading-snug text-muted">
          {limit === null ? t('people.invite.descNoLimit') : t('people.invite.desc', { n: limit })}
        </p>
      </div>

      <div className="px-6 pt-5">
        <div className="flex items-center justify-between pb-1">
          <span className="text-[12px] text-faint">{t('people.invite.joined')}</span>
          {invite && limit !== null && (
            <span className="text-[12px] tabular-nums text-faint">
              {t('people.invite.usedOf', { used, limit })}
            </span>
          )}
        </div>
        {!invite ? (
          <p className="py-8 text-center text-[14px] text-muted">{t('people.inbox.loading')}</p>
        ) : used === 0 ? (
          <div className="flex items-center gap-3 py-3">
            <EmptySeats count={Math.min(left ?? 3, 5)} />
            <span className="text-[14px] text-muted">{t('people.invite.nobody')}</span>
          </div>
        ) : (
          // The sheet scrolls as a whole on the phone; the window keeps the list short on the computer.
          <ul className="-mx-2 md:max-h-[240px] md:overflow-y-auto">
            {invite.invited.map((id) => (
              <li key={id} className="flex h-12 items-center gap-3 rounded-full px-2">
                <Avatar user={users[id]} size={32} ringBg="var(--overlay)" />
                <span className="min-w-0 flex-1 truncate text-[15px]">{users[id]?.name ?? '…'}</span>
                <span className="text-[13px] text-faint">{t('people.invite.friendsTag')}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      {resetting && (
        <ConfirmDialog
          title={t('people.invite.resetTitle')}
          text={t('people.invite.resetText')}
          confirmLabel={t('people.invite.resetConfirm')}
          onConfirm={async () => setInvite(await api.resetInvite())}
          onClose={() => setResetting(false)}
        />
      )}
    </Window>
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
