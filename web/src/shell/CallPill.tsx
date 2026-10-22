import type { ReactNode } from 'react';
import { Avatar } from '../ui/Avatar';
import type { User } from '../types';

/** A call that's on, in a list row (from Webex): a white dot and its running time or headcount in a quiet pill. */
export function CallPill({ children }: { children: ReactNode }) {
  return (
    <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-white/[0.08] px-2 text-[12px] font-medium leading-6 tabular-nums text-foreground">
      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-foreground" />
      {children}
    </span>
  );
}

/** Who's somewhere, as overlapping faces with a ring of the surface they sit on. */
export function FaceStack({ users, size = 20, ringBg, max = 4 }: { users: (User | undefined)[]; size?: number; ringBg: string; max?: number }) {
  return (
    <span className="flex shrink-0">
      {users.slice(0, max).map((u, i) => (
        <span key={u?.id ?? i} className="rounded-full" style={{ marginLeft: i ? -Math.round(size * 0.3) : 0, boxShadow: `0 0 0 2px ${ringBg}` }}>
          <Avatar user={u} size={size} ringBg={ringBg} />
        </span>
      ))}
    </span>
  );
}
