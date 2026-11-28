import { useId, useRef, useState } from 'react';
import { Button, Popover, Tabs } from '@heroui/react';
import { FaceSmileIcon, PlusIcon, Square2StackIcon } from '@heroicons/react/24/outline';
import { useT } from '../i18n';
import { useStore } from '../store';
import { CustomEmojiSettings } from '../shell/ExpressionSettings';
import { Dialog } from '../ui/Dialog';
import { EmojiGrid } from '../ui/EmojiPicker';
import { GifPanel } from './GifPanel';
import type { Gif } from './giphy';
import { StickerPanel } from './StickerPanel';
import { StickerUpload } from './StickerUpload';

const tabs = ['gif', 'sticker', 'emoji'] as const;
type Tab = typeof tabs[number];

export function ExpressionPicker({ apiKey, busy, gifDisabled, onGif, onEmoji, onSticker }: {
  apiKey: string; busy: boolean; gifDisabled: boolean; onGif: (value: Gif, draft: boolean) => void; onEmoji: (emoji: string, keepOpen: boolean) => void; onSticker: (id: string) => void;
}) {
  const { t } = useT();
  const isAdmin = useStore((s) => s.isAdmin);
  const anchor = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const [openCycle, setOpenCycle] = useState(0);
  const [selected, setSelected] = useState<Tab>('gif');
  const [upload, setUpload] = useState<'sticker' | 'emoji' | null>(null);
  const [newEmoji, setNewEmoji] = useState(false);
  const lastTrigger = useRef<HTMLButtonElement | null>(null);
  const labels = { gif: t('chat.expression.gif'), sticker: t('chat.expression.sticker'), emoji: t('chat.expression.emoji') };
  const chooseLabels = { gif: t('chat.gif.pick'), sticker: t('chat.sticker.pick'), emoji: t('chat.emoji.pick') };

  function close(restoreFocus = false) {
    setOpen(false);
    if (restoreFocus) requestAnimationFrame(() => lastTrigger.current?.focus());
  }

  function show() {
    setOpenCycle((cycle) => cycle + 1);
    setOpen(true);
  }

  function add(type: 'sticker' | 'emoji') {
    close();
    setUpload(type);
  }

  function finishUpload() {
    setUpload(null);
    requestAnimationFrame(show);
  }

  return (
    <>
      <div ref={anchor} data-expression-triggers className="flex shrink-0 items-center gap-1">
        {tabs.map((tab) => (
          <Button
            key={tab} variant="ghost" isIconOnly aria-label={chooseLabels[tab]} aria-haspopup="dialog" aria-expanded={open && selected === tab} aria-controls={open && selected === tab ? panelId : undefined}
            isDisabled={busy} onPress={(event) => {
              lastTrigger.current = event.target instanceof HTMLButtonElement ? event.target : event.target.closest('button');
              setNewEmoji(false);
              if (!open) show();
              else if (selected === tab) close();
              setSelected(tab);
            }} className={`size-9 min-w-9 rounded-full p-0 text-[12px] font-semibold ${open && selected === tab ? 'bg-white/12' : ''}`}
          >
            {tab === 'gif' ? 'GIF' : tab === 'sticker' ? <Square2StackIcon className="size-[17px]" /> : <FaceSmileIcon className="size-[18px]" />}
          </Button>
        ))}
      </div>
      <Popover key={openCycle} isOpen={open} onOpenChange={(value) => { if (!value) close(true); }}>
        <Popover.Content isNonModal triggerRef={anchor} placement="top end" offset={8} shouldCloseOnInteractOutside={(target) => !anchor.current?.contains(target)} className="w-[492px] max-w-[calc(100vw-24px)] overflow-hidden rounded-panel border border-white/10 bg-default p-0">
          <Popover.Dialog id={panelId} aria-label={t('chat.expression.panel')} className="p-0 outline-none">
            <Tabs selectedKey={selected} onSelectionChange={(key) => setSelected(key as Tab)} keyboardActivation="manual" className="w-full">
              <div className="px-3 pt-3">
                <Tabs.List aria-label={t('chat.expression.panel')} className="gap-1 rounded-full border-0 bg-window p-1">
                  {tabs.map((tab) => <Tabs.Tab id={tab} key={tab} className="h-8 rounded-full px-3 text-sm text-muted data-[selected]:bg-white/12 data-[selected]:text-foreground">{labels[tab]}</Tabs.Tab>)}
                </Tabs.List>
              </div>
              <Tabs.Panel id="gif" className="animate-gx-tab flex h-[min(436px,51dvh)] flex-col p-0 outline-none">
                <GifPanel apiKey={apiKey} onPick={(gif, draft) => { if (!draft || !gifDisabled) { close(); onGif(gif, draft); } }} />
                {gifDisabled && apiKey && <p className="border-t border-white/10 px-3 py-2 text-xs text-muted">{t('chat.maxAttachments', { n: 10 })}</p>}
              </Tabs.Panel>
              <Tabs.Panel id="sticker" className="animate-gx-tab flex h-[min(436px,51dvh)] flex-col p-0 outline-none">
                <StickerPanel onAdd={() => add('sticker')} onPick={(id) => { close(); onSticker(id); }} />
              </Tabs.Panel>
              <Tabs.Panel id="emoji" className="animate-gx-tab flex h-[min(436px,51dvh)] flex-col p-0 outline-none">
                <EmojiGrid custom composer startOnServer={newEmoji} addAction={isAdmin && <Button variant="secondary" aria-label={t('chat.emoji.add')} onPress={() => add('emoji')} className="h-9 min-w-9 shrink-0 gap-1.5 whitespace-nowrap rounded-full px-3 max-sm:size-9 max-sm:p-0"><PlusIcon className="size-4" /><span className="max-sm:hidden">{t('chat.emoji.add')}</span></Button>} onPick={(value, keepOpen) => { if (!keepOpen) close(); onEmoji(value, keepOpen); }} />
              </Tabs.Panel>
            </Tabs>
          </Popover.Dialog>
        </Popover.Content>
      </Popover>
      {upload === 'sticker' && <StickerUpload onClose={finishUpload} />}
      {upload === 'emoji' && <Dialog title={t('chat.emoji.add')} onClose={finishUpload} sheet><CustomEmojiSettings onUploaded={() => { setNewEmoji(true); finishUpload(); }} /></Dialog>}
    </>
  );
}
