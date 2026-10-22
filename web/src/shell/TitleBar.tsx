import { InboxButton } from '../people/Inbox';
import { AtriumMark } from '../ui/Logo';

/**
 * The desktop app's title row (desktop/main.js makes the window frameless), level with the traffic lights as in
 * Discord: Atrium's mark and name in the middle, the bell at the right. It drags the window; the bell doesn't.
 * On Windows and Linux the system's buttons take the right corner, so the bell stands left of them (index.css).
 */
export function TitleBar() {
  return (
    <div className="desktop-titlebar fixed inset-x-0 top-0 z-[101] flex h-9 items-center justify-center">
      <span className="flex items-center gap-1.5 text-[13px] font-medium text-muted">
        <AtriumMark size={14} filled />
        Atrium
      </span>
      <div className="desktop-titlebar-end absolute top-1/2 -translate-y-1/2">
        <InboxButton compact />
      </div>
    </div>
  );
}
