import { useState, type FormEvent, type ReactNode } from 'react';
import { Button } from '@heroui/react';
import { api } from '../api';
import { messageUser, showError, useStore } from '../store';
import type { Friend, User } from '../types';
import { Avatar } from '../ui/Avatar';
import { InboxButton } from './Inbox';
import { BackButton } from '../shell/ChannelHeader';
import { EmptyState, type ArtName } from '../ui/Illustrations';
import { FriendButton, UserProfile } from './UserProfile';
import { RoundButton } from '../ui/ui';
import { BubbleIcon, CheckIcon, UserPlusIcon, XIcon } from '../ui/icons';
import { RoomCards, useRoomOf } from './WhoWhere';
import { useT } from '../i18n';

type Tab = 'online' | 'all' | 'pending' | 'add';

export function FriendsView() {
  const { t } = useT();
  const friends = useStore((s) => s.friends);
  const online = useStore((s) => s.online);
  const isMobile = useStore((s) => s.isMobile);
  const incoming = friends.filter((f) => f.status === 'incoming').length;
  const [tab, setTab] = useState<Tab>(incoming > 0 ? 'pending' : 'online');

  const accepted = friends.filter((f) => f.status === 'friend');
  const onlineFriends = accepted.filter((f) => online.includes(f.userId));
  const pending = friends.filter((f) => f.status !== 'friend');

  const tabButton = (id: Tab, label: ReactNode) => (
    <button
      key={id}
      onClick={() => setTab(id)}
      className={`h-9 shrink-0 rounded-full px-4 text-[14px] transition-colors ${
        tab === id ? 'bg-white/10 text-foreground' : 'text-muted hover:text-foreground'
      }`}
    >
      {label}
    </button>
  );

  const pendingLabel = (
    <span className="flex items-center gap-1.5">
      {t('people.friends.requests')}
      {incoming > 0 && <span className="min-w-5 rounded-full bg-danger px-1.5 text-[11px] font-medium leading-5 text-white">{incoming}</span>}
    </span>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {isMobile ? (
        // Phone: the title row with "add" as a round button, the tabs on their own row underneath.
        <header className="mx-2 mt-2 shrink-0 rounded-[24px] bg-default p-2">
          <div className="flex items-center gap-1">
            <BackButton />
            <h1 className="flex-1 text-[16px] font-medium">{t('people.friends.title')}</h1>
            <RoundButton label={t('people.friends.add')} tone={tab === 'add' ? 'on' : 'plain'} onPress={() => setTab('add')}>
              <UserPlusIcon />
            </RoundButton>
          </div>
          <div className="no-scrollbar mt-1 flex gap-1 overflow-x-auto">
            {tabButton('online', t('people.friends.online'))}
            {tabButton('all', t('people.friends.all'))}
            {tabButton('pending', pendingLabel)}
          </div>
        </header>
      ) : (
        // A narrow window turns "Add friend" into a round icon; narrower still, the tabs scroll sideways.
        <header className="@container mx-2 mt-2 flex h-14 shrink-0 items-center gap-2 rounded-full bg-default pl-5 pr-2">
          <h1 className="mr-3 shrink-0 text-[16px] font-medium">{t('people.friends.title')}</h1>
          <div className="no-scrollbar flex min-w-0 items-center gap-2 overflow-x-auto">
            {tabButton('online', t('people.friends.online'))}
            {tabButton('all', t('people.friends.all'))}
            {tabButton('pending', pendingLabel)}
            <button
              onClick={() => setTab('add')}
              aria-label={t('people.friends.add')}
              className={`ml-1 flex h-9 shrink-0 items-center justify-center rounded-full text-[14px] font-medium transition-colors @max-[38rem]:w-9 @min-[38rem]:px-4 ${
                tab === 'add' ? 'bg-white/10 text-foreground' : 'bg-accent text-accent-foreground hover:opacity-90'
              }`}
            >
              <UserPlusIcon size={18} className="@min-[38rem]:hidden" />
              <span className="@max-[38rem]:hidden">{t('people.friends.add')}</span>
            </button>
          </div>
          <span className="flex-1" />
          <InboxButton />
        </header>
      )}

      <div className="flex flex-1 flex-col overflow-y-auto px-3 pb-4 pt-3 max-md:px-1">
        {/* The rooms first: where people are talking right now, a tap away. On the phone they're on the home tab. */}
        {tab !== 'add' && !isMobile && (
          <div className="px-1 pb-4">
            <RoomCards grid />
          </div>
        )}
        {tab === 'add' ? (
          <AddFriend />
        ) : tab === 'pending' ? (
          <FriendList title={t('people.friends.requestsTitle', { n: pending.length })} friends={pending} empty={['mailbox', t('people.friends.emptyRequests'), t('people.friends.emptyRequestsText')]} />
        ) : tab === 'all' ? (
          <FriendList title={t('people.friends.allTitle', { n: accepted.length })} friends={accepted} empty={['couch', t('people.friends.emptyFriends'), t('people.friends.emptyFriendsText')]} />
        ) : (
          <FriendList
            title={t('people.friends.onlineTitle', { n: onlineFriends.length })}
            friends={onlineFriends}
            empty={accepted.length
                ? ['away', t('people.friends.emptyOnline'), t('people.friends.emptyOnlineText')]
                : ['couch', t('people.friends.emptyFriends'), t('people.friends.emptyFriendsText')]}
          />
        )}
      </div>
    </div>
  );
}

