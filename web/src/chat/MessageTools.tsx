import { useEffect, useState } from 'react';
import { Dropdown, Popover } from '@heroui/react';
import { api } from '../api';
import { applyUnreadMarker, getSessionEpoch, patchMessage, showError, useStore } from '../store';
import { useT } from '../i18n';
import { EmojiText } from '../ui/EmojiText';
import type { Message } from '../types';
import { BookmarkIcon, EllipsisHorizontalIcon } from '@heroicons/react/24/solid';
import { copyMessageLink, openMessage } from './messageNavigation';

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

export function MessageTools({message, className}: {message: Message; className: string}) {
  const { t } = useT();
  const allowed = useStore(s => !message.dm && s.permissions.includes('manageMessages'));
  const action = async (id: string) => {
    const epoch = getSessionEpoch();
    try {
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
  return <Dropdown><Dropdown.Trigger aria-label={t('chat.actions')} className={className}><EllipsisHorizontalIcon className="size-[18px]" aria-hidden="true" /></Dropdown.Trigger>
    <Dropdown.Popover><Dropdown.Menu aria-label={t('chat.actions')} onAction={key => void action(String(key))}>
      <Dropdown.Item id="unread">{t('chat.tools.unread')}</Dropdown.Item>
      <Dropdown.Item id="link">{t('chat.tools.link')}</Dropdown.Item>
      {allowed && <Dropdown.Item id="pin">{t(message.pinned ? 'chat.tools.unpin' : 'chat.tools.pin')}</Dropdown.Item>}
    </Dropdown.Menu></Dropdown.Popover></Dropdown>;
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
