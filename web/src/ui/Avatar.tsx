import type { User } from '../types';

const GREEN = 'var(--success)';

type Props = {
  user: User | undefined;
  size?: number;
  speaking?: boolean;
  dimmed?: boolean;
  /** Show a green "online" status dot. */
  online?: boolean;
  /** Background behind the avatar, used to cut the gap around the speaking ring and status dot. */
  ringBg?: string;
  /** Your own real status (others only see "dnd" through user.status); invisible shows a hollow dot. */
  status?: 'online' | 'dnd' | 'invisible';
};

export function Avatar({ user, size = 32, speaking = false, dimmed = false, online = false, ringBg = 'var(--app-window)', status }: Props) {
  const shown = status ?? user?.status ?? 'online';
  const letter = (user?.name ?? '?').trim().charAt(0).toUpperCase() || '?';
  const dot = Math.max(10, Math.round(size * 0.31));
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <div
        className="flex h-full w-full select-none items-center justify-center rounded-full font-medium text-white transition-[box-shadow,opacity] duration-100"
        style={{
          fontSize: size * 0.42,
          background: user?.color ?? 'var(--accent)',
          opacity: dimmed ? 0.35 : 1,
          boxShadow: speaking ? `0 0 0 2px ${ringBg}, 0 0 0 4px ${GREEN}` : undefined,
        }}
      >
        {user?.avatarUrl ? (
          <img src={user.avatarUrl} alt="" draggable={false} className="h-full w-full rounded-full object-cover" />
        ) : (
          letter
        )}
      </div>
      {online && (
        <span
          className="absolute flex items-center justify-center rounded-full"
          title={shown === 'dnd' ? 'Не беспокоить' : shown === 'invisible' ? 'Невидимка' : 'В сети'}
          style={{
            width: dot,
            height: dot,
            right: -2,
            bottom: -2,
            background: shown === 'dnd' ? 'var(--danger)' : shown === 'invisible' ? ringBg : GREEN,
            border: shown === 'invisible' ? `${Math.max(2, Math.round(dot / 4))}px solid #8e8e93` : undefined,
            boxShadow: `0 0 0 3px ${ringBg}`,
          }}
        >
          {shown === 'dnd' && <span className="rounded-full" style={{ width: dot * 0.5, height: Math.max(2, dot * 0.16), background: ringBg }} />}
        </span>
      )}
    </div>
  );
}
