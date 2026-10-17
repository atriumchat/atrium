import { useStore } from '../store';
import type { Dm } from '../types';
import { Avatar } from './Avatar';

/** A DM shows the other person; a group shows two of its members overlapping. */
export function DmAvatar({ dm, size = 32, online, ringBg = 'var(--app-window)' }: { dm: Dm; size?: number; online?: boolean; ringBg?: string }) {
  const users = useStore((s) => s.users);
  const meId = useStore((s) => s.me?.id);
  if (dm.kind === 'dm') return <Avatar user={users[dm.userId ?? '']} size={size} online={online} ringBg={ringBg} />;

  const [first, second] = dm.members.filter((id) => id !== meId);
  const small = Math.round(size * 0.68);
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <div className="absolute left-0 top-0">
        <Avatar user={users[first]} size={small} ringBg={ringBg} />
      </div>
      <div className="absolute bottom-0 right-0 rounded-full" style={{ boxShadow: `0 0 0 2px ${ringBg}` }}>
        <Avatar user={users[second] ?? users[first]} size={small} ringBg={ringBg} />
      </div>
    </div>
  );
}
