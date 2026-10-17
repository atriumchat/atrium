import { useId } from 'react';
import { G_PATH, RING, TM_PATH } from './logoPaths';

/**
 * The Gomex mark: a "G" in a ring, with ™ (from the Figma logo; paths in logoPaths.ts). No backing in the app —
 * the blue tile is only for icons. Drawn in currentColor; below 28px the ™ would be a speck, so it's left out.
 */
/** `filled`: the active tab's version — a solid disc with the G cut out of it. */
export function GomexMark({ size = 24, className, filled = false }: { size?: number; className?: string; filled?: boolean }) {
  const mask = useId();
  if (filled) {
    return (
      <svg width={size} height={size} viewBox="0 0 164 164" aria-hidden="true" className={className}>
        <mask id={mask}>
          <circle cx={RING.cx} cy={RING.cy} r={RING.r + RING.width / 2} fill="white" />
          <path d={G_PATH} fill="black" />
        </mask>
        <circle cx={RING.cx} cy={RING.cy} r={RING.r + RING.width / 2} fill="currentColor" mask={`url(#${mask})`} />
      </svg>
    );
  }
  return (
    <svg width={size} height={size} viewBox="0 0 164 164" aria-hidden="true" className={className}>
      <circle cx={RING.cx} cy={RING.cy} r={RING.r} fill="none" stroke="currentColor" strokeWidth={RING.width} />
      <path d={G_PATH} fill="currentColor" />
      {size >= 28 && <path d={TM_PATH} fill="currentColor" />}
    </svg>
  );
}

/** The server's own icon, a circle, where it has one (`icon`, its URL); Gomex's mark where it doesn't. */
export function ServerMark({ icon, size = 24, className, filled = false }: { icon: string | null; size?: number; className?: string; filled?: boolean }) {
  if (!icon) return <GomexMark size={size} className={className} filled={filled} />;
  return <img src={icon} alt="" draggable={false} width={size} height={size} className={`shrink-0 rounded-full object-cover ${className ?? ''}`} style={{ width: size, height: size }} />;
}
