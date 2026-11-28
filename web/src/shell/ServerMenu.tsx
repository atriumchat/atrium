import { useState, type ReactNode } from 'react';
import { Button, Input, TextField } from '@heroui/react';
import { api } from '../api';
import { setChannels, showError, useStore } from '../store';
import { useT } from '../i18n';
import { Dialog } from '../ui/Dialog';
import { ChevronDownIcon, FolderIcon, GearIcon, HashIcon, SpeakerIcon, UserPlusIcon } from '../ui/icons';
import { ContextMenu, Menu, MenuItem, MenuSeparator, useContextMenu, type MenuSpec } from '../ui/Menu';
import { InviteDialog } from '../people/Invites';
import { SettingsDialog } from './SettingsDialog';

type Dialogs = 'invite' | 'settings' | 'text' | 'voice' | 'category';

/**
 * The server's menu: invite people, the server's settings (admin), and a new channel, room or category (whoever may
 * manage channels). The name above the channel list opens it, and so does a right-click on the server's icon.
 */
function useServerMenu() {
  const { t } = useT();
  const isAdmin = useStore((s) => s.isAdmin);
  const canManage = useStore((s) => s.canManageChannels);
  const [dialog, setDialog] = useState<Dialogs | null>(null);
  const close = () => setDialog(null);

  const spec: MenuSpec = {
    label: t('shell.menu.server'),
    onAction: (key) => setDialog(key as Dialogs),
    children: [
      <MenuItem key="invite" id="invite" label={t('shell.sidebar.invite')} icon={<UserPlusIcon />} />,
      isAdmin && <MenuItem key="settings" id="settings" label={t('shell.menu.serverSettings')} icon={<GearIcon />} />,
      canManage && <MenuSeparator key="create" />,
      canManage && <MenuItem key="text" id="text" label={t('shell.sidebar.createText')} icon={<HashIcon />} />,
      canManage && <MenuItem key="voice" id="voice" label={t('shell.sidebar.createVoice')} icon={<SpeakerIcon />} />,
      canManage && <MenuItem key="category" id="category" label={t('shell.category.new')} icon={<FolderIcon />} />,
    ],
  };
  const dialogs = (
    <>
      {dialog === 'invite' && <InviteDialog onClose={close} />}
      {dialog === 'settings' && <SettingsDialog start="server" onClose={close} />}
      {(dialog === 'text' || dialog === 'voice' || dialog === 'category') && <CreateDialog kind={dialog} onClose={close} />}
    </>
  );
  return { spec, dialogs };
}

/** The server's name above the list, with its arrow: a click opens the menu. */
export function ServerTitle() {
  const name = useStore((s) => s.serverName);
  const { spec, dialogs } = useServerMenu();
  return (
    <>
      <Menu
        {...spec}
        placement="bottom start"
        triggerLabel={name}
        triggerClassName="flex max-w-full items-center gap-1 rounded-row text-left outline-none focus-visible:ring-2 focus-visible:ring-focus"
        trigger={
          <>
            <span className="min-w-0 truncate">{name}</span>
            <ChevronDownIcon size={16} className="chevron-flip shrink-0 text-muted" />
          </>
        }
      />
      {dialogs}
    </>
  );
}

/** Whatever is inside answers a right-click with the server's menu (the server's icon in the rail). */
export function ServerContext({ children }: { children: ReactNode }) {
  const { spec, dialogs } = useServerMenu();
  const ctx = useContextMenu(({ point, close }) => <ContextMenu point={point} onClose={close} {...spec} />);
  return (
    <div className="contents" {...ctx.bind(null)}>
      {children}
      {ctx.menu}
      {dialogs}
    </div>
  );
}

function CreateDialog({ kind, onClose }: { kind: 'text' | 'voice' | 'category'; onClose: () => void }) {
  const { t } = useT();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const title = kind === 'text' ? t('shell.sidebar.createText') : kind === 'voice' ? t('shell.sidebar.createVoice') : t('shell.category.new');
  const placeholder = kind === 'text' ? t('shell.sidebar.nameChannel') : kind === 'voice' ? t('shell.sidebar.nameRoom') : t('shell.category.name');

  async function save() {
    const value = name.trim();
    if (!value) return;
    setBusy(true);
    try {
      if (kind === 'category') useStore.setState({ categories: await api.createCategory(value) });
      else setChannels(await api.createChannel(value, kind));
      onClose();
    } catch (e) {
      showError(e instanceof Error ? e.message : t('shell.sidebar.createFailed'));
      setBusy(false);
    }
  }

  return (
    <Dialog
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button variant="tertiary" onPress={onClose} className="rounded-full">
            {t('shell.menu.cancel')}
          </Button>
          <Button onPress={save} isPending={busy} isDisabled={!name.trim()} className="rounded-full">
            {t('shell.menu.create')}
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <TextField fullWidth value={name} onChange={setName} maxLength={32} autoFocus aria-label={placeholder}>
          <Input className="h-11 bg-default text-[16px]" placeholder={placeholder} />
        </TextField>
      </form>
    </Dialog>
  );
}
