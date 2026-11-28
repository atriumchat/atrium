import { useCallback, useEffect, useRef, useState, type ComponentProps, type MouseEvent, type PointerEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Description, Dropdown, Label, Separator } from '@heroui/react';
import { CheckIcon } from './icons';
import { Radio } from './Radio';
import { exitGhost } from './exitGhost';

/**
 * Every menu in the app is built from these parts, so they all look and behave alike: one width (220-300), one row
 * height, an icon on the left, an optional second line with the current value, a slot on the right for a check, a
 * checkbox or the arrow of a submenu, red rows last and apart. The menu itself is HeroUI's Dropdown (react-aria):
 * arrows move, Enter picks, Esc closes and gives the focus back, submenus open with the right arrow.
 */

type Placement = ComponentProps<typeof Dropdown.Popover>['placement'];

const WIDTH = 'min-w-[220px] max-w-[min(300px,calc(100vw-16px))]';
const WIDE = 'min-w-[220px] max-w-[min(340px,calc(100vw-16px))]';

/** What a menu shows: its name (for screen readers), what a pick does, and the rows. */
export type MenuSpec = {
  label: string;
  onAction?: (key: string) => void;
  /** Something above the list that isn't a row (a row of quick reactions, a volume slider). */
  header?: ReactNode;
  children: ReactNode;
  /** Long labels (device names). */
  wide?: boolean;
};

type Choice = { selected: string; onSelect: (id: string) => void };

function MenuList({ label, onAction, choice, children }: Pick<MenuSpec, 'label' | 'onAction' | 'children'> & { choice?: Choice }) {
  return (
    <Dropdown.Menu
      aria-label={label}
      onAction={onAction ? (key) => onAction(String(key)) : undefined}
      {...(choice
        ? {
            selectionMode: 'single' as const,
            disallowEmptySelection: true,
            selectedKeys: [choice.selected],
            onSelectionChange: (keys: unknown) => {
              const id = [...(keys as Set<string>)][0];
              if (id !== undefined) choice.onSelect(String(id));
            },
          }
        : {})}
    >
      {children}
    </Dropdown.Menu>
  );
}

// A right-click menu is unmounted the moment it closes (a row picked, a click outside): its ghost plays the leaving.
const pointerMenuRef = exitGhost<HTMLElement>();

function Popup({ spec, placement, offset, triggerRef, atPointer, choice }: { spec: MenuSpec; placement?: Placement; offset?: number; triggerRef?: ComponentProps<typeof Dropdown.Popover>['triggerRef']; atPointer?: boolean; choice?: Choice }) {
  return (
    <Dropdown.Popover
      ref={atPointer ? pointerMenuRef : undefined}
      triggerRef={triggerRef}
      placement={placement ?? 'bottom end'}
      offset={offset}
      className={`${spec.wide ? WIDE : WIDTH} ${atPointer ? 'context-menu' : ''}`}
    >
      {spec.header}
      <MenuList label={spec.label} onAction={spec.onAction} choice={choice}>
        {spec.children}
      </MenuList>
    </Dropdown.Popover>
  );
}

/** A button that opens a menu. `trigger` is what's inside the button; the button's own look is `triggerClassName`. */
export function Menu(
  props: MenuSpec & {
    trigger?: ReactNode;
    /** Instead of `trigger`: a button of your own (HeroUI's, with a tooltip) that opens the menu. */
    button?: ReactNode;
    /** The button's name for screen readers (the menu's own name when left out). */
    triggerLabel?: string;
    triggerClassName?: string;
    triggerProps?: Omit<ComponentProps<typeof Dropdown.Trigger>, 'children' | 'className' | 'aria-label'>;
    placement?: Placement;
    offset?: number;
    choice?: Choice;
    isOpen?: boolean;
    onOpenChange?: (open: boolean) => void;
  },
) {
  const { trigger, button, triggerLabel, triggerClassName, triggerProps, placement, offset, choice, isOpen, onOpenChange, ...spec } = props;
  return (
    <Dropdown isOpen={isOpen} onOpenChange={onOpenChange}>
      {button ?? (
        <Dropdown.Trigger aria-label={triggerLabel ?? spec.label} className={triggerClassName} {...triggerProps}>
          {trigger}
        </Dropdown.Trigger>
      )}
      <Popup spec={spec} placement={placement} offset={offset} choice={choice} />
    </Dropdown>
  );
}

