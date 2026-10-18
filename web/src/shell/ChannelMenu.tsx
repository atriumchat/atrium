import { useState, type ReactNode } from 'react';
import { Button, Dropdown, Input, Label, Separator, TextField } from '@heroui/react';
import { api } from '../api';
import { addDm, markRead, setChannels, showError, useStore, voiceMembers } from '../store';
import { sendMessage } from '../socket';
import { localeOf, useT } from '../i18n';
import { roomToken } from '../ui/Markdown';
import { Avatar } from '../ui/Avatar';
import type { Channel } from '../types';
import { ConfirmDialog, Dialog } from '../ui/Dialog';
import { EmptyState } from '../ui/Illustrations';
import { BellIcon, BellSlashIcon, CheckIcon, DotsIcon, PencilIcon, SearchIcon, TrashIcon, UserPlusIcon } from '../ui/icons';

type Action = 'read' | 'mute' | 'invite' | 'rename' | 'delete';

/**
 * A server channel's "…", in its header and on its row in the list. Everyone can mark a text channel read and
 * mute it, and call friends into a voice room; the admin also renames and deletes (and reorders by dragging
 * in the list). Nothing is shown when there's nothing to offer.
 */
export function ChannelMenu({ channelId, className = '' }: { channelId: string; className?: string }) {
  const { t } = useT();
  const channels = useStore((s) => s.channels);
  const canManage = useStore((s) => s.canManageChannels);
  const unread = useStore((s) => s.unread[channelId] ?? 0);
  const muted = useStore((s) => s.mutedChannels.includes(channelId));
  // Which channel a dialog is for: the same menu may be showing another channel once this one is gone.
  const [dialog, setDialog] = useState<{ action: 'invite' | 'rename' | 'delete'; id: string } | null>(null);
  const channel = channels.find((c) => c.id === channelId);
  if (!channel) return null;
  const isText = channel.kind === 'text';

  async function run(action: Action) {
    if (!channel) return;
    try {
      if (action === 'read') markRead(channel.id);
      if (action === 'mute') useStore.setState({ mutedChannels: await api.muteChannel(channel.id, !muted) });
      if (action === 'invite' || action === 'rename' || action === 'delete') setDialog({ action, id: channel.id });
    } catch (e) {
      showError(e instanceof Error ? e.message : t('shell.menu.failed'));
    }
  }

  const personal: ReactNode[] = [];
  if (isText && unread > 0) personal.push(<Item key="read" id="read" label={t('shell.menu.markRead')} icon={<CheckIcon size={16} />} />);
  if (isText)
    personal.push(
      muted ? (
        <Item key="mute" id="mute" label={t('shell.menu.unmute')} icon={<BellIcon size={16} />} />
      ) : (
        <Item key="mute" id="mute" label={t('shell.menu.mute')} icon={<BellSlashIcon size={16} />} />
      ),
    );
  if (!isText) personal.push(<Item key="invite" id="invite" label={t('shell.menu.inviteToRoom')} icon={<UserPlusIcon size={16} />} />);

  const admin: ReactNode[] = [];
  if (canManage) {
    admin.push(<Item key="rename" id="rename" label={t('shell.menu.rename')} icon={<PencilIcon size={16} />} />);
  }
  if (personal.length + admin.length === 0) return null;

  return (
    <>
      <Dropdown>
        <Dropdown.Trigger
          aria-label={isText ? t('shell.menu.channelActionsNamed', { name: channel.name }) : t('shell.menu.roomActionsNamed', { name: channel.name })}
          className={`flex shrink-0 items-center justify-center rounded-full outline-none transition-colors hover:bg-default data-[focus-visible=true]:ring-2 data-[focus-visible=true]:ring-focus ${className || 'h-10 w-10 text-foreground'}`}
        >
          <DotsIcon size={20} />
        </Dropdown.Trigger>
        <Dropdown.Popover placement="bottom end" className="min-w-60">
          <Dropdown.Menu aria-label={isText ? t('shell.menu.channelActions') : t('shell.menu.roomActions')} onAction={(key) => run(key as Action)}>
            {personal}
            {admin}
            {canManage && <Separator />}
            {canManage && (
              <Dropdown.Item id="delete" textValue={isText ? t('shell.menu.deleteChannel') : t('shell.menu.deleteRoom')} variant="danger">
                <Label>{isText ? t('shell.menu.deleteChannel') : t('shell.menu.deleteRoom')}</Label>
                <TrashIcon size={16} className="ml-auto text-danger" />
              </Dropdown.Item>
            )}
          </Dropdown.Menu>
        </Dropdown.Popover>
      </Dropdown>
      {dialog?.id === channel.id && dialog.action === 'invite' && <InviteToRoom channel={channel} onClose={() => setDialog(null)} />}
      {dialog?.id === channel.id && dialog.action === 'rename' && <RenameChannel channel={channel} onClose={() => setDialog(null)} />}
      {dialog?.id === channel.id && dialog.action === 'delete' && <DeleteChannel channel={channel} onClose={() => setDialog(null)} />}
    </>
  );
}

function Item({ id, label, icon }: { id: Action; label: string; icon: ReactNode }) {
  return (
    <Dropdown.Item id={id} textValue={label}>
      <Label>{label}</Label>
      <span className="ml-auto text-muted">{icon}</span>
    </Dropdown.Item>
  );
}

/**
 * Friends to call into a voice room: each "Invite" sends them a room card in your DM, with a button to
 * join. People already in the room aren't offered.
 */
