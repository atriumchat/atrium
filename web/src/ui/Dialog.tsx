import { useState, type ReactNode } from 'react';
import { AlertDialog, Button, Drawer, Modal } from '@heroui/react';
import { useT } from '../i18n';
import { useIsMobile } from '../hooks';
import { showError } from '../store';

// The phone's sheet: from the bottom almost to the top, the status bar plus a little left above it. A share of its
// frame, not of the screen, so it shrinks with the keyboard and the buttons at its foot stay in view.
const SHEET = 'h-[calc(100%_-_max(12px,_env(safe-area-inset-top)_+_8px))] max-h-none rounded-t-[32px] p-0 pb-[env(safe-area-inset-bottom)]';
// A window on the computer is the app's own window surface with its edge, as Settings is, not HeroUI's lighter overlay.
const WINDOW = 'border border-edge [--overlay:var(--app-window)]';
// HeroUI's Drawer leaves in 200ms.
const SHEET_EXIT_MS = 220;

/**
 * A window on the phone: a sheet from the bottom almost to the top (HeroUI's Drawer), rounded on top, with a handle
 * to pull it down by and the cross. Only the middle scrolls; the title and the footer stay put, and they (with the
 * handle) are where a drag down starts. The parts bring their own side padding.
 */
function Sheet({
  label,
  onClose,
  header,
  children,
  footer,
}: {
  label: string;
  onClose: () => void;
  header?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
}) {
  // Closing by a pull, the cross or a tap outside first lets it slide away (HeroUI's leaving transition runs only
  // while it is still mounted, closed), then tells the owner, which unmounts it.
  const [open, setOpen] = useState(true);
  function close() {
    setOpen(false);
    setTimeout(onClose, SHEET_EXIT_MS);
  }
  return (
    <Drawer.Backdrop isOpen={open} onOpenChange={(next) => !next && close()} className="sheet-backdrop">
      <Drawer.Content placement="bottom">
        <Drawer.Dialog aria-label={label} className={`sheet ${SHEET}`}>
          {/* The theme's separator would vanish on the sheet's tone. */}
          <Drawer.Handle className="pb-1 pt-2.5 [&>[data-slot=drawer-handle-bar]]:bg-white/25" />
          {header && <Drawer.Header className="gap-1 px-5 pr-14 pt-3">{header}</Drawer.Header>}
          <Drawer.Body className="mx-0 px-0 text-[15px] text-foreground">{children}</Drawer.Body>
          {footer && <Drawer.Footer className="block">{footer}</Drawer.Footer>}
          {/* Last, so the handle, title and body keep their spacing as neighbours. */}
          <Drawer.CloseTrigger />
        </Drawer.Dialog>
      </Drawer.Content>
    </Drawer.Backdrop>
  );
}

/**
 * Every window in the app sits on HeroUI's Modal on the computer, and on its Drawer as a sheet from the bottom on the
 * phone: they trap focus, lock the page's scroll, animate, and their body leaves room for focus rings. Mount it
 * while it should be open; Escape, the cross, a click outside or (on the phone) a pull down call `onClose`; `footer`
 * holds its buttons, if it has any. `sheet` is for a long list (the group picker): on the computer it keeps the
 * window short enough to scroll inside.
 */
export function Dialog({
  title,
  subtitle,
  onClose,
  children,
  footer,
  sheet = false,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children?: ReactNode;
  footer?: ReactNode;
  sheet?: boolean;
}) {
  const isMobile = useIsMobile();
  if (isMobile) {
    return (
      <Sheet
        label={title}
        onClose={onClose}
        header={
          <>
            <Drawer.Heading className="text-[18px] font-medium">{title}</Drawer.Heading>
            {subtitle && <p className="text-[14px] text-muted">{subtitle}</p>}
          </>
        }
        footer={footer && <div className="flex justify-end gap-2 px-5 pb-5">{footer}</div>}
      >
        {children && <div className="px-5">{children}</div>}
      </Sheet>
    );
  }
  return (
    <Modal.Backdrop isOpen onOpenChange={(open) => !open && onClose()}>
      <Modal.Container size="md" placement="auto">
        <Modal.Dialog className={`${WINDOW} ${sheet ? 'max-h-[80vh]' : ''}`}>
          <Modal.CloseTrigger />
          <Modal.Header className="gap-1 pr-8">
            <Modal.Heading className="text-[18px] font-medium">{title}</Modal.Heading>
            {subtitle && <p className="text-[14px] text-muted">{subtitle}</p>}
          </Modal.Header>
          {children && <Modal.Body className="text-[15px] text-foreground">{children}</Modal.Body>}
          {footer && <Modal.Footer>{footer}</Modal.Footer>}
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}

/**
 * A window with a layout of its own (the invite, the downloads): `className` is the window's on the computer, and
 * the content brings its own padding. On the phone the same sheet as Dialog's, `footer` pinned to its foot.
 */
export function Window({
  label,
  onClose,
  className = '',
  children,
  footer,
}: {
  label: string;
  onClose: () => void;
  className?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const isMobile = useIsMobile();
  if (isMobile) {
    return (
      <Sheet label={label} onClose={onClose} footer={footer}>
        {children}
      </Sheet>
    );
  }
  return (
    <Modal.Backdrop isOpen onOpenChange={(open) => !open && onClose()}>
      <Modal.Container size="sm" placement="center">
        <Modal.Dialog aria-label={label} className={`${WINDOW} ${className}`}>
          <Modal.CloseTrigger className="z-10" />
          {children}
          {footer}
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}

/**
 * "Are you sure?" on HeroUI's AlertDialog, for anything that can't be undone. `onConfirm` may be async; the
 * button spins until it settles, and a failure is shown as a toast with the dialog left open.
 */
export function ConfirmDialog({
  title,
  text,
  confirmLabel,
  onConfirm,
  onClose,
}: {
  title: string;
  text: string;
  confirmLabel: string;
  onConfirm: () => unknown;
  onClose: () => void;
}) {
  const { t } = useT();
  const [busy, setBusy] = useState(false);

  async function confirm() {
    setBusy(true);
    try {
      await onConfirm();
      onClose();
    } catch (e) {
      showError(e instanceof Error ? e.message : t('common.failed'));
      setBusy(false);
    }
  }

  return (
    <AlertDialog.Backdrop isOpen onOpenChange={(open) => !open && onClose()} isDismissable>
      <AlertDialog.Container size="sm">
        <AlertDialog.Dialog>
          <AlertDialog.Header>
            <AlertDialog.Icon status="danger" />
            <AlertDialog.Heading className="text-[18px] font-medium">{title}</AlertDialog.Heading>
          </AlertDialog.Header>
          <AlertDialog.Body>
            <p className="text-[14px] text-muted">{text}</p>
          </AlertDialog.Body>
          <AlertDialog.Footer>
            <Button variant="tertiary" onPress={onClose} className="rounded-full">
              {t('common.cancel')}
            </Button>
            <Button variant="danger" onPress={confirm} isPending={busy} className="rounded-full text-white [--button-fg:white]">
              {confirmLabel}
            </Button>
          </AlertDialog.Footer>
        </AlertDialog.Dialog>
      </AlertDialog.Container>
    </AlertDialog.Backdrop>
  );
}
