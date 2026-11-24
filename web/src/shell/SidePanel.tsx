import type { ComponentProps, ReactNode } from 'react';

export type SidePanelLayout = 'docked' | 'responsive' | 'cover';
/** What the slot holds: the member list, a voice room's chat, or message search. Each has its own width. */
export type SidePanelKind = 'members' | 'chat' | 'search';

const frames: Record<SidePanelKind, Record<SidePanelLayout, string>> = {
  // A member list reads fine narrow; the room chat needs room for attachments and quotes.
  members: {
    docked: 'w-(--app-members-width)',
    responsive: 'w-(--app-members-width) max-[72rem]:absolute max-[72rem]:bottom-0 max-[72rem]:right-0 max-[72rem]:top-0 max-[72rem]:z-40 max-[72rem]:shadow-xl',
    cover: 'absolute inset-0 z-30',
  },
  chat: {
    docked: 'w-(--app-room-chat-width)',
    responsive: 'w-(--app-room-chat-width) max-[76rem]:absolute max-[76rem]:bottom-0 max-[76rem]:right-0 max-[76rem]:top-0 max-[76rem]:z-40 max-[76rem]:shadow-xl',
    cover: 'absolute inset-0 z-30',
  },
  search: {
    docked: 'w-(--app-search-width)',
    responsive: 'w-(--app-search-width) max-[76rem]:absolute max-[76rem]:bottom-0 max-[76rem]:right-0 max-[76rem]:top-0 max-[76rem]:z-40 max-[76rem]:shadow-xl',
    cover: 'absolute inset-0 z-30',
  },
};

export function SidePanel({ title, layout = 'docked', kind = 'search', onClose, actions, children, className = '', ...props }: ComponentProps<'aside'> & {
  title: string;
  layout?: SidePanelLayout;
  kind?: SidePanelKind;
  onClose?: () => void;
  actions?: ReactNode;
}) {
  return (
    <>
      {onClose && (
        <div
          aria-hidden="true"
          onClick={onClose}
          className={`absolute inset-0 z-30 hidden bg-black/40 ${kind === 'members' ? 'max-[72rem]:block' : 'max-[76rem]:block'}`}
        />
      )}
      <aside
        {...props}
        aria-label={title}
        className={`flex min-h-0 max-w-full shrink-0 flex-col overflow-hidden rounded-panel bg-window [--app-pane-inset:var(--app-panel-inset)] ${frames[kind][layout]} ${className}`}
      >
        <header className="flex h-(--app-header-height) shrink-0 items-center gap-0.5 px-(--app-panel-inset)">
          <h2 className="min-w-0 flex-1 truncate text-[17px] font-medium">{title}</h2>
          {actions}
        </header>
        {children}
      </aside>
    </>
  );
}
