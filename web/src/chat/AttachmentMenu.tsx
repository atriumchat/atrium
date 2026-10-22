import { useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Dropdown, Label, Separator } from '@heroui/react';
import type { Attachment } from '../types';
import { CopyIcon, DownloadIcon, ExternalLinkIcon, LinkIcon } from '../ui/icons';
import { useT } from '../i18n';
import { copyImage, copyText, pngOf } from './imageCopy';

type Action = 'copy-image' | 'save' | 'copy-link' | 'open';
type Target = { x: number; y: number; item: Attachment };

/** The address that works for anyone signed in to this server, whatever page it's pasted from. */
const absoluteUrl = (url: string) => new URL(url, window.location.href).href;

/** Pictures are kept as WebP and saved as they are; the server has no original name for them. */
function imageName(url: string) {
  const id = /([0-9a-f]{32})/.exec(url)?.[1] ?? '';
  return `atrium-${id.slice(0, 8) || 'image'}.webp`;
}

function save(item: Attachment) {
  const a = document.createElement('a');
  a.href = item.url;
  a.download = item.kind === 'file' ? (item.name ?? '') : imageName(item.url);
  a.click();
}

function run(action: Action, item: Attachment) {
  // Straight from the click, nothing awaited before it: Safari lets the clipboard be written only inside the gesture.
  if (action === 'copy-image') copyImage(item.url);
  if (action === 'save') save(item);
  if (action === 'copy-link') copyText(absoluteUrl(item.url));
  if (action === 'open') window.open(absoluteUrl(item.url), '_blank', 'noopener');
}

/**
 * Right-click (or press-and-hold) on a picture or a file in a message. `open(item)` goes on the element's
 * onContextMenu; `menu` is rendered next to it and is nothing until a menu is asked for.
 */
export function useAttachmentMenu() {
  const [target, setTarget] = useState<Target | null>(null);

  function open(item: Attachment) {
    return (e: MouseEvent<HTMLElement>) => {
      e.preventDefault();
      // From the keyboard (the menu key) there's no pointer: hang the menu off the element instead.
      const box = e.currentTarget.getBoundingClientRect();
      const fromKeyboard = e.clientX === 0 && e.clientY === 0;
      setTarget({ x: fromKeyboard ? box.left : e.clientX, y: fromKeyboard ? box.bottom : e.clientY, item });
      // Opening the menu is the hint that the picture may be copied: start on it now, so it's ready when pressed.
      if (item.kind !== 'file') pngOf(item.url).catch(() => {});
    };
  }

  const menu = target && <AttachmentMenu target={target} onClose={() => setTarget(null)} />;
  return { open, menu };
}

function AttachmentMenu({ target, onClose }: { target: Target; onClose: () => void }) {
  const { t } = useT();
  const { item, x, y } = target;
  const isFile = item.kind === 'file';
  // The menu hangs off the point that was clicked: an empty box of no size right there.
  const anchor = useRef<HTMLSpanElement>(null);

  return (
    <>
      {createPortal(<span ref={anchor} aria-hidden="true" className="pointer-events-none fixed h-0 w-0" style={{ left: x, top: y }} />, document.body)}
      <Dropdown isOpen onOpenChange={(open) => !open && onClose()}>
        {/* No opening animation: a menu that fades in feels slower than it is. */}
        <Dropdown.Popover triggerRef={anchor} placement="bottom start" offset={2} className="min-w-56 data-[entering=true]:animate-none">
          <Dropdown.Menu aria-label={isFile ? t('chat.attach.fileActions') : t('chat.attach.imageActions')} onAction={(key) => run(key as Action, item)}>
            {!isFile && <Item id="copy-image" label={t('chat.attach.copyImage')} icon={<CopyIcon size={16} />} />}
            <Item id="save" label={isFile ? t('chat.attach.save') : t('chat.attach.saveImage')} icon={<DownloadIcon size={16} />} />
            {!isFile && <Separator />}
            <Item id="copy-link" label={t('chat.attach.copyLink')} icon={<LinkIcon size={16} />} />
            {!isFile && <Item id="open" label={t('chat.attach.openBrowser')} icon={<ExternalLinkIcon size={16} />} />}
          </Dropdown.Menu>
        </Dropdown.Popover>
      </Dropdown>
    </>
  );
}

function Item({ id, label, icon }: { id: Action; label: string; icon: ReactNode }) {
  return (
    <Dropdown.Item id={id} textValue={label}>
      <Label>{label}</Label>
      <span className="ml-auto text-muted">{icon}</span>
    </Dropdown.Item>
  );
}
