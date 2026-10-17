import { useState, type ReactNode } from 'react';
import { Popover } from '@heroui/react';

// The ones people actually react with, roughly by how often; any other emoji can still be typed into a message.
const EMOJI = [
  '👍', '❤️', '😂', '🔥', '😮', '😢', '😡', '🎉',
  '👀', '💯', '✅', '❌', '🙏', '👏', '🤝', '💀',
  '🤡', '🤔', '😎', '🥲', '😭', '🥰', '😏', '🫡',
  '🤯', '😴', '🙈', '👌', '✌️', '🤙', '💪', '🫶',
  '🍿', '☕', '🍕', '🎮', '🏆', '⚡', '🌚', '🗿',
  '👎', '😐', '🤮', '🥶', '🥵', '😈', '👻', '🚀',
];

/** A grid of emoji in a popover around whatever trigger is passed in. */
export function EmojiPicker({ label, onPick, children, className }: { label: string; onPick: (emoji: string) => void; children: ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover isOpen={open} onOpenChange={setOpen}>
      <Popover.Trigger aria-label={label} className={className}>
        {children}
      </Popover.Trigger>
      <Popover.Content placement="top end" className="w-[328px]">
        <Popover.Dialog aria-label={label} className="grid grid-cols-8 gap-0.5 p-2">
          {EMOJI.map((e) => (
            <button
              key={e}
              onClick={() => {
                onPick(e);
                setOpen(false);
              }}
              className="flex h-9 w-9 items-center justify-center rounded-full text-[22px] transition-colors hover:bg-white/10"
            >
              {e}
            </button>
          ))}
        </Popover.Dialog>
      </Popover.Content>
    </Popover>
  );
}
