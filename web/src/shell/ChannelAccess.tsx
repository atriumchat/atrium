import { useEffect, useState } from 'react';
import { Button, Label, Switch, Spinner } from '@heroui/react';
import { api } from '../api';
import { useT } from '../i18n';
import { showError, useStore } from '../store';
import type { Channel, ChannelAccess } from '../types';
import { Dialog } from '../ui/Dialog';
import { PeopleChecklist, RoleChecklist, toggled } from '../people/Roles';
import { Primary } from '../ui/settings';

/**
 * Who sees a channel: public, or private to the ticked roles and people (admins and roles that see every channel
 * see it anyway). The server takes it away from everyone else, history, files and voice room included.
 */
export function ChannelAccessDialog({ channel, onClose }: { channel: Channel; onClose: () => void }) {
  const { t } = useT();
  const roles = useStore((s) => s.roles);
  const [access, setAccess] = useState<ChannelAccess | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.channelAccess(channel.id).then(setAccess, (e) => {
      showError(e instanceof Error ? e.message : t('shell.menu.failed'));
      onClose();
    });
    // Loaded once per opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel.id]);

  async function save() {
    if (!access) return;
    setBusy(true);
    try {
      await api.setChannelAccess(channel.id, access);
      onClose();
    } catch (e) {
      showError(e instanceof Error ? e.message : t('shell.menu.failed'));
    } finally {
      setBusy(false);
    }
  }

  const isText = channel.kind === 'text';
  return (
    <Dialog
      sheet
      title={isText ? t('shell.access.channelTitle', { name: channel.name }) : t('shell.access.roomTitle', { name: channel.name })}
      onClose={onClose}
      footer={
        <>
          <Button variant="tertiary" onPress={onClose} className="rounded-full">
            {t('shell.access.cancel')}
          </Button>
          <Primary onPress={save} isPending={busy} isDisabled={!access}>
            {t('shell.access.save')}
          </Primary>
        </>
      }
    >
      {!access ? (
        <div className="flex justify-center py-6">
          <Spinner size="sm" />
        </div>
      ) : (
        <>
          <Switch className="w-full py-2" isSelected={access.private} onChange={(on) => setAccess({ ...access, private: on })}>
            <Switch.Content className="flex w-full items-center justify-between gap-3">
              <Label className="text-[15px] font-medium">{t('shell.access.private')}</Label>
              <Switch.Control className="shrink-0 [--switch-control-bg:rgb(255_255_255/0.16)]">
                <Switch.Thumb />
              </Switch.Control>
            </Switch.Content>
          </Switch>
          {access.private && (
            <>
              {roles.length > 0 && (
                <>
                  <p className="mb-1 mt-4 text-[13px] text-muted">{t('shell.access.roles')}</p>
                  <RoleChecklist roles={roles} selected={access.roleIds} onToggle={(id) => setAccess({ ...access, roleIds: toggled(access.roleIds, id) })} />
                </>
              )}
              <p className="mb-1 mt-4 text-[13px] text-muted">{t('shell.access.people')}</p>
              <PeopleChecklist selected={access.userIds} onToggle={(id) => setAccess({ ...access, userIds: toggled(access.userIds, id) })} />
            </>
          )}
        </>
      )}
    </Dialog>
  );
}
