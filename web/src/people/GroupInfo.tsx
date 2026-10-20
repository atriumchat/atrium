import { useState, type ReactNode } from 'react';
import { Popover } from '@heroui/react';
import { openPicker, useStore } from '../store';
import { useT } from '../i18n';
import type { Dm } from '../types';
import { Avatar } from '../ui/Avatar';
import { DmAvatar } from '../ui/DmAvatar';
import { ChevronRightIcon, LogoutIcon, PencilIcon, UserPlusIcon } from '../ui/icons';
import { UserProfile } from './UserProfile';

const MAX_MEMBERS = 10;

/**
 * A group's card, opened from its picture in the chat's header (as in the native app): its faces, name and who's in
 * it; what you can do with it (add people, rename, leave) as labelled round buttons; then everyone in it, each
 * opening their own card, with the way to add more on top. The header's "…" menu stays for the keyboard.
 */
export function GroupInfo({ dm, children, onRename, onLeave }: { dm: Dm; children: ReactNode; onRename: () => void; onLeave: () => void }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const users = useStore((s) => s.users);
  const meId = useStore((s) => s.me?.id);
  const online = useStore((s) => s.online);
  const title = dm.name || dm.members.filter((m) => m !== meId).map((m) => users[m]?.name ?? '…').join(', ');
  const others = dm.members.filter((m) => m !== meId).map((m) => users[m]?.name ?? '…');
  const who = others.length > 2 ? t('people.who.andMore', { names: others.slice(0, 2).join(', '), n: others.length - 2 }) : others.join(', ');
  // An unnamed group is already titled by its people: say how many instead of repeating them.
  const subtitle = who === title ? t('chat.members', { n: dm.members.length }) : who;
  const full = dm.members.length >= MAX_MEMBERS;
  const members = [...dm.members].sort((a, b) => Number(b === meId) - Number(a === meId) || Number(online.includes(b)) - Number(online.includes(a)) || (users[a]?.name ?? '').localeCompare(users[b]?.name ?? '', 'ru'));
  const act = (fn: () => void) => () => { setOpen(false); fn(); };
  const add = act(() => openPicker({ mode: 'add', dmId: dm.id }));

  return (
    <Popover isOpen={open} onOpenChange={setOpen}>
      <Popover.Trigger aria-label={t('people.group.info')} className="cursor-pointer rounded-full">
        {children}
      </Popover.Trigger>
      <Popover.Content placement="bottom start" className="w-80 overflow-hidden p-0">
        <Popover.Dialog aria-label={t('people.group.info')} className="max-h-[75vh] overflow-y-auto p-0 outline-none">
          <div className="flex flex-col items-center px-5 pt-6">
            <DmAvatar dm={dm} size={72} ringBg="var(--overlay)" />
            <h2 className="mt-3 line-clamp-2 text-center text-[20px] font-bold leading-6">{title}</h2>
            {subtitle && <p className="mt-1 max-w-full truncate text-[14px] text-muted">{subtitle}</p>}
          </div>
          <div className="mt-5 flex justify-center gap-6">
            <Action label={t('chat.addPeople')} disabled={full} onPress={add}>
              <UserPlusIcon size={21} />
            </Action>
            <Action label={t('chat.rename')} onPress={act(onRename)}>
              <PencilIcon size={21} />
            </Action>
            <Action label={t('chat.leave')} danger onPress={act(onLeave)}>
              <LogoutIcon size={21} className="text-danger" />
            </Action>
          </div>
          <div className="px-3 pb-3">
            <div className="mb-2 mt-5 px-3 text-[13px] text-muted">{t('people.group.membersOf', { n: dm.members.length, max: MAX_MEMBERS })}</div>
            <div className="overflow-hidden rounded-[18px] bg-default">
              {!full && (
                <button type="button" onClick={add} className="flex min-h-[52px] w-full items-center gap-3 px-3.5 text-left hover:bg-white/[0.05]">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-white text-black">
                    <UserPlusIcon size={18} />
                  </span>
                  <span className="flex-1 text-[15px] font-medium">{t('chat.addPeople')}</span>
                  <ChevronRightIcon size={18} className="text-faint" />
                </button>
              )}
              {members.map((m, i) => (
                <div key={m}>
                  {(i > 0 || !full) && <div className="ml-[62px] h-px bg-white/[0.08]" />}
                  <UserProfile userId={m} placement="right top" className="flex min-h-[52px] w-full cursor-pointer items-center gap-3 px-3.5 text-left hover:bg-white/[0.05]">
                    <Avatar user={users[m]} size={36} online={online.includes(m)} ringBg="var(--default)" />
                    <span className="min-w-0 flex-1 truncate text-[15px]">
                      {users[m]?.name ?? '…'}
                      {m === meId && <span className="text-muted"> · {t('people.who.youName')}</span>}
                    </span>
                  </UserProfile>
                </div>
              ))}
            </div>
          </div>
        </Popover.Dialog>
      </Popover.Content>
    </Popover>
  );
}

/** A round button with its word under it. */
function Action({ label, onPress, children, danger, disabled }: { label: string; onPress: () => void; children: ReactNode; danger?: boolean; disabled?: boolean }) {
  return (
    <button type="button" onClick={onPress} disabled={disabled} aria-label={label} className="flex w-[72px] flex-col items-center gap-2 transition-[opacity,transform] duration-150 active:scale-95 disabled:opacity-40">
      <span className="flex size-12 items-center justify-center rounded-full bg-default transition-colors hover:bg-[#28282d]">{children}</span>
      <span className={`max-w-full truncate text-[13px] font-medium ${danger ? 'text-danger' : ''}`}>{label}</span>
    </button>
  );
}
