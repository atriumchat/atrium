import { useEffect, useRef, useState } from 'react';
import { Popover } from '@heroui/react';
import { api } from '../api';
import { applyUnreadMarker, getSessionEpoch, patchMessage, showError, useStore } from '../store';
import { useT } from '../i18n';
import { EmojiText } from '../ui/EmojiText';
import { EmojiGrid } from '../ui/EmojiPicker';
import { mentionsToNames } from '../ui/Markdown';
import { ContextMenu, Menu, MenuItem, MenuSeparator, useContextMenu, type MenuSpec } from '../ui/Menu';
import { CopyIcon, LinkIcon, PencilIcon, PinIcon, ReplyIcon, SmileIcon, TrashIcon, UnreadIcon } from '../ui/icons';
import type { Message } from '../types';
import { BookmarkIcon, EllipsisHorizontalIcon } from '@heroicons/react/24/solid';
import { copyMessageLink, openMessage } from './messageNavigation';
import { copyText } from './imageCopy';

export function MessageRoute() {
  useEffect(() => {
    let active = true;
    const follow = () => {
      const id = new URLSearchParams(location.hash.slice(1)).get('message');
      if (id) void openMessage(id, true, () => active && new URLSearchParams(location.hash.slice(1)).get('message') === id).then(opened => {
        if (opened && active && new URLSearchParams(location.hash.slice(1)).get('message') === id) history.replaceState(history.state, '', location.pathname + location.search);
      });
    };
    follow();
    window.addEventListener('hashchange', follow);
    return () => { active = false; window.removeEventListener('hashchange', follow); };
  }, []);
  return null;
}

/** The three reactions one tap away on a message, in its hover bar and at the top of its menu. */
export const QUICK_REACTIONS = ['👍', '❤️', '😂'];

type MessageActions = { onReact: (emoji: string) => void; onReply: () => void; onEdit?: () => void; onDelete?: () => void };

/** What is selected inside this message, if anything: "Copy" then copies that rather than the whole text. */
function selectedIn(messageId: string) {
  const selection = window.getSelection();
  const box = document.getElementById(`msg-${messageId}`);
  if (!selection || selection.isCollapsed || !box?.contains(selection.anchorNode)) return '';
  return selection.toString().trim();
}

/**
 * The one menu of a message: the "..." in its hover bar and a right-click on it open the same rows. `spec(close)` is
 * the menu, `bind` goes on the message's element, `node` (the context menu and the emoji list the menu can open)
 * is rendered inside it.
 */
export function useMessageMenu(message: Message, actions: MessageActions) {
  const { t } = useT();
  const allowed = useStore(s => !message.dm && s.permissions.includes('manageMessages'));
  const [picking, setPicking] = useState(false);

  const run = async (id: string) => {
    const epoch = getSessionEpoch();
    try {
      if (id === 'react') setTimeout(() => setPicking(true), 0);
      if (id === 'reply') actions.onReply();
      if (id === 'edit') actions.onEdit?.();
      if (id === 'delete') actions.onDelete?.();
      if (id === 'copy') copyText(selectedIn(message.id) || mentionsToNames(message.content ?? '', useStore.getState().users));
      if (id === 'link') copyMessageLink(message.id);
      if (id === 'unread') {
        const event = await api.markUnread(message.id);
        if (epoch === getSessionEpoch()) applyUnreadMarker(event);
      }
      if (id === 'pin') {
        await api.setPin(message.channelId, message.id, !message.pinned);
        if (epoch === getSessionEpoch()) {
          patchMessage(message.channelId, message.id, { pinned: !message.pinned });
          window.dispatchEvent(new CustomEvent('atrium:pins', {detail: message.channelId}));
        }
      }
    } catch (e) { if (epoch === getSessionEpoch()) showError(String(e)); }
  };

  const spec = (close: () => void): MenuSpec => ({
    label: t('chat.actions'),
    onAction: key => void run(key),
    header: (
      <div role="group" aria-label={t('chat.addReaction')} className="flex gap-1 px-2 pt-2">
        {QUICK_REACTIONS.map(emoji => (
          <button key={emoji} type="button" onClick={() => { close(); actions.onReact(emoji); }} aria-label={t('chat.reaction', { emoji })}
            className="grid size-9 place-items-center rounded-full text-[18px] outline-none hover:bg-default focus-visible:ring-2 focus-visible:ring-focus">
            <EmojiText text={emoji} />
          </button>
        ))}
      </div>
    ),
    children: [
      <MenuItem key="react" id="react" label={t('chat.addReaction')} icon={<SmileIcon />} />,
      <MenuItem key="reply" id="reply" label={t('chat.reply')} icon={<ReplyIcon />} />,
      actions.onEdit && <MenuItem key="edit" id="edit" label={t('chat.edit')} icon={<PencilIcon />} />,
      !!message.content && <MenuItem key="copy" id="copy" label={t('chat.menu.copyText')} icon={<CopyIcon />} />,
      allowed && <MenuItem key="pin" id="pin" label={t(message.pinned ? 'chat.tools.unpin' : 'chat.tools.pin')} icon={<PinIcon />} />,
      <MenuItem key="unread" id="unread" label={t('chat.tools.unread')} icon={<UnreadIcon />} />,
      <MenuItem key="link" id="link" label={t('chat.tools.link')} icon={<LinkIcon />} />,
      actions.onDelete && <MenuSeparator key="separator" />,
      actions.onDelete && <MenuItem key="delete" id="delete" label={t('chat.delete')} icon={<TrashIcon />} danger />,
    ],
  });

  const context = useContextMenu(({ point, close }) => <ContextMenu point={point} onClose={close} {...spec(close)} />);
  const node = (
    <>
      {context.menu}
      {picking && <ReactionPicker message={message} onPick={actions.onReact} onClose={() => setPicking(false)} />}
    </>
  );
  // A link, a picture or a file keeps its own menu; so does a profile name or avatar.
  const bind = context.bind(null, { skip: e => !!(e.target as HTMLElement).closest('a, img, video') });
  return { spec, bind, node };
}

