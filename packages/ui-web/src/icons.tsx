/** The few icons the parts draw: 24-unit strokes in the text's colour, as in the apps' own icon sets. */

function Icon({ size = 24, width = 2, d }: { size?: number; width?: number; d: string }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

export const ChevronLeft = () => <Icon d="m15 18-6-6 6-6" />;
export const Check = () => <Icon size={18} width={2.5} d="M20 6 9 17l-5-5" />;
export const Cross = () => <Icon size={18} width={2.5} d="M18 6 6 18M6 6l12 12" />;
