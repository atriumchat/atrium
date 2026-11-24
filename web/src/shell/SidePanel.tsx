import type { ComponentProps, ReactNode } from 'react';

export type SidePanelLayout = 'docked' | 'responsive' | 'cover';

const placement: Record<SidePanelLayout, string> = {
  docked: 'w-(--app-right-panel-width) border-l border-separator',
  responsive: 'w-(--app-right-panel-width) border-l border-separator max-[60rem]:absolute max-[60rem]:bottom-0 max-[60rem]:right-0 max-[60rem]:top-(--app-header-height) max-[60rem]:z-40 max-[60rem]:border-t max-[60rem]:shadow-xl',
  cover: 'absolute inset-0 z-30',
};

export function SidePanel({ title, layout = 'docked', actions, children, className = '', ...props }: ComponentProps<'aside'> & {
  title: string;
  layout?: SidePanelLayout;
  actions?: ReactNode;
}) {
  return (
    <aside
      {...props}
      aria-label={title}
      className={`flex min-h-0 max-w-full shrink-0 flex-col bg-window [--app-pane-inset:var(--app-panel-inset)] ${placement[layout]} ${className}`}
    >
      <header className="flex h-(--app-panel-header-height) shrink-0 items-center gap-0.5 px-(--app-panel-inset)">
        <h2 className="min-w-0 flex-1 truncate text-[17px] font-medium">{title}</h2>
        {actions}
      </header>
      {children}
    </aside>
  );
}
