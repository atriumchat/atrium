import { toast } from '@heroui/react';
import { t } from '../i18n';
import { showError } from '../store';

type Reply = { id: number; png?: Blob; error?: string };

let worker: Worker | null = null;
let lastId = 0;
const waiting = new Map<number, { resolve: (png: Blob) => void; reject: (error: Error) => void }>();

function startWorker(): Worker {
  const w = new Worker(new URL('./pngWorker.ts', import.meta.url), { type: 'module' });
  w.onmessage = (e: MessageEvent<Reply>) => {
    const job = waiting.get(e.data.id);
    waiting.delete(e.data.id);
    if (e.data.png) job?.resolve(e.data.png);
    else job?.reject(new Error(e.data.error));
  };
  w.onerror = () => {
    // A worker that failed to load or died: fail what it was doing and start a fresh one next time.
    for (const job of waiting.values()) job.reject(new Error('worker'));
    waiting.clear();
    worker?.terminate();
    worker = null;
  };
  return w;
}

/** Any picture the browser can decode (the server keeps WebP) as a PNG, which is what other apps paste. */
function toPng(blob: Blob): Promise<Blob> {
  if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') return toPngHere(blob);
  worker ??= startWorker();
  const id = ++lastId;
  const w = worker;
  return new Promise((resolve, reject) => {
    waiting.set(id, { resolve, reject });
    w.postMessage({ id, blob });
  });
}

/** The same on the page itself, for browsers without workers or OffscreenCanvas: slower, but it works. */
async function toPngHere(blob: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0);
  bitmap.close();
  return new Promise((resolve, reject) => canvas.toBlob((png) => (png ? resolve(png) : reject(new Error('png'))), 'image/png'));
}

// The last few pictures made ready. PNGs are heavy, so only a handful are kept.
const ready = new Map<string, Promise<Blob>>();
const READY_MAX = 3;

/**
 * Starts getting a picture as a PNG: downloads it (usually from the browser's cache, uploads never change) and
 * converts it in the worker. Called when the menu opens, so by the time "Copy image" is pressed it's
 * mostly done, and again on the press for the rest; the second call shares the first one's work.
 */
export function pngOf(url: string): Promise<Blob> {
  let png = ready.get(url);
  if (!png) {
    png = fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.blob();
      })
      .then(toPng);
    ready.set(url, png);
    // A failure isn't kept, so the next try starts over; the catch here also keeps an unused one quiet.
    png.catch(() => ready.delete(url));
    if (ready.size > READY_MAX) ready.delete(ready.keys().next().value!);
  }
  return png;
}

export function notifyCopied() {
  toast.success(t('common.copy.done'), { timeout: 1500 });
}

/**
 * Puts a picture on the clipboard as PNG. Must be called straight from the click: Safari only accepts the write
 * inside the gesture, so the clipboard item is made at once with a promise for the PNG, and the toast waits for it.
 */
export function copyImage(url: string) {
  try {
    navigator.clipboard
      .write([new ClipboardItem({ 'image/png': pngOf(url) })])
      .then(notifyCopied, () => showError(t('common.copy.failed')));
  } catch {
    showError(t('common.copy.failed'));
  }
}

export function copyText(text: string) {
  // No clipboard on a page that isn't https (or localhost).
  if (!navigator.clipboard) return showError(t('common.copy.failed'));
  navigator.clipboard.writeText(text).then(notifyCopied, () => showError(t('common.copy.failed')));
}
