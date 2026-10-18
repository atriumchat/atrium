import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useT } from '../i18n';
import { RoundButton } from './ui';
import { ChevronLeftIcon } from './icons';

const PUSH_MS = 280;
const PUSH_EASE = 'cubic-bezier(.2,.8,.2,1)';

/**
 * The phone's push / pop: a screen that slides in from the right over another, which drifts left and dims a
 * little, and slides back out on `open` going false. A swipe from the left edge calls `onBack` with the finger.
 * Positions are written straight to the elements (not through React state) so a swipe follows the finger at full
 * frame rate. `under` is optional: a page over the whole app has nothing of its own to drift.
 */
export function usePush(open: boolean, onBack: () => void) {
  const overRef = useRef<HTMLDivElement>(null);
  const underRef = useRef<HTMLDivElement>(null);
  const dimRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(open);
  const drag = useRef<{ x: number; t: number; dx: number } | null>(null);
  const back = useRef(onBack);
  back.current = onBack;
  const reduce = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // p: 0 = the screen underneath, 1 = the pushed one fully in.
  const apply = useCallback(
    (p: number, animate: boolean) => {
      const t = animate && !reduce ? `${PUSH_MS}ms ${PUSH_EASE}` : '0ms';
      const over = overRef.current;
      const under = underRef.current;
      const dim = dimRef.current;
      if (over) {
        over.style.transition = `transform ${t}`;
        over.style.transform = `translate3d(${(1 - p) * 100}%, 0, 0)`;
      }
      if (under) {
        under.style.transition = `transform ${t}`;
        under.style.transform = `translate3d(${-22 * p}%, 0, 0)`;
      }
      if (dim) {
        dim.style.transition = `opacity ${t}`;
        dim.style.opacity = String(0.35 * p);
      }
    },
    [reduce],
  );

  useEffect(() => {
    if (open) setMounted(true);
    else {
      apply(0, true);
      const timer = setTimeout(() => setMounted(false), reduce ? 0 : PUSH_MS + 40);
      return () => clearTimeout(timer);
    }
  }, [open, apply, reduce]);

  // Entering: place it off-screen to the right, make the browser take that in, then slide it in — all
  // before the first paint, so there's no frame of waiting.
  useLayoutEffect(() => {
    if (!open || !mounted) return;
    apply(0, false);
    void overRef.current?.offsetWidth;
    apply(1, true);
  }, [open, mounted, apply]);

  const swipe = {
    onTouchStart: (e: React.TouchEvent) => {
      const touch = e.touches[0];
      // Only from the left edge, like iOS's back gesture.
      drag.current = touch.clientX < 28 ? { x: touch.clientX, t: performance.now(), dx: 0 } : null;
    },
    onTouchMove: (e: React.TouchEvent) => {
      if (!drag.current) return;
      const dx = Math.max(0, e.touches[0].clientX - drag.current.x);
      drag.current.dx = dx;
      apply(1 - dx / window.innerWidth, false);
    },
    onTouchEnd: () => {
      const d = drag.current;
      drag.current = null;
      if (!d) return;
      const speed = d.dx / Math.max(1, performance.now() - d.t);
      if (d.dx > window.innerWidth / 3 || (speed > 0.5 && d.dx > 30)) back.current();
      else apply(1, true);
    },
  };

  return { mounted, overRef, underRef, dimRef, swipe };
}

/**
 * A page of its own on the phone (a settings section, the password form): over the whole app, tab bar
 * included, with the way back on the left of its title. Keep it rendered and flip `open`, so it can slide out.
 */
export function PushPage({
  open,
  title,
  onBack,
  action,
  children,
}: {
  open: boolean;
  title: string;
  onBack: () => void;
  /** The page's one action at the right of its title, as iOS has Done: above the keyboard, never under it. */
  action?: ReactNode;
  children: ReactNode;
}) {
  const { t } = useT();
  const push = usePush(open, onBack);
  if (!push.mounted) return null;
  // On the body, after the app: above the shell and its conversation layer, under menus and toasts opened later.
  return createPortal(
    <div className="fixed inset-0 overflow-hidden" aria-hidden={!open}>
      <div ref={push.dimRef} className="pointer-events-none absolute inset-0 bg-black opacity-0" />
      <div
        ref={push.overRef}
        role="region"
        aria-label={title}
        className="absolute inset-0 flex flex-col bg-window pt-[env(safe-area-inset-top)] shadow-[-12px_0_32px_rgba(0,0,0,0.45)]"
        {...push.swipe}
      >
        <header className="flex h-14 shrink-0 items-center gap-1 px-2">
          <RoundButton tone="ghost" label={t('common.back')} onPress={onBack} className="[&_svg]:size-6">
            <ChevronLeftIcon />
          </RoundButton>
          <h1 className="min-w-0 flex-1 truncate text-[17px] font-semibold">{title}</h1>
          {action && <div className="shrink-0 pr-2 [&_button]:!h-9 [&_button]:!w-auto [&_button]:!px-4 [&_button]:!text-[15px]">{action}</div>}
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-[max(24px,env(safe-area-inset-bottom))]">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
