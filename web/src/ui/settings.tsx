import { useCallback, useState, type ComponentProps, type ReactNode } from 'react';
import { Button } from '@heroui/react';
import { useStore } from '../store';
import { PushPage } from './PushPage';
import { CheckIcon, ChevronRightIcon } from './icons';

/*
 * The settings' look, after the setup wizard (account/setup.css) and the desktop app's «Свой сервер» window:
 * rows between hairlines, 46px fields with a 12px corner and a border inside, one white pill for the main action
 * and graphite for the rest. Fields are a faint white over whatever they sit on, so they read the same in the
 * settings and in a window opened over them. On the phone the rows go into grouped cards (see Rows), and whatever a
 * row opens is a page of its own.
 */
// 16px on the phone: iOS zooms into any field with smaller text when it gets the focus.
export const field =
  'block h-[46px] w-full rounded-[12px] border border-white/[0.07] bg-white/[0.03] px-3.5 text-[15px] outline-none transition-colors placeholder:text-faint focus:border-white/40 max-md:text-[16px]';
export const fieldArea =
  'block w-full resize-none rounded-[12px] border border-white/[0.07] bg-white/[0.03] px-3.5 py-2.5 text-[14px] outline-none transition-colors placeholder:text-faint focus:border-white/40 max-md:text-[16px]';
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

/**
 * Rows between hairlines on the computer. On the phone, iOS's grouped list instead: the rows in a rounded graphite
 * card, `title` as the group's caption over it (on the computer the page's own heading names the group). One column
 * no wider than the page: a row's long text is cut short, it doesn't push the row out.
 */
export function Rows({ title, children, className = '' }: { title?: string; children: ReactNode; className?: string }) {
  return (
    <section className={className}>
      {title && <h3 className="mb-2 px-4 text-[13px] text-muted md:hidden">{title}</h3>}
      <div className="grid grid-cols-[minmax(0,1fr)] md:border-t md:border-white/[0.07] max-md:overflow-hidden max-md:rounded-[20px] max-md:bg-default [&>*:last-child_.row-line]:border-b-0">
        {children}
      </div>
    </section>
  );
}

// A row and its line. On the computer the line is no box at all (`contents`) and the row draws the hairline under
// itself; on the phone the line carries it, so it starts after the icon and runs to the card's edge, as in iOS.
const ROW = 'flex w-full items-center gap-x-3.5 text-left md:min-h-16 md:border-b md:border-white/[0.07] md:py-3 max-md:pl-4';
const LINE =
  'row-line flex min-w-0 flex-1 items-center gap-3 md:contents max-md:min-h-[52px] max-md:self-stretch max-md:border-b max-md:border-white/[0.07] max-md:py-2.5 max-md:pr-4';

/** A row's frame alone, for something that lays itself out (a switch with its label). */
export function RowFrame({ children }: { children: ReactNode }) {
  return (
    <div className={ROW}>
      <span className={LINE}>{children}</span>
    </div>
  );
}

/** A glyph at the start of a row: in a graphite circle on the computer, bare in the phone's cards. */
export function RowIcon({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={`flex h-[34px] w-[34px] shrink-0 items-center justify-center overflow-hidden rounded-full bg-default [&_svg]:size-[18px] max-md:h-auto max-md:w-[22px] max-md:bg-transparent max-md:[&_svg]:size-5 ${className}`}
    >
      {children}
    </span>
  );
}

/**
 * One row: what it is, with a short value under it, and its buttons, switch or count at the end (`children`).
 * `onPress` with `action`: on the computer a button with that word runs it; on the phone the whole row does, ending
 * in a chevron. `onPress` alone: the whole row, with the chevron unless `chevron` is off (a choice's options).
 */
export function Row({
  icon,
  title,
  value,
  children,
  onPress,
  action,
  chevron = true,
}: {
  icon?: ReactNode;
  title: ReactNode;
  value?: ReactNode;
  children?: ReactNode;
  onPress?: () => void;
  action?: string;
  chevron?: boolean;
}) {
  const isMobile = useStore((s) => s.isMobile);
  const whole = onPress && (!action || isMobile);
  const inner = (
    <>
      {icon}
      <span className={LINE}>
        <span className="min-w-0 flex-1">
          <b className="block truncate text-[14px] font-medium max-md:text-[16px] max-md:font-normal">{title}</b>
          {value && <small className="block truncate text-[13px] text-muted">{value}</small>}
        </span>
        {children}
        {onPress && action && !isMobile && <Secondary onPress={onPress}>{action}</Secondary>}
        {whole && chevron && <ChevronRightIcon size={18} className="shrink-0 text-faint" />}
      </span>
    </>
  );
  if (whole) {
    return (
      <button
        type="button"
        onClick={onPress}
        className={`${ROW} outline-none transition-colors focus-visible:[&_b]:underline md:active:opacity-60 max-md:active:bg-white/[0.05]`}
      >
        {inner}
      </button>
    );
  }
  return <div className={ROW}>{inner}</div>;
}

