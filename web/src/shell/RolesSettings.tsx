import { useId, useState } from 'react';
import { Label, Switch } from '@heroui/react';
import { api } from '../api';
import { useT } from '../i18n';
import { addUser, showError, useStore } from '../store';
import type { Permission, Role } from '../types';
import { ConfirmDialog } from '../ui/Dialog';
import { PlusIcon } from '../ui/icons';
import { PeopleChecklist, ROLE_COLORS, RoleDot, toggled, topOf, useMyTop } from '../people/Roles';
import { Primary, Quiet, Row, RowFrame, RowIcon, RowValue, Rows, Secondary, SubPage, field, fieldLabel, useSub } from '../ui/settings';

const PERMISSIONS: Permission[] = ['manageChannels', 'manageRoles', 'removeMembers', 'manageMessages', 'seeAllChannels'];

/**
 * The "Roles" page, for whoever may manage roles: the roles highest first, each opening its name, colour,
 * permissions, members and place in the list. Roles at or above one's own top role are shown, not opened.
 */
export function RolesSettings() {
  const { t } = useT();
  const roles = useStore((s) => s.roles);
  const isMobile = useStore((s) => s.isMobile);
  const myTop = useMyTop();
  const create = useSub();
  return (
    <Rows title={isMobile ? t('settings.page.roles') : undefined} className="mt-6">
      <Row
        icon={
          <RowIcon>
            <PlusIcon />
          </RowIcon>
        }
        title={t('settings.roles.new')}
        onPress={create.show}
        chevron={false}
      />
      <SubPage key={create.key} open={create.open} title={t('settings.roles.new')} onClose={create.hide}>
        <RoleEditor onDone={create.hide} />
      </SubPage>
      {roles.map((r) => (
        <RoleRow key={r.id} role={r} editable={r.position < myTop} />
      ))}
    </Rows>
  );
}

function RoleRow({ role, editable }: { role: Role; editable: boolean }) {
  const { t } = useT();
  const count = useStore((s) => Object.values(s.users).filter((u) => !u.removed && u.roles?.includes(role.id)).length);
  const sub = useSub();
  const icon = (
    <RowIcon>
      <RoleDot color={role.color} size={14} />
    </RowIcon>
  );
  if (!editable) {
    return (
      <Row icon={icon} title={role.name}>
        <RowValue>{t('settings.roles.members', { n: count })}</RowValue>
      </Row>
    );
  }
  return (
    <>
      <Row icon={icon} title={role.name} onPress={sub.show}>
        <RowValue>{t('settings.roles.members', { n: count })}</RowValue>
      </Row>
      <SubPage key={sub.key} open={sub.open} title={role.name} onClose={sub.hide}>
        <RoleEditor role={role} onDone={sub.hide} />
      </SubPage>
    </>
  );
}

