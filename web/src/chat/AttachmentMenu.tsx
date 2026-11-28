import type { MouseEvent } from 'react';
import type { Attachment } from '../types';
import { CopyIcon, DownloadIcon, ExternalLinkIcon, LinkIcon } from '../ui/icons';
import { useT } from '../i18n';
import { ContextMenu, MenuItem, useContextMenu } from '../ui/Menu';
import { copyImage, copyText, pngOf } from './imageCopy';

type Action = 'copy-image' | 'save' | 'copy-link' | 'open';

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
 * onContextMenu (and the rest of what `bind` gives); `menu` is rendered next to it and is nothing until a menu is asked for.
 */
export function useAttachmentMenu() {
  const { t } = useT();
  const ctx = useContextMenu<Attachment>(({ point, target: item, close }) => {
    const isFile = item.kind === 'file';
    return (
      <ContextMenu
        point={point}
        onClose={close}
        label={isFile ? t('chat.attach.fileActions') : t('chat.attach.imageActions')}
        onAction={(key) => run(key as Action, item)}
      >
        {!isFile && <MenuItem id="copy-image" label={t('chat.attach.copyImage')} icon={<CopyIcon />} />}
        <MenuItem id="save" label={isFile ? t('chat.attach.save') : t('chat.attach.saveImage')} icon={<DownloadIcon />} />
        <MenuItem id="copy-link" label={t('chat.attach.copyLink')} icon={<LinkIcon />} />
        {!isFile && <MenuItem id="open" label={t('chat.attach.openBrowser')} icon={<ExternalLinkIcon />} />}
      </ContextMenu>
    );
  });

  function open(item: Attachment) {
    const props = ctx.bind(item);
    return (e: MouseEvent<HTMLElement>) => {
      props.onContextMenu(e);
      // Opening the menu is the hint that the picture may be copied: start on it now, so it's ready when pressed.
      if (e.defaultPrevented && item.kind !== 'file') pngOf(item.url).catch(() => {});
    };
  }

  return { open, bind: ctx.bind, menu: ctx.menu };
}