/** The value at the end of a phone row, as iOS has it: "Обычное", the nick, the count. */
export function RowValue({ children }: { children: ReactNode }) {
  return <span className="min-w-0 max-w-[50%] shrink-0 truncate text-[14px] text-muted max-md:text-[16px]">{children}</span>;
}

/**
 * One of a few options. On the computer a segmented control at the end of the row, with what the chosen one does
 * under the name; on the phone the row shows the choice and opens a page of the options, as in iOS.
 */
export function ChoiceRow<T extends string>({
  title,
  value,
  options,
  onChange,
}: {
  title: string;
  value: T;
  options: [T, string, ReactNode?][];
  onChange: (value: T) => void;
}) {
  const isMobile = useStore((s) => s.isMobile);
  const sub = useSub();
  const current = options.find((o) => o[0] === value);
  if (!isMobile) {
    return (
      <Row title={title} value={current?.[2]}>
        <div className="flex shrink-0 gap-0.5 rounded-full border border-white/[0.07] bg-white/[0.03] p-[3px]">
          {options.map(([id, label]) => (
            <button
              key={id}
              onClick={() => onChange(id)}
              aria-pressed={value === id}
              className={`h-7 rounded-full px-3 text-[13px] transition-colors ${value === id ? 'bg-white/[0.12] font-medium text-foreground' : 'text-muted hover:text-foreground'}`}
            >
              {label}
            </button>
          ))}
        </div>
      </Row>
    );
  }
  return (
    <>
      <Row title={title} onPress={sub.show}>
        <RowValue>{current?.[1]}</RowValue>
      </Row>
      <SubPage open={sub.open} title={title} onClose={sub.hide}>
        <Rows className="mt-2">
          {options.map(([id, label, hint]) => (
            <Row
              key={id}
              title={label}
              value={hint}
              chevron={false}
              onPress={() => {
                onChange(id);
                sub.hide();
              }}
            >
              {id === value && <CheckIcon size={20} className="shrink-0" />}
            </Row>
          ))}
        </Rows>
      </SubPage>
    </>
  );
}

/** Open or closed for a SubPage, with a fresh key for each opening so its form starts empty. */
export function useSub() {
  const [state, setState] = useState({ open: false, key: 0 });
  // Pressing the row's button again folds an open section back up (on the computer it opens in place).
  const show = useCallback(() => setState((s) => (s.open ? { ...s, open: false } : { open: true, key: s.key + 1 })), []);
  const hide = useCallback(() => setState((s) => ({ ...s, open: false })), []);
  return { open: state.open, key: state.key, show, hide };
}

/**
 * What a settings row opens (the password form, the blocked list). On the phone a page of its own, with the main
 * button at the foot of it, as iOS does: the keyboard fills the rest. On the computer it opens right under its row,
 * no window over the settings and no page with one field. Keep it rendered and flip `open`, so the page can slide out.
 */
export function SubPage({ open, title, onClose, children, footer }: { open: boolean; title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  const isMobile = useStore((s) => s.isMobile);
  if (isMobile) {
    return (
      <PushPage open={open} title={title} onBack={onClose} action={footer}>
        {children}
      </PushPage>
    );
  }
  return open ? (
    <div
      aria-label={title}
      role="group"
      className="border-b border-white/[0.07] pb-5 pt-3"
      onKeyDown={(e) => {
        if (e.key !== 'Escape') return;
        // Esc folds the section, not the whole settings window.
        e.stopPropagation();
        onClose();
      }}
    >
      {children}
      <div className="mt-4 flex items-center gap-2">
        {footer}
        <Quiet onClick={onClose}>{footer ? 'Отмена' : 'Свернуть'}</Quiet>
      </div>
    </div>
  ) : null;
}