/** A role's name, colour, permissions and members; for a role that exists, its place and "Delete" too. */
function RoleEditor({ role, onDone }: { role?: Role; onDone: () => void }) {
  const { t } = useT();
  const id = useId();
  const roles = useStore((s) => s.roles);
  const users = useStore((s) => s.users);
  const isAdmin = useStore((s) => s.isAdmin);
  const mine = useStore((s) => s.permissions);
  const myId = useStore((s) => s.me?.id);
  const myTop = useMyTop();
  const [name, setName] = useState(role?.name ?? '');
  const [color, setColor] = useState<string | null>(role?.color ?? null);
  const [permissions, setPermissions] = useState<Permission[]>(role?.permissions ?? []);
  const holders = role ? Object.values(users).filter((u) => u.roles?.includes(role.id)).map((u) => u.id) : [];
  const [members, setMembers] = useState<string[]>(holders);
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  // The roles one may move, highest first: this one swaps with its neighbour among them.
  const movable = roles.filter((r) => r.position < myTop);
  const at = role ? movable.findIndex((r) => r.id === role.id) : -1;

  async function run(action: () => Promise<void>) {
    setBusy(true);
    try {
      await action();
    } catch (e) {
      showError(e instanceof Error ? e.message : t('settings.roles.failed'));
    } finally {
      setBusy(false);
    }
  }

  const save = () =>
    run(async () => {
      const body = { name: name.trim(), color, permissions };
      const before = new Set(roles.map((r) => r.id));
      const next = role ? await api.updateRole(role.id, body) : await api.createRole(body);
      useStore.setState({ roles: next });
      const roleId = role?.id ?? next.find((r) => !before.has(r.id))?.id;
      if (!roleId) return onDone();
      // Each person whose tick changed gets their whole list of roles again, in the roles' order.
      for (const userId of new Set([...holders, ...members])) {
        if (holders.includes(userId) === members.includes(userId)) continue;
        const own = (users[userId]?.roles ?? []).filter((r) => r !== roleId);
        const wanted = members.includes(userId) ? [...own, roleId] : own;
        addUser(await api.setUserRoles(userId, next.filter((r) => wanted.includes(r.id)).map((r) => r.id)));
      }
      onDone();
    });

  const move = (step: -1 | 1) =>
    run(async () => {
      const ids = movable.map((r) => r.id);
      [ids[at], ids[at + step]] = [ids[at + step], ids[at]];
      useStore.setState({ roles: await api.reorderRoles(ids) });
    });

  return (
    <div className="max-md:mt-2">
      <label htmlFor={id} className={fieldLabel}>
        {t('settings.roles.name')}
      </label>
      <input id={id} value={name} maxLength={32} onChange={(e) => setName(e.target.value)} className={field} />

      <p className={`${fieldLabel} mt-5`}>{t('settings.roles.color')}</p>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t('settings.roles.color')}>
        {[null, ...ROLE_COLORS].map((c) => (
          <button
            key={c ?? 'none'}
            type="button"
            role="radio"
            aria-checked={color === c}
            aria-label={c ?? t('settings.roles.noColor')}
            title={c ?? t('settings.roles.noColor')}
            onClick={() => setColor(c)}
            className={`flex h-9 w-9 items-center justify-center rounded-full outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-focus ${color === c ? 'ring-2 ring-white' : ''}`}
          >
            <RoleDot color={c} size={24} />
          </button>
        ))}
      </div>

      <p className={`${fieldLabel} mt-5`}>{t('settings.roles.permissions')}</p>
      <Rows>
        {PERMISSIONS.map((p) => (
          <RowFrame key={p}>
            <Switch
              className="w-full"
              isSelected={permissions.includes(p)}
              // Only a permission one holds can be given or taken away.
              isDisabled={!isAdmin && !mine.includes(p)}
              onChange={() => setPermissions((list) => (list.includes(p) ? list.filter((x) => x !== p) : [...list, p]))}
            >
              <Switch.Content className="flex w-full items-center justify-between gap-3">
                <Label className="min-w-0 truncate text-[14px] font-medium max-md:text-[16px] max-md:font-normal">{t(`settings.roles.perm.${p}` as const)}</Label>
                <Switch.Control className="shrink-0 [--switch-control-bg:rgb(255_255_255/0.16)]">
                  <Switch.Thumb />
                </Switch.Control>
              </Switch.Content>
            </Switch>
          </RowFrame>
        ))}
      </Rows>

      <p className={`${fieldLabel} mt-5`}>{t('settings.roles.people')}</p>
      <PeopleChecklist
        selected={members}
        onToggle={(userId) => setMembers((list) => toggled(list, userId))}
        // People at or above one's own top role keep their roles; oneself may take lower ones.
        disabled={(u) => !isAdmin && u.id !== myId && (!!u.admin || topOf(u, roles) >= myTop)}
      />

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <Primary onPress={save} isPending={busy} isDisabled={!name.trim()}>
          {role ? t('settings.roles.save') : t('settings.roles.create')}
        </Primary>
        {role && at > 0 && (
          <Secondary onPress={() => move(-1)} isDisabled={busy}>
            {t('settings.roles.up')}
          </Secondary>
        )}
        {role && at >= 0 && at < movable.length - 1 && (
          <Secondary onPress={() => move(1)} isDisabled={busy}>
            {t('settings.roles.down')}
          </Secondary>
        )}
        {role && (
          <Quiet onClick={() => setAsking(true)} disabled={busy} className="text-danger hover:text-danger">
            {t('settings.roles.delete')}
          </Quiet>
        )}
      </div>
      {asking && role && (
        <ConfirmDialog
          title={t('settings.roles.deleteTitle', { name: role.name })}
          text={t('settings.roles.deleteText')}
          confirmLabel={t('settings.roles.delete')}
          onConfirm={async () => {
            useStore.setState({ roles: await api.deleteRole(role.id) });
            onDone();
          }}
          onClose={() => setAsking(false)}
        />
      )}
    </div>
  );
}
