import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

type Hint = { text: string; x: number; top: number; bottom: number };

/**
 * Text cut with an ellipsis (a long nickname, a channel's name) shows in full in a tooltip, as in Discord: a dark
 * bubble with a little arrow, centred above the text (below when there's no room above), after a short pause. One
 * listener for the whole app: any element whose text is actually cut (it overflows and ends in an ellipsis) gets it,
 * nothing to wire up per place. Only where there's a mouse.
 */
export function TruncationHint() {
  const [hint, setHint] = useState<Hint | null>(null);

  useEffect(() => {
    if (!matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    let target: HTMLElement | null = null;
    let timer = 0;
    const hide = () => {
      clearTimeout(timer);
      target = null;
      setHint(null);
    };
    const over = (e: PointerEvent) => {
      const cut = cutText(e.target);
      if (cut === target) return;
      hide();
      if (!cut) return;
      target = cut;
      timer = window.setTimeout(() => {
        const r = cut.getBoundingClientRect();
        setHint({ text: cut.textContent?.trim() ?? '', x: r.left + r.width / 2, top: r.top, bottom: r.bottom });
      }, 250);
    };
    document.addEventListener('pointerover', over);
    document.addEventListener('pointerdown', hide);
    document.addEventListener('scroll', hide, true);
    window.addEventListener('blur', hide);
    return () => {
      hide();
      document.removeEventListener('pointerover', over);
      document.removeEventListener('pointerdown', hide);
      document.removeEventListener('scroll', hide, true);
      window.removeEventListener('blur', hide);
    };
  }, []);

  if (!hint?.text) return null;
  return createPortal(<Bubble key={`${hint.x}:${hint.top}:${hint.text}`} hint={hint} />, document.body);
}

/** The bubble: above the text, or below when the text is near the top; kept inside the window, arrow on the text. */
function Bubble({ hint }: { hint: Hint }) {
  const ref = useRef<HTMLDivElement>(null);
  const [shift, setShift] = useState(0);
  const below = hint.top < 56;
  // Centred on the text; once its width is known, pulled back inside the window (the arrow stays on the text).
  useLayoutEffect(() => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const margin = 8;
    setShift(r.left < margin ? margin - r.left : r.right > window.innerWidth - margin ? window.innerWidth - margin - r.right : 0);
  }, [hint]);
  return (
    <div
      ref={ref}
      role="tooltip"
      className="pointer-events-none fixed z-[9999] w-max max-w-[320px] break-words rounded-[8px] bg-[#111113] px-3 py-2 text-[14px] font-medium leading-[18px] text-white shadow-[0_8px_16px_rgba(0,0,0,0.4)] ring-1 ring-white/[0.06]"
      style={{
        left: hint.x + shift,
        top: below ? hint.bottom + 8 : hint.top - 8,
        transform: `translate(-50%, ${below ? '0' : '-100%'})`,
      }}
    >
      {hint.text}
      <span
        aria-hidden
        className={`absolute h-2.5 w-2.5 rotate-45 bg-[#111113] ${below ? '-top-[5px]' : '-bottom-[5px]'}`}
        style={{ left: `calc(50% - ${shift}px - 5px)` }}
      />
    </div>
  );
}

/** The element under the cursor (or a near parent) whose text is cut with an ellipsis, if any. */
function cutText(node: EventTarget | null): HTMLElement | null {
  let el = node instanceof HTMLElement ? node : null;
  for (let depth = 0; el && depth < 4; depth++, el = el.parentElement) {
    if (getComputedStyle(el).textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth + 1) return el;
  }
  return null;
}