/** The full emoji list for "Add reaction", hung off the message itself. */
function ReactionPicker({ message, onPick, onClose }: { message: Message; onPick: (emoji: string) => void; onClose: () => void }) {
  const { t } = useT();
  const anchor = useRef<HTMLElement | null>(document.getElementById(`msg-${message.id}`));
  return (
    <Popover isOpen onOpenChange={open => !open && onClose()}>
      <Popover.Content triggerRef={anchor} placement="bottom end" className="w-[328px] max-w-[calc(100vw-24px)]">
        <Popover.Dialog aria-label={t('chat.addReaction')} className="p-2">
          <EmojiGrid custom onPick={emoji => { onClose(); onPick(emoji); }} />
        </Popover.Dialog>
      </Popover.Content>
    </Popover>
  );
}

export function MessageTools({menu, className}: {menu: ReturnType<typeof useMessageMenu>; className: string}) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  return <Menu {...menu.spec(() => setOpen(false))} isOpen={open} onOpenChange={setOpen} triggerLabel={t('chat.actions')} triggerClassName={className}
    trigger={<EllipsisHorizontalIcon className="size-[18px]" aria-hidden="true" />} />;
}

export function PinsButton({channel}: {channel: string}) {
  const {t} = useT();
  const [open,setOpen] = useState(false);
  const [items,setItems] = useState<Message[] | null>(null);
  const [failed,setFailed] = useState(false);
  const [revision,bump] = useState(0);
  const users = useStore(s => s.users);
  const blocked = useStore(s => s.blocked);
  useEffect(() => {
    if (!open) return;
    let active = true;
    setFailed(false);
    api.pins(channel).then(rows => {if (active) setItems(rows);}, () => {if (active) { setFailed(true); setItems(null); }});
    const changed = (event: Event) => {if ((event as CustomEvent).detail === channel) bump(n => n + 1);};
    window.addEventListener('atrium:pins', changed);
    return () => { active = false; window.removeEventListener('atrium:pins', changed); };
  }, [open, channel, revision]);
  return <Popover isOpen={open} onOpenChange={v => {setOpen(v); if (v) setItems(null);}}>
    <Popover.Trigger className="header-action" aria-label={t('chat.tools.pins')} title={t('chat.tools.pins')}><BookmarkIcon className="size-5" aria-hidden="true" /></Popover.Trigger>
    <Popover.Content placement="bottom end" className="w-80 max-w-[90vw]"><Popover.Dialog aria-label={t('chat.tools.pins')} className="max-h-[65vh] overflow-y-auto p-2">
      <h2 className="px-3 pb-2 pt-1 font-medium">{t('chat.tools.pins')}</h2>
      {failed ? <button onClick={() => bump(n => n+1)}>{t('chat.retryHistory')}</button> : !items?.length ?
        <p className="px-2 py-3 text-sm text-muted">{t(items ? 'chat.tools.noPins' : 'people.inbox.loading')}</p> :
        items.map(m => <button key={m.id} className="block w-full rounded-row px-3 py-2 text-left outline-none hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus" onClick={() => {setOpen(false); void openMessage(m.id);}}>
          <span className="block text-sm font-medium">{users[m.userId]?.name}</span><span className="line-clamp-2 text-sm text-muted"><EmojiText text={blocked.includes(m.userId) ? t('chat.blocked.label') : m.content || t('chat.attachment')} /></span>
        </button>)}
    </Popover.Dialog></Popover.Content>
  </Popover>;
}
