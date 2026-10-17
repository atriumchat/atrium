import { dmTitle, useStore } from '../store';
import { ChatView } from '../chat/ChatView';
import { VoiceView } from '../voice/VoiceView';
import { FriendsView } from '../people/FriendsView';

/** The selected channel: a text chat or a voice room. */
export function ServerContent() {
  const channel = useStore((s) => s.channels.find((c) => c.id === s.selectedChannelId));
  if (!channel) return <div className="m-auto text-muted">Канал не выбран</div>;
  if (channel.kind === 'voice') return <VoiceView channel={channel} />;
  return <ChatView key={channel.id} conversation={{ id: channel.id, kind: 'channel', title: channel.name }} />;
}

/** The friends page, or the open DM / group. */
export function HomeContent() {
  const dm = useStore((s) => s.dms.find((d) => d.id === s.homeView));
  const users = useStore((s) => s.users);
  const meId = useStore((s) => s.me?.id);
  if (!dm) return <FriendsView />;
  return <ChatView key={dm.id} conversation={{ id: dm.id, kind: 'dm', title: dmTitle(dm, users, meId), userId: dm.userId }} />;
}

/** Mentions of you in the server's channels: the red number on the server, like Discord (plain chatter doesn't count). */
export function serverBadgeCount(s: ReturnType<typeof useStore.getState>) {
  return s.channels.reduce((n, c) => n + (s.mentions[c.id] ?? 0), 0);
}

/** Unread DMs + incoming friend requests, shown on the home button (and the phone's Messages tab) like Discord. */
export function homeBadgeCount(s: ReturnType<typeof useStore.getState>) {
  return (
    s.dms.reduce((n, d) => n + (s.homeView === d.id && s.mode === 'home' ? 0 : (s.unread[d.id] ?? 0)), 0) +
    s.friends.filter((f) => f.status === 'incoming').length
  );
}