/** A menu open at a point (the pointer's), with no button of its own: what a right-click shows. */
export function ContextMenu({ point, onClose, ...spec }: MenuSpec & { point: { x: number; y: number }; onClose: () => void }) {
  // The menu hangs off the point that was clicked: an empty box of no size right there.
  const anchor = useRef<HTMLSpanElement>(null);
  return (
    <>
      {createPortal(<span ref={anchor} aria-hidden="true" className="pointer-events-none fixed h-0 w-0" style={{ left: point.x, top: point.y }} />, document.body)}
      <Dropdown isOpen onOpenChange={(open) => !open && onClose()}>
        {/* The same arrival as any menu, in the exit's time (.context-menu): quick, from the clicked corner. */}
        <Popup spec={spec} triggerRef={anchor} placement="bottom start" offset={2} atPointer />
      </Dropdown>
    </>
  );
}

type RowProps = {
  id: string;
  label: string;
  icon?: ReactNode;
  /** A second, quieter line: the current value. */
  description?: string;
  /** Red, and last in its menu after a separator. */
  danger?: boolean;
  disabled?: boolean;
  /** A tick at the right end: this is the current one. */
  check?: boolean;
  /** A checkbox at the right end, ticked or not. */
  checkbox?: boolean;
  /** The round mark of a choice list (inside a menu with `choice`). */
  radio?: boolean;
  /** Anything else at the right end (a shortcut). */
  end?: ReactNode;
  onAction?: () => void;
};

function RowContent({ label, icon, description, danger, check, checkbox, radio, end, submenu, selected }: Omit<RowProps, 'id' | 'disabled' | 'onAction'> & { submenu?: boolean; selected?: boolean }) {
  return (
    <>
      {icon && <span className={`grid size-4 shrink-0 place-items-center [&_svg]:size-4 ${danger ? 'text-danger' : 'text-muted'}`}>{icon}</span>}
      <span className="flex min-w-0 flex-1 flex-col">
        <Label className="truncate">{label}</Label>
        {description && <Description className="truncate text-[12px] text-muted">{description}</Description>}
      </span>
      {end}
      {check && <CheckIcon size={16} className="shrink-0" />}
      {checkbox !== undefined && (
        <span aria-hidden="true" className={`grid size-4 shrink-0 place-items-center rounded-[4px] border ${checkbox ? 'border-foreground bg-foreground text-background' : 'border-white/25'}`}>
          {checkbox && <CheckIcon size={12} />}
        </span>
      )}
      {radio && <Radio on={!!selected} />}
      {submenu && <Dropdown.SubmenuIndicator />}
    </>
  );
}

/** One row of a menu. */
export function MenuItem({ id, label, disabled, danger, onAction, ...rest }: RowProps) {
  return (
    <Dropdown.Item id={id} textValue={label} variant={danger ? 'danger' : undefined} isDisabled={disabled} onAction={onAction}>
      {({ isSelected }) => <RowContent label={label} danger={danger} selected={isSelected} {...rest} />}
    </Dropdown.Item>
  );
}

/** A row that opens a menu of its own to the side; `choice` makes it a list to pick one from. */
export function SubMenu({ id, label, children, wide, choice, onAction, ...rest }: Omit<RowProps, 'onAction' | 'danger' | 'checkbox' | 'radio' | 'end'> & { children: ReactNode; wide?: boolean; choice?: Choice; onAction?: (key: string) => void }) {
  return (
    <Dropdown.SubmenuTrigger>
      <Dropdown.Item id={id} textValue={label} isDisabled={rest.disabled}>
        <RowContent label={label} icon={rest.icon} description={rest.description} check={rest.check} submenu />
      </Dropdown.Item>
      <Dropdown.Popover offset={8} className={wide ? WIDE : WIDTH}>
        <MenuList label={label} onAction={onAction} choice={choice}>
          {children}
        </MenuList>
      </Dropdown.Popover>
    </Dropdown.SubmenuTrigger>
  );
}

