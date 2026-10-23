import { useEffect, useRef, useState } from 'react';
import { Button } from '@heroui/react';
import qrcode from 'qrcode-generator';
import { useT } from '../i18n';
import { showError } from '../store';
import { Window } from '../ui/Dialog';
import { MARK_PATH } from '../ui/logoPaths';
import { CheckIcon } from '../ui/icons';

/**
 * "We've moved": a post for the old Discord server or Telegram group, as text (yours to edit) and as a square picture
 * with the server's icon, its name and a QR code of the invite link, to copy or save. For the admin, whose link has
 * no limit on how many may come.
 */
export function MovePostDialog({ serverName, serverIcon, link, onClose }: { serverName: string; serverIcon: string | null; link: string; onClose: () => void }) {
  const { t } = useT();
  const [text, setText] = useState(() => t('people.move.text', { server: serverName, link }));
  const [picture, setPicture] = useState<string | null>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const [copied, setCopied] = useState<'text' | 'image' | null>(null);

  useEffect(() => {
    let live = true;
    void drawCard({ serverName, serverIcon, link }).then((c) => {
      if (!live) return;
      canvas.current = c;
      setPicture(c.toDataURL('image/png'));
    });
    return () => {
      live = false;
    };
  }, [serverName, serverIcon, link]);

  function done(what: 'text' | 'image') {
    setCopied(what);
    setTimeout(() => setCopied(null), 2000);
  }

  async function copyText() {
    try {
      await navigator.clipboard.writeText(text);
      done('text');
    } catch {
      showError(t('people.invite.copyFailed'));
    }
  }

  async function copyImage() {
    try {
      const blob = await new Promise<Blob>((resolve, reject) => canvas.current?.toBlob((b) => (b ? resolve(b) : reject(new Error())), 'image/png'));
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      done('image');
    } catch {
      showError(t('people.move.imageFailed'));
    }
  }

  function download() {
    if (!picture) return;
    const a = document.createElement('a');
    a.href = picture;
    a.download = `${serverName || 'Atrium'}.png`;
    a.click();
  }

  return (
    <Window
      label={t('people.move.title')}
      onClose={onClose}
      className="max-w-[440px] p-0"
      footer={
        <div className="flex flex-wrap items-center gap-2 px-6 pb-6 pt-4">
          <Button onPress={copyText} className="h-10 shrink-0 whitespace-nowrap rounded-full px-4 text-[14px] [--button-bg:white] [--button-bg-hover:#e7e7ea] [--button-fg:#0b0b0c]">
            {copied === 'text' && <CheckIcon size={16} strokeWidth={2.5} />}
            {copied === 'text' ? t('people.move.copied') : t('people.move.copyText')}
          </Button>
          <Button variant="tertiary" isDisabled={!picture} onPress={copyImage} className="h-10 shrink-0 whitespace-nowrap rounded-full px-4 text-[14px]">
            {copied === 'image' && <CheckIcon size={16} strokeWidth={2.5} />}
            {copied === 'image' ? t('people.move.copied') : t('people.move.copyImage')}
          </Button>
          <button onClick={download} disabled={!picture} className="whitespace-nowrap px-2 text-[13px] text-muted hover:text-foreground hover:underline disabled:opacity-50">
            {t('people.move.download')}
          </button>
        </div>
      }
    >
      <div className="px-6 pr-14 pt-6 max-md:pt-3">
        <h2 className="text-[20px] font-medium leading-7">{t('people.move.title')}</h2>
      </div>
      <div className="px-6 pt-4">
        {/* As big as the window lets it be, so the buttons stay on screen on a low laptop screen too. */}
        <div className="mx-auto aspect-square w-full overflow-hidden rounded-[20px] bg-black" style={{ maxWidth: 'min(100%, 38vh)' }}>
          {picture && <img src={picture} alt="" className="h-full w-full" />}
        </div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={4}
          aria-label={t('people.move.title')}
          className="mt-3 w-full resize-none rounded-[18px] bg-surface-tertiary px-4 py-2.5 text-[14px] leading-5 outline-none focus:ring-2 focus:ring-focus"
        />
      </div>
    </Window>
  );
}

const SIZE = 1080;

/** The square picture: icon (or the Atrium mark), the server's name, the QR code on white, the link under it. */
async function drawCard({ serverName, serverIcon, link }: { serverName: string; serverIcon: string | null; link: string }) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  const g = canvas.getContext('2d')!;
  const font = getComputedStyle(document.body).fontFamily;
  await document.fonts?.ready;
  g.fillStyle = '#000';
  g.fillRect(0, 0, SIZE, SIZE);

  const icon = serverIcon ? await loadImage(serverIcon) : null;
  const top = 96;
  const iconSize = 120;
  if (icon) {
    g.save();
    g.beginPath();
    g.arc(SIZE / 2, top + iconSize / 2, iconSize / 2, 0, Math.PI * 2);
    g.clip();
    g.drawImage(icon, SIZE / 2 - iconSize / 2, top, iconSize, iconSize);
    g.restore();
  } else {
    // The mark is 130 x 100 in its own units.
    const scale = iconSize / 130;
    g.save();
    g.translate(SIZE / 2 - 65 * scale, top + (iconSize - 100 * scale) / 2);
    g.scale(scale, scale);
    g.fillStyle = '#fff';
    g.fill(new Path2D(MARK_PATH));
    g.restore();
  }

  g.fillStyle = '#fff';
  g.textAlign = 'center';
  g.textBaseline = 'alphabetic';
  fitText(g, serverName || 'Atrium', SIZE / 2, top + iconSize + 96, 920, 72, 600, font);

  // The code on a white plate, with the quiet zone QR readers need.
  const qr = qrcode(0, 'M');
  qr.addData(link);
  qr.make();
  const count = qr.getModuleCount();
  const plate = 560;
  const cell = Math.floor((plate - 64) / count);
  const codeSize = cell * count;
  const plateX = (SIZE - plate) / 2;
  const plateY = 390;
  g.fillStyle = '#fff';
  g.beginPath();
  g.roundRect(plateX, plateY, plate, plate, 40);
  g.fill();
  g.fillStyle = '#000';
  const x0 = plateX + (plate - codeSize) / 2;
  const y0 = plateY + (plate - codeSize) / 2;
  for (let r = 0; r < count; r++) for (let c = 0; c < count; c++) if (qr.isDark(r, c)) g.fillRect(x0 + c * cell, y0 + r * cell, cell, cell);

  g.fillStyle = '#9a9aa2';
  fitText(g, link.replace(/^https?:\/\//, ''), SIZE / 2, plateY + plate + 76, 960, 36, 400, font);
  return canvas;
}

/** One line, centred, as big as `max` px while it fits in `width`, with an ellipsis past the smallest size. */
function fitText(g: CanvasRenderingContext2D, text: string, x: number, y: number, width: number, max: number, weight: number, font: string) {
  let size = max;
  const set = () => (g.font = `${weight} ${size}px ${font}`);
  set();
  while (g.measureText(text).width > width && size > max * 0.6) {
    size -= 2;
    set();
  }
  let line = text;
  while (g.measureText(line).width > width && line.length > 1) line = line.slice(0, -2) + '…';
  g.fillText(line, x, y);
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement | null>((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}
