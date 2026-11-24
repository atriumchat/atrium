import { createContext, useContext, useId, useRef, useState, type ReactNode, type RefObject } from 'react';
import { UsersIcon, XMarkIcon } from '@heroicons/react/24/solid';
import { MessageSearchPanel, useMessageSearch } from '../chat/MessageSearch';
import { localeOf, useT } from '../i18n';
import { UserProfile } from '../people/UserProfile';
import { nameColor, useStore } from '../store';
import { Avatar } from '../ui/Avatar';
import { RoomChat } from '../voice/RoomChat';
import { SidePanel } from './SidePanel';

const MembersContext = createContext<{
  id: string;
  kind: 'members';
  open: boolean;
  toggle: () => void;
  trigger: RefObject<HTMLButtonElement | null>;
} | null>(null);

const MEMBERS_KEY = 'atrium_members_open';

function loadMembersOpen() {
  try {
    const saved = localStorage.getItem(MEMBERS_KEY);
    if (saved === '0' || saved === '1') return saved === '1';
  } catch {
    // Storage unavailable: fall back to the window width.
  }
  return typeof window !== 'undefined' && window.matchMedia('(min-width: 72rem)').matches;
}

/**
 * The right slot, one at a time: a text channel holds the member list, a voice room holds its chat. The slot follows
 * the channel, so the two never fight: there is no member list in a voice room and no room chat in a text channel.
 */
export function ConversationPanels({ children, enabled, panelClassName = 'overflow-hidden rounded-panel bg-window' }: { children: ReactNode; enabled: boolean; panelClassName?: string }) {
  const { t } = useT();
  const search = useMessageSearch();
  const channels = useStore((s) => s.channels);
  const selectedId = useStore((s) => s.selectedChannelId);
  const chatOpen = useStore((s) => s.voiceChatOpen);
  const [membersOpen, setMembersOpen] = useState(loadMembersOpen);
  const id = useId();
  const opener = useRef<HTMLButtonElement | null>(null);
  const wide = search?.wide ?? false;
  const layout = wide ? 'docked' : 'responsive';

  const selected = channels.find((channel) => channel.id === selectedId);
  const textChannel = enabled && selected?.kind === 'text' ? selected : undefined;
  const voiceChannel = enabled && selected?.kind === 'voice' ? selected : undefined;
  const showMembers = !!textChannel && membersOpen && !search?.open;
  const showChat = !!voiceChannel && chatOpen && !search?.open;

  const toggleMembers = () => {
    search?.dismiss();
    setMembersOpen((current) => {
      try {
        localStorage.setItem(MEMBERS_KEY, current ? '0' : '1');
      } catch {
        // Not remembered; still applied for this session.
      }
      return !current;
    });
  };

  return (
    <MembersContext.Provider value={textChannel ? {
      id,
      kind: 'members',
      open: showMembers,
      trigger: opener,
      toggle: toggleMembers,
    } : null}>
      <div className="relative flex min-w-0 flex-1 gap-2">
        <div className={`${panelClassName} flex min-w-0 flex-1`}>{children}</div>
        <MessageSearchPanel />
        {showChat && voiceChannel && <RoomChat channel={voiceChannel} layout={layout} />}
        {showMembers && (
          <SidePanel
            id={id}
            title={t('shell.header.members')}
            layout={layout}
            kind="members"
            onClose={() => {
              setMembersOpen(false);
              opener.current?.focus();
            }}
            actions={
              <button
                type="button"
                className="header-action rounded-full"
                aria-label={t('common.close')}
                onClick={() => {
                  setMembersOpen(false);
                  opener.current?.focus();
                }}
              >
                <XMarkIcon aria-hidden="true" />
              </button>
            }
            onKeyDown={(event) => {
              if (event.key !== 'Escape' || event.defaultPrevented || event.nativeEvent.isComposing) return;
              if (!(event.target instanceof Node) || !event.currentTarget.contains(event.target)) return;
              event.stopPropagation();
              setMembersOpen(false);
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
  const roles = useStore((s) => s.roles);
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
          const color = nameColor(user, roles);
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
                  <span className="block truncate text-sm" style={color ? { color } : undefined}>{user.name}</span>
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
