import { createContext, useContext, useId, useRef, useState, type ReactNode, type RefObject } from 'react';
import { UsersIcon } from '@heroicons/react/24/solid';
import { MessageSearchPanel, useMessageSearch } from '../chat/MessageSearch';
import { localeOf, useT } from '../i18n';
import { UserProfile } from '../people/UserProfile';
import { setVoiceChat, useStore } from '../store';
import { Avatar } from '../ui/Avatar';
import { RoomChat } from '../voice/RoomChat';
import { SidePanel } from './SidePanel';

const MembersContext = createContext<{
  id: string;
  open: boolean;
  toggle: () => void;
  trigger: RefObject<HTMLButtonElement | null>;
} | null>(null);

export function ConversationPanels({ children, enabled }: { children: ReactNode; enabled: boolean }) {
  const { t } = useT();
  const search = useMessageSearch();
  const roomChat = useStore((s) => enabled && s.voiceChatOpen
    ? s.channels.find((channel) => channel.id === s.selectedChannelId && channel.kind === 'voice')
    : undefined);
  const [dockOpen, setDockOpen] = useState(true);
  const [overlayOpen, setOverlayOpen] = useState(false);
  const id = useId();
  const opener = useRef<HTMLButtonElement | null>(null);
  const wide = search?.wide ?? false;
  const layout = wide ? 'docked' : 'responsive';
  const open = enabled && !search?.open && !roomChat && (wide ? dockOpen : overlayOpen);
  const setOpen = wide ? setDockOpen : setOverlayOpen;

  return (
    <MembersContext.Provider value={enabled ? {
      id,
      open,
      trigger: opener,
      toggle: () => {
        search?.dismiss();
        if (roomChat) setVoiceChat(false);
        setOpen(!open);
      },
    } : null}>
      <div className="relative flex min-w-0 flex-1">
        {children}
        <MessageSearchPanel />
        {roomChat && !search?.open && <RoomChat channel={roomChat} layout={layout} />}
        {open && (
          <SidePanel
            id={id}
            title={t('shell.header.members')}
            layout={layout}
            onKeyDown={(event) => {
              if (event.key !== 'Escape' || event.defaultPrevented || event.nativeEvent.isComposing) return;
              if (!(event.target instanceof Node) || !event.currentTarget.contains(event.target)) return;
              event.stopPropagation();
              setOpen(false);
              opener.current?.focus();
            }}
          >
            <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
              <MemberGroups />
            </div>
          </SidePanel>
        )}
      </div>
    </MembersContext.Provider>
  );
}

export function MembersButton() {
  const { t } = useT();
  const members = useContext(MembersContext);
  if (!members) return null;
  return (
    <button
      ref={members.trigger}
      type="button"
      aria-label={t('shell.header.members')}
      aria-expanded={members.open}
      aria-controls={members.open ? members.id : undefined}
      title={t('shell.header.members')}
      onClick={members.toggle}
      className="header-action"
    >
      <UsersIcon className="size-5" aria-hidden="true" />
    </button>
  );
}

export function MemberGroups() {
  const { t, lang } = useT();
  const users = useStore((s) => s.users);
  const online = useStore((s) => s.online);
  const voiceState = useStore((s) => s.voiceState);
  const channels = useStore((s) => s.channels);
  const onlineSet = new Set(online);
  const sorted = Object.values(users).filter((user) => !user.removed)
    .sort((a, b) => a.name.localeCompare(b.name, localeOf(lang)));
  const groups = [
    { key: 'shell.header.onlineGroup', list: sorted.filter((user) => onlineSet.has(user.id)), online: true },
    { key: 'shell.header.offlineGroup', list: sorted.filter((user) => !onlineSet.has(user.id)), online: false },
  ] as const;

  return groups.filter(({ list }) => list.length > 0).map((group) => (
    <section key={group.key} className="pb-2">
      <h3 className="px-2 pb-1 pt-2 text-xs font-medium text-muted">{t(group.key, { n: group.list.length })}</h3>
      <ul>
        {group.list.map((user) => {
          const voice = group.online && voiceState.find((entry) => entry.userId === user.id);
          const room = voice && channels.find((channel) => channel.id === voice.channelId)?.name;
          return (
            <li key={user.id}>
              <UserProfile
                userId={user.id}
                placement="left top"
                className={`flex w-full cursor-pointer items-center gap-2.5 rounded-row px-2 py-1.5 text-left hover:bg-default focus-visible:outline-2 focus-visible:outline-focus ${group.online ? '' : 'text-muted'}`}
              >
                <Avatar user={user} size={32} online={group.online} ringBg="var(--app-window)" />
                <span className="min-w-0">
                  <span className="block truncate text-sm">{user.name}</span>
                  {room && <span className="block truncate text-xs text-success">{t('shell.header.inRoom', { room })}</span>}
                </span>
              </UserProfile>
            </li>
          );
        })}
      </ul>
    </section>
  ));
}
