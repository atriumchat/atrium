import { useEffect, useState, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import type { Attachment } from '../types';
import { DownloadIcon, XIcon } from '../ui/icons';
import { useAttachmentMenu } from './AttachmentMenu';

const SINGLE_MAX_W = 420;
const SINGLE_MAX_H = 360;
const TILE = 180;

/** Pictures and files under a message. */
export function MessageAttachments({ attachments }: { attachments: Attachment[] }) {
  const images = attachments.filter((a) => a.kind !== 'file');
  const files = attachments.filter((a) => a.kind === 'file');
  return (
    <>
      <MessageImages attachments={images} />
      {files.length > 0 && (
        <div className="mt-1 flex flex-col gap-1.5">
          {files.map((f) => (
            <FileCard key={f.url} file={f} />
          ))}
        </div>
      )}
    </>
  );
}

export function fileSize(bytes = 0) {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} КБ`;
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
}

/** Any non-picture file: its type in a circle, name, size, and the whole card downloads it. */
function FileCard({ file }: { file: Attachment }) {
  const ext = (file.name ?? '').split('.').pop()?.slice(0, 4).toUpperCase() || 'ФАЙЛ';
  const { open, menu } = useAttachmentMenu();
  return (
    <>
      <a
        href={file.url}
        download={file.name}
        onContextMenu={open(file)}
        className="flex w-full max-w-[420px] items-center gap-3 rounded-full bg-default py-2 pl-2 pr-4 transition-colors hover:bg-surface-tertiary"
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-[10px] font-semibold text-black">{ext}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] text-foreground">{file.name}</span>
          <span className="block text-[12px] text-muted">{fileSize(file.size)}</span>
        </span>
        <DownloadIcon size={18} className="shrink-0 text-muted" />
      </a>
      {menu}
    </>
  );
}

/** Images under a message. Space is reserved from the stored size so the chat doesn't jump while they load. */
function MessageImages({ attachments }: { attachments: Attachment[] }) {
  const [open, setOpen] = useState<Attachment | null>(null);
  const { open: openMenu, menu } = useAttachmentMenu();
  if (attachments.length === 0) return null;
  const single = attachments.length === 1;

  return (
    <>
      <div className="mt-1 flex flex-wrap gap-1.5">
        {attachments.map((a) => {
          // One image keeps its shape; several become equal square tiles.
          const scale = Math.min(1, SINGLE_MAX_W / a.width, SINGLE_MAX_H / a.height);
          const width = single ? Math.max(1, Math.round(a.width * scale)) : TILE;
          const height = single ? Math.max(1, Math.round(a.height * scale)) : TILE;
          return (
            <button
              key={a.url}
              type="button"
              onClick={() => setOpen(a)}
              onContextMenu={openMenu(a)}
              aria-label="Открыть картинку"
              className="max-w-full cursor-zoom-in overflow-hidden rounded-[12px] bg-default outline-none focus-visible:ring-2 focus-visible:ring-accent"
              style={{ width, aspectRatio: `${width} / ${height}` }}
            >
              {/* The small preview in the chat; the full picture only in the lightbox. */}
              <img src={a.previewUrl ?? a.url} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
            </button>
          );
        })}
      </div>
      {open && <Lightbox image={open} onClose={() => setOpen(null)} onContextMenu={openMenu(open)} />}
      {menu}
    </>
  );
}

function Lightbox({ image, onClose, onContextMenu }: { image: Attachment; onClose: () => void; onContextMenu: (e: MouseEvent<HTMLElement>) => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Картинка"
      onClick={onClose}
      className="fixed inset-0 z-50 flex cursor-zoom-out flex-col items-center justify-center gap-3 bg-black/85 p-6"
    >
      <button
        type="button"
        aria-label="Закрыть"
        onClick={onClose}
        className="absolute right-5 top-5 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
      >
        <XIcon size={20} />
      </button>
      <img src={image.url} alt="" onContextMenu={onContextMenu} className="max-h-[calc(100vh-96px)] max-w-full rounded-[8px] object-contain" />
      <a
        href={image.url}
        target="_blank"
        rel="noreferrer noopener"
        onClick={(e) => e.stopPropagation()}
        className="text-[14px] text-white/70 hover:text-white hover:underline"
      >
        Открыть в новой вкладке
      </a>
    </div>,
    document.body,
  );
}