/** `empty`: the drawing, title and line for when there's nobody in the list. */
function FriendList({ title, friends, empty }: { title: string; friends: Friend[]; empty: [ArtName, string, string] }) {
  if (friends.length === 0) return <EmptyState art={empty[0]} title={empty[1]} text={empty[2]} />;
  return (
    <section>
      <h2 className="px-3 pb-1 text-[12px] text-faint">{title}</h2>
      {friends.map((f) => (
        <FriendRow key={f.userId} friend={f} />
      ))}
    </section>
  );
}

function FriendRow({ friend }: { friend: Friend }) {
  const { t } = useT();
  const user = useStore((s) => s.users[friend.userId]);
  const online = useStore((s) => s.online.includes(friend.userId));
  const room = useRoomOf(friend.userId);
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<Friend[]>) {
    setBusy(true);
    try {
      useStore.setState({ friends: await action() });
    } catch (e) {
      showError(e instanceof Error ? e.message : t('people.failed'));
    } finally {
      setBusy(false);
    }
  }

  const subtitle =
    friend.status === 'incoming'
      ? t('people.friends.incoming')
      : friend.status === 'outgoing'
        ? t('people.friends.outgoing')
        : online
          ? t('people.friends.online')
          : t('people.friends.offline');

  return (
    <div className="flex h-16 items-center gap-3 rounded-full px-2 pr-3 transition-colors hover:bg-default/50">
      <UserProfile userId={friend.userId} placement="bottom start" className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-full py-1">
        <Avatar user={user} size={40} online={online} />
        <span className="min-w-0">
          <span className="block truncate text-[15px] font-medium">{user?.name ?? '…'}</span>
          {friend.status === 'friend' && room ? (
            <span className={`block truncate text-[13px] ${room.withYou ? 'text-here' : 'text-others'}`}>{room.name}</span>
          ) : (
            <span className="block truncate text-[13px] text-muted">{subtitle}</span>
          )}
        </span>
      </UserProfile>
      {friend.status === 'friend' && (
        <RoundButton label={t('people.friends.message')} onPress={() => messageUser(friend.userId)}>
          <BubbleIcon />
        </RoundButton>
      )}
      {friend.status === 'incoming' && (
        <>
          <RoundButton label={t('people.friends.accept')} isDisabled={busy} onPress={() => run(() => api.acceptFriend(friend.userId))} className="hover:text-success">
            <CheckIcon />
          </RoundButton>
          <RoundButton label={t('people.friends.decline')} isDisabled={busy} onPress={() => run(() => api.removeFriend(friend.userId))} className="hover:text-danger">
            <XIcon />
          </RoundButton>
        </>
      )}
      {friend.status === 'outgoing' && (
        <RoundButton label={t('people.friends.cancelRequest')} isDisabled={busy} onPress={() => run(() => api.removeFriend(friend.userId))} className="hover:text-danger">
          <XIcon />
        </RoundButton>
      )}
    </div>
  );
}

function AddFriend() {
  const { t } = useT();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const users = useStore((s) => s.users);
  const meId = useStore((s) => s.me?.id);
  const friends = useStore((s) => s.friends);
  const known = new Set(friends.filter((f) => f.status === 'friend').map((f) => f.userId));
  const people = Object.values(users)
    .filter((u: User) => u.id !== meId && !known.has(u.id))
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'));

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setResult(null);
    try {
      useStore.setState({ friends: await api.addFriend(name) });
      setResult({ ok: true, text: t('people.friends.sent', { name: name.trim() }) });
      setName('');
    } catch (err) {
      setResult({ ok: false, text: err instanceof Error ? err.message : t('people.failed') });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="px-3">
      <h2 className="text-[16px] font-medium">{t('people.friends.add')}</h2>
      <p className="mt-1 text-[14px] text-muted">{t('people.friends.hint')}</p>
      <form onSubmit={submit} className="mt-3 flex h-14 items-center gap-2 rounded-full bg-default pl-5 pr-2 focus-within:ring-2 focus-within:ring-focus">
        <input
          autoFocus
          value={name}
          maxLength={32}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('people.friends.nickPlaceholder')}
          aria-label={t('people.friends.nickLabel')}
          className="min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-faint"
        />
        <Button type="submit" isPending={busy} isDisabled={!name.trim()} className="h-10 rounded-full px-5">
          {t('people.friends.send')}
        </Button>
      </form>
      {result && <p className={`mt-2 text-[14px] ${result.ok ? 'text-success' : 'text-danger'}`}>{result.text}</p>}

      {people.length > 0 && (
        <section className="mt-8">
          <h3 className="pb-2 text-[12px] text-faint">{t('people.friends.onServer')}</h3>
          {people.map((u) => (
            <div key={u.id} className="-mx-2 flex h-14 items-center gap-3 rounded-full px-2 transition-colors hover:bg-default/50">
              <UserProfile userId={u.id} placement="bottom start" className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
                <Avatar user={u} size={36} />
                <span className="truncate text-[15px] font-medium">{u.name}</span>
              </UserProfile>
              <div className="w-48 max-md:w-36">
                <FriendButton userId={u.id} name={u.name} />
              </div>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