export const MenuSeparator = Separator;

type Point = { x: number; y: number };
type Opened<T> = { point: Point; target: T };

const HOLD_MS = 500;
const HOLD_SLOP = 10;

/**
 * Right-click (or press-and-hold on a touch screen) opens a menu at the pointer. `bind(target)` goes onto the
 * element (`{...bind(target)}`), `menu` is rendered anywhere beside it and is nothing until one is asked for;
 * `render` gets what was bound and where, and returns a `ContextMenu`. Whatever is inside an input, or already
 * answered the right-click itself (a picture, a person), is left alone, so two menus never stack. The menu key
 * hangs the menu off the element.
 */
export function useContextMenu<T = null>(render: (opened: Opened<T> & { close: () => void }) => ReactNode) {
  const [opened, setOpened] = useState<Opened<T> | null>(null);
  const hold = useRef<{ timer: number; x: number; y: number } | null>(null);
  const swallow = useRef(0);
  const lastHold = useRef(0);

  const cancel = useCallback(() => {
    if (hold.current) window.clearTimeout(hold.current.timer);
    hold.current = null;
  }, []);
  useEffect(() => cancel, [cancel]);

  const close = useCallback(() => setOpened(null), []);
  const openAt = useCallback((x: number, y: number, target: T) => setOpened({ point: { x, y }, target }), []);

  function bind(target: T, options?: { skip?: (e: MouseEvent<HTMLElement>) => boolean }) {
    return {
      onContextMenu(e: MouseEvent<HTMLElement>) {
        // Events bubble through portals too: a click inside a menu opened from here isn't one on this element.
        if (e.defaultPrevented || !e.currentTarget.contains(e.target as Node)) return;
        const node = e.target as HTMLElement;
        if (node.closest?.('input, textarea, select, [contenteditable="true"]')) return;
        if (options?.skip?.(e)) return;
        e.preventDefault();
        // From the keyboard (the menu key) there's no pointer: hang the menu off the element instead.
        const box = e.currentTarget.getBoundingClientRect();
        const keyboard = e.clientX === 0 && e.clientY === 0;
        openAt(keyboard ? box.left : e.clientX, keyboard ? box.bottom : e.clientY, target);
      },
      onPointerDown(e: PointerEvent<HTMLElement>) {
        if (e.pointerType === 'mouse' || e.defaultPrevented || !e.currentTarget.contains(e.target as Node)) return;
        if ((e.target as HTMLElement).closest?.('input, textarea, select, [contenteditable="true"]')) return;
        cancel();
        const { clientX: x, clientY: y } = e;
        hold.current = {
          x,
          y,
          timer: window.setTimeout(() => {
            hold.current = null;
            lastHold.current = Date.now();
            swallow.current = Date.now();
            openAt(x, y, target);
          }, HOLD_MS),
        };
      },
      onPointerMove(e: PointerEvent<HTMLElement>) {
        const h = hold.current;
        if (h && Math.hypot(e.clientX - h.x, e.clientY - h.y) > HOLD_SLOP) cancel();
      },
      onPointerUp: cancel,
      onPointerCancel: cancel,
      // The tap that ends a long press must not also press what's under the finger.
      onClickCapture(e: MouseEvent<HTMLElement>) {
        if (swallow.current && e.currentTarget.contains(e.target as Node) && Date.now() - swallow.current < 1000) {
          swallow.current = 0;
          e.preventDefault();
          e.stopPropagation();
        }
      },
    };
  }

  const menu = opened && render({ ...opened, close });
  return {
    bind,
    menu,
    /** Open the menu at a click's place (a tap on a tile that should show the same menu). */
    openFrom(e: MouseEvent<HTMLElement>, target: T) {
      const box = e.currentTarget.getBoundingClientRect();
      const keyboard = e.clientX === 0 && e.clientY === 0;
      openAt(keyboard ? box.left : e.clientX, keyboard ? box.bottom : e.clientY, target);
    },
    /** True just after a long press opened the menu: whatever the finger lands on then should stay shut. */
    justHeld: () => Date.now() - lastHold.current < 1000,
  };
}