function InviteToRoom({ channel, onClose }: { channel: Channel; onClose: () => void }) {
  const { t, lang } = useT();
  const friends = useStore((s) => s.friends);
  const users = useStore((s) => s.users);
  const voiceState = useStore((s) => s.voiceState);
  const inside = new Set(voiceMembers(voiceState, channel.id).map((e) => e.userId));
  const [filter, setFilter] = useState('');
  const [sent, setSent] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const q = filter.trim().toLowerCase();
  const candidates = friends
    .filter((f) => f.status === 'friend' && !inside.has(f.userId))
    .map((f) => users[f.userId])
    .filter((u) => u && (!q || u.name.toLowerCase().includes(q)))
    .sort((a, b) => a.name.localeCompare(b.name, localeOf(lang)));

  async function invite(userId: string) {
    setBusy(userId);
    try {
      const dm = await api.openDm(userId);
      addDm(dm);
      if (await sendMessage(dm.id, roomToken(channel.id))) setSent((list) => [...list, userId]);
    } catch (e) {
      showError(e instanceof Error ? e.message : t('shell.menu.failed'));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Dialog
      sheet
      title={t('shell.menu.inviteToRoom')}
      subtitle={channel.name}
      onClose={onClose}
      footer={
        <Button onPress={onClose} className="rounded-full">
          {t('shell.menu.done')}
        </Button>
      }
    >
      <label className="mb-2 flex h-10 items-center gap-2 rounded-[12px] bg-default px-3 text-muted focus-within:ring-2 focus-within:ring-focus">
        <SearchIcon size={16} />
        <input
          autoFocus
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={t('shell.menu.findFriend')}
          aria-label={t('shell.menu.findFriend')}
          className="min-w-0 flex-1 bg-transparent text-[16px] text-foreground outline-none placeholder:text-muted"
        />
      </label>
      {candidates.length === 0 ? (
        q ? (
          <EmptyState compact art="search" title={t('shell.menu.noOne.title')} text={t('shell.menu.noOne.text')} plate="var(--overlay)" />
        ) : (
          <EmptyState compact art="group" title={t('shell.menu.allHere.title')} text={t('shell.menu.allHere.text')} plate="var(--overlay)" />
        )
      ) : (
        <ul>
          {candidates.map((u) => {
            const done = sent.includes(u.id);
            return (
              <li key={u.id} className="flex h-12 items-center gap-3 rounded-[12px] px-2">
                <Avatar user={u} size={32} ringBg="var(--overlay)" />
                <span className="min-w-0 flex-1 truncate text-[16px]">{u.name}</span>
                <Button
                  size="sm"
                  variant={done ? 'tertiary' : 'secondary'}
                  isDisabled={done}
                  isPending={busy === u.id}
                  onPress={() => invite(u.id)}
                  className="h-8 rounded-full px-3 text-[13px]"
                >
                  {done ? t('shell.menu.invited') : t('shell.menu.invite')}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </Dialog>
  );
}

function RenameChannel({ channel, onClose }: { channel: Channel; onClose: () => void }) {
  const { t } = useT();
  const [name, setName] = useState(channel.name);
  const [busy, setBusy] = useState(false);
  const isText = channel.kind === 'text';
  // What the server will make of it: text channels are lower-case-with-dashes.
  const squeezed = name.split(/\s+/).filter(Boolean).join(' ');
  const result = isText ? squeezed.toLowerCase().replace(/ /g, '-') : squeezed;

  async function save() {
    if (!result) return;
    if (result === channel.name) return onClose();
    setBusy(true);
    try {
      setChannels(await api.renameChannel(channel.id, name));
      onClose();
    } catch (e) {
      showError(e instanceof Error ? e.message : t('shell.menu.renameFailed'));
      setBusy(false);
    }
  }

  return (
    <Dialog
      title={isText ? t('shell.sidebar.nameChannel') : t('shell.sidebar.nameRoom')}
      onClose={onClose}
      footer={
        <>
          <Button variant="tertiary" onPress={onClose} className="rounded-full">
            {t('shell.menu.cancel')}
          </Button>
          <Button onPress={save} isPending={busy} isDisabled={!result} className="rounded-full">
            {t('shell.menu.save')}
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <TextField fullWidth value={name} onChange={setName} maxLength={32} autoFocus aria-label={isText ? t('shell.sidebar.nameChannel') : t('shell.sidebar.nameRoom')}>
          <Input className="h-11 bg-default text-[16px]" onFocus={(e) => e.currentTarget.select()} />
        </TextField>
        {isText && result && result !== name && <p className="px-1 pt-2 text-[13px] text-muted">{t('shell.menu.becomes', { name: result })}</p>}
      </form>
    </Dialog>
  );
}

function DeleteChannel({ channel, onClose }: { channel: Channel; onClose: () => void }) {
  const { t } = useT();
  const isText = channel.kind === 'text';
  return (
    <ConfirmDialog
      title={isText ? t('shell.menu.deleteChannelTitle', { name: channel.name }) : t('shell.menu.deleteRoomTitle', { name: channel.name })}
      text={isText ? t('shell.menu.deleteChannelText') : t('shell.menu.deleteRoomText')}
      confirmLabel={t('shell.menu.delete')}
      onConfirm={async () => setChannels(await api.deleteChannel(channel.id))}
      onClose={onClose}
    />
  );
}
