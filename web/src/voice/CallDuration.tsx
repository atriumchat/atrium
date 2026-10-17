import { useEffect, useState } from 'react';
import { useStore } from '../store';

/** Live mm:ss (or h:mm:ss) since you joined the current voice room, or since `since`. */
export function CallDuration({ since }: { since?: number | null }) {
  const joinedAt = useStore((s) => s.joinedAt);
  const start = since ?? joinedAt;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const total = Math.max(0, Math.floor((now - (start ?? now)) / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return <>{h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${String(m).padStart(2, '0')}:${s}`}</>;
}
