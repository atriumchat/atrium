import { useState, type ReactNode } from 'react';
import { AlertDialog, Button, Modal } from '@heroui/react';
import { useIsMobile } from '../hooks';
import { showError } from '../store';

/**
 * Every window in the app sits on HeroUI's Modal: it traps focus, locks the page's scroll, animates, and its
 * body leaves room for focus rings. Mount it while it should be open; Escape, the cross or a click outside call
 * `onClose`. `sheet` is for a long list (the group picker): it takes the whole screen on a phone.
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
  footer: ReactNode;
  sheet?: boolean;
}) {
  const full = useIsMobile() && sheet;
  return (
    <Modal.Backdrop isOpen onOpenChange={(open) => !open && onClose()}>
      <Modal.Container size={full ? 'full' : 'md'} placement={full ? 'top' : 'auto'}>
        <Modal.Dialog
          className={full ? 'pb-[max(24px,env(safe-area-inset-bottom))] pt-[max(24px,env(safe-area-inset-top))]' : sheet ? 'max-h-[80vh]' : ''}
        >
          <Modal.CloseTrigger />
          <Modal.Header className="gap-1 pr-8">
            <Modal.Heading className="text-[18px] font-medium">{title}</Modal.Heading>
            {subtitle && <p className="text-[14px] text-muted">{subtitle}</p>}
          </Modal.Header>
          {children && <Modal.Body className="text-[15px] text-foreground">{children}</Modal.Body>}
          <Modal.Footer>{footer}</Modal.Footer>
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
  const [busy, setBusy] = useState(false);

  async function confirm() {
    setBusy(true);
    try {
      await onConfirm();
      onClose();
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Не получилось');
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
              Отмена
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
