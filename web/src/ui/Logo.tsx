import { MARK_PATH, MARK_STROKE, MARK_VIEWBOX } from './logoPaths';

/**
 * The Atrium mark, an arch (paths in logoPaths.ts). No backing in the app: the tile is only for icons. Drawn in
 * currentColor as an outline, like the line icons round it. `filled`: the active tab's version, solid.
 */
export function AtriumMark({ size = 24, className, filled = false }: { size?: number; className?: string; filled?: boolean }) {
  return (
    <svg width={size} height={size} viewBox={MARK_VIEWBOX} aria-hidden="true" className={className}>
      {filled
        ? <path d={MARK_PATH} fill="currentColor" />
        : <path d={MARK_PATH} fill="none" stroke="currentColor" strokeWidth={MARK_STROKE} strokeLinejoin="round" />}
    </svg>
  );
}

/** The server's own icon, a circle, where it has one (`icon`, its URL); Atrium's mark where it doesn't. */
export function ServerMark({ icon, size = 24, className, filled = false }: { icon: string | null; size?: number; className?: string; filled?: boolean }) {
  if (!icon) return <AtriumMark size={size} className={className} filled={filled} />;
  return <img src={icon} alt="" draggable={false} width={size} height={size} className={`shrink-0 rounded-full object-cover ${className ?? ''}`} style={{ width: size, height: size }} />;
}
