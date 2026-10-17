import { useCallback, useState, type ComponentProps, type ReactNode } from 'react';
import { Button } from '@heroui/react';
import { useStore } from '../store';
import { Dialog } from './Dialog';
import { PushPage } from './PushPage';
import { ChevronRightIcon } from './icons';

/*
 * The settings' look, after the setup wizard (account/setup.css) and the desktop app's «Свой сервер» window:
 * rows between hairlines, 46px fields with a 12px corner and a border inside, one white pill for the main action
 * and graphite for the rest. Fields are a faint white over whatever they sit on, so they read the same in the
 * settings and in a window opened over them.
 */
export const field =
  'block h-[46px] w-full rounded-[12px] border border-white/[0.07] bg-white/[0.03] px-3.5 text-[15px] outline-none transition-colors placeholder:text-faint focus:border-white/40';
export const fieldArea =
  'block w-full resize-none rounded-[12px] border border-white/[0.07] bg-white/[0.03] px-3.5 py-2.5 text-[14px] outline-none transition-colors placeholder:text-faint focus:border-white/40';
export const fieldLabel = 'mb-2 block text-[13px] text-muted';

type ButtonProps = ComponentProps<typeof Button>;

/** The one main action: a white pill, across the whole page on the phone. */
export function Primary({ className = '', ...props }: ButtonProps) {
  return (
    <Button
      {...props}
      className={`h-[42px] rounded-full px-5 text-[14px] font-medium [--button-bg:#f2f2f4] [--button-bg-hover:white] [--button-fg:#0c0c0e] disabled:opacity-100 disabled:[--button-bg:var(--default)] disabled:[--button-fg:var(--field-placeholder)] max-md:h-12 max-md:w-full max-md:text-[16px] ${className}`}
    />
  );
}

/** A small graphite button at the end of a row (finger-sized on the phone); a white tint, so it shows in the settings and in a window over them. */
export function Secondary({ className = '', ...props }: ButtonProps) {
  return (
    <Button
      variant="tertiary"
      {...props}
      className={`h-[34px] shrink-0 rounded-full px-3.5 text-[13px] font-medium max-md:h-10 max-md:px-4 max-md:text-[14px] [--button-bg-hover:rgb(255_255_255/0.13)] [--button-bg:rgb(255_255_255/0.08)] ${className}`}
    />
  );
}

/** Just the word, for the way out: "Отмена", "Убрать". */
export function Quiet({ className = '', ...props }: ComponentProps<'button'>) {
  return (
    <button
      type="button"
      {...props}
      className={`h-[34px] shrink-0 rounded-full px-3 text-[13px] text-muted transition-colors hover:text-foreground disabled:opacity-50 max-md:h-10 max-md:text-[14px] ${className}`}
    />
  );
}

/** Rows between hairlines. One column no wider than the page: a row's long text is cut short, it doesn't push the row out. */
export function Rows({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`grid grid-cols-[minmax(0,1fr)] border-t border-white/[0.07] ${className}`}>{children}</div>;
}

const ROW = 'flex min-h-16 w-full items-center gap-x-3.5 gap-y-2.5 border-b border-white/[0.07] py-3 text-left';

/** A row's frame alone, for something that lays itself out (a switch with its label). */
export function RowFrame({ children }: { children: ReactNode }) {
  return <div className={ROW}>{children}</div>;
}

/** A glyph in a graphite circle, at the start of a row. */
export function RowIcon({ children }: { children: ReactNode }) {
  return <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center overflow-hidden rounded-full bg-default [&_svg]:size-[18px]">{children}</span>;
}

/**
 * One row: what it is, with a short value under it, and its buttons, switch or count at the end. With `onPress`
 * the whole row opens something and ends in a chevron. `wrap`: the end goes under the name when the row is too
 * narrow for both (a segmented choice on the phone).
 */
export function Row({
  icon,
  title,
  value,
  children,
  onPress,
  wrap = false,
}: {
  icon?: ReactNode;
  title: ReactNode;
  value?: ReactNode;
  children?: ReactNode;
  onPress?: () => void;
  wrap?: boolean;
}) {
  const inner = (
    <>
      {icon}
      <span className={`min-w-0 flex-1 ${wrap ? 'basis-40' : ''}`}>
        <b className="block truncate text-[14px] font-medium max-md:text-[15px]">{title}</b>
        {value && <small className="block truncate text-[13px] text-muted">{value}</small>}
      </span>
      {children}
      {onPress && <ChevronRightIcon size={18} className="shrink-0 text-faint" />}
    </>
  );
  if (onPress) {
    return (
      <button type="button" onClick={onPress} className={`${ROW} outline-none transition-opacity active:opacity-60 focus-visible:[&_b]:underline`}>
        {inner}
      </button>
    );
  }
  return <div className={`${ROW} ${wrap ? 'flex-wrap' : ''}`}>{inner}</div>;
}

/** Open or closed for a SubPage, with a fresh key for each opening so its form starts empty. */
export function useSub() {
  const [state, setState] = useState({ open: false, key: 0 });
  const show = useCallback(() => setState((s) => ({ open: true, key: s.key + 1 })), []);
  const hide = useCallback(() => setState((s) => ({ ...s, open: false })), []);
  return { open: state.open, key: state.key, show, hide };
}

/**
 * What a settings row opens (the password form, the blocked list): a window on the computer; on the phone a page
 * of its own, with the main button at the foot of it. Keep it rendered and flip `open`, so the page can slide out.
 */
export function SubPage({ open, title, onClose, children, footer }: { open: boolean; title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  const isMobile = useStore((s) => s.isMobile);
  if (isMobile) {
    return (
      <PushPage open={open} title={title} onBack={onClose}>
        {children}
        {footer && <div className="mt-6 flex flex-col gap-2">{footer}</div>}
      </PushPage>
    );
  }
  return open ? (
    <Dialog title={title} onClose={onClose} footer={footer}>
      {children}
    </Dialog>
  ) : null;
}
