import { useMemo, useState, type ReactNode } from 'react';
import { api } from '../api';
import { localeOf, useT } from '../i18n';
import { addUser, showError, useStore } from '../store';
import type { Role, User } from '../types';
import { Avatar } from '../ui/Avatar';
import { SearchIcon } from '../ui/icons';
import { Quiet, Secondary } from '../ui/settings';

/** The colours a role's nick may take: the avatars' palette, readable on black. */
export const ROLE_COLORS = ['#5865f2', '#3ba55c', '#faa61a', '#ed4245', '#eb459e', '#1abc9c', '#9b59b6', '#e67e22'];

/** A role's colour as a dot; a ring for a role without one. */
export function RoleDot({ color, size = 12 }: { color: string | null; size?: number }) {
  return (
    <span
      aria-hidden
      className={`inline-block shrink-0 rounded-full ${color ? '' : 'border border-white/40'}`}
      style={{ width: size, height: size, background: color ?? undefined }}
    />
  );
}

/** How high my top role is: above every role for the admin, below every role with none. */
export function useMyTop(): number {
  return useStore((s) => {
    if (s.isAdmin) return Infinity;
    const mine = (s.me && s.users[s.me.id]?.roles) ?? s.me?.roles ?? [];
    return Math.max(-Infinity, ...s.roles.filter((r) => mine.includes(r.id)).map((r) => r.position));
  });
}

/** Someone's top role position, -Infinity with none. */
export function topOf(user: User | undefined, roles: Role[]): number {
  const ids = user?.roles ?? [];
  return Math.max(-Infinity, ...roles.filter((r) => ids.includes(r.id)).map((r) => r.position));
}

/** A ticked list: a row per item, the whole row toggles it. */
function Tick({ checked, disabled, onToggle, children }: { checked: boolean; disabled?: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <label
      className={`flex h-11 items-center gap-3 rounded-row px-2 text-[15px] ${disabled ? 'opacity-40' : 'cursor-pointer hover:bg-white/[0.04]'}`}
    >
      <input type="checkbox" checked={checked} disabled={disabled} onChange={onToggle} className="h-4 w-4 shrink-0 accent-white" />
      {children}
    </label>
  );
}

export function RoleChecklist({
  roles,
  selected,
  onToggle,
  disabled,
}: {
  roles: Role[];
  selected: string[];
  onToggle: (id: string) => void;
  disabled?: (role: Role) => boolean;
}) {
  return (
    <div>
      {roles.map((r) => (
        <Tick key={r.id} checked={selected.includes(r.id)} disabled={disabled?.(r)} onToggle={() => onToggle(r.id)}>
          <RoleDot color={r.color} />
          <span className="min-w-0 flex-1 truncate">{r.name}</span>
        </Tick>
      ))}
    </div>
  );
}

/** Everyone on the server (not the removed), with a filter by nick, the ticked ones first. */
export function PeopleChecklist({
  selected,
  onToggle,
  disabled,
  className = '',
}: {
  selected: string[];
  onToggle: (id: string) => void;
  disabled?: (user: User) => boolean;
  className?: string;
}) {
  const { t, lang } = useT();
  const users = useStore((s) => s.users);
  const [filter, setFilter] = useState('');
  // Ticked first as the list opened; a tick doesn't make rows jump.
  const [first] = useState(() => new Set(selected));
  const q = filter.trim().toLowerCase();
  const people = useMemo(
    () =>
      Object.values(users)
        .filter((u) => !u.removed && (!q || u.name.toLowerCase().includes(q)))
        .sort((a, b) => Number(first.has(b.id)) - Number(first.has(a.id)) || a.name.localeCompare(b.name, localeOf(lang))),
    [users, q, first, lang],
  );
  return (
    <div className={className}>
      <label className="mb-1 flex h-10 items-center gap-2 rounded-row border border-white/[0.07] bg-white/[0.03] px-3 text-muted focus-within:border-white/40">
        <SearchIcon size={16} />
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={t('people.roles.find')}
          aria-label={t('people.roles.find')}
          className="min-w-0 flex-1 bg-transparent text-[15px] text-foreground outline-none placeholder:text-muted max-md:text-[16px]"
        />
      </label>
      <div className="max-h-72 overflow-y-auto">
        {people.map((u) => (
          <Tick key={u.id} checked={selected.includes(u.id)} disabled={disabled?.(u)} onToggle={() => onToggle(u.id)}>
            <Avatar user={u} size={28} ringBg="var(--overlay)" />
            <span className="min-w-0 flex-1 truncate">{u.name}</span>
          </Tick>
        ))}
      </div>
    </div>
  );
}

export const toggled = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

/** Someone's roles in their profile card: ticks for the roles below one's own, saved together. */
export function UserRolesEditor({ user, onDone }: { user: User; onDone: () => void }) {
  const { t } = useT();
  const roles = useStore((s) => s.roles);
  const myTop = useMyTop();
  const [selected, setSelected] = useState(user.roles ?? []);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      addUser(await api.setUserRoles(user.id, roles.filter((r) => selected.includes(r.id)).map((r) => r.id)));
      onDone();
    } catch (e) {
      showError(e instanceof Error ? e.message : t('settings.roles.failed'));
    } finally {
      setBusy(false);
    }
  }

  if (roles.length === 0) return <p className="text-[15px] text-muted">{t('people.roles.none')}</p>;
  return (
    <div className="-mx-2">
      <RoleChecklist roles={roles} selected={selected} onToggle={(id) => setSelected((s) => toggled(s, id))} disabled={(r) => r.position >= myTop} />
      <div className="mt-2 flex gap-2 px-2">
        <Secondary onPress={save} isPending={busy}>
          {t('people.roles.save')}
        </Secondary>
        <Quiet onClick={onDone}>{t('common.cancel')}</Quiet>
      </div>
    </div>
  );
}

/** Someone's roles as small labels, each with its colour. */
export function RoleChips({ user }: { user: User }) {
  const roles = useStore((s) => s.roles);
  const theirs = roles.filter((r) => user.roles?.includes(r.id));
  if (theirs.length === 0) return null;
  return (
    <span className="flex flex-wrap gap-1.5">
      {theirs.map((r) => (
        <span key={r.id} className="flex max-w-full items-center gap-1.5 rounded-full bg-white/[0.06] px-2.5 py-0.5 text-[13px]">
          <RoleDot color={r.color} size={10} />
          <span className="truncate">{r.name}</span>
        </span>
      ))}
    </span>
  );
}
