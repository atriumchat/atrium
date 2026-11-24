import { XMarkIcon } from '@heroicons/react/24/solid';
import { ChatView } from '../chat/ChatView';
import { MessageSearchButton } from '../chat/MessageSearch';
import { PinsButton } from '../chat/MessageTools';
import { useT } from '../i18n';
import { SidePanel, type SidePanelLayout } from '../shell/SidePanel';
import { setVoiceChat } from '../store';
import type { Channel } from '../types';

export function RoomChat({ channel, layout }: { channel: Channel; layout: SidePanelLayout }) {
  const { t } = useT();

  function close() {
    setVoiceChat(false);
    requestAnimationFrame(() => document.getElementById(`room-chat-trigger-${channel.id}`)?.focus({ preventScroll: true }));
  }

  return (
    <SidePanel
      id={`room-chat-${channel.id}`}
      title={t('voice.chat.title')}
      layout={layout}
      kind="chat"
      onClose={layout === 'cover' ? undefined : close}
      actions={
        <>
          <PinsButton channel={channel.id} />
          <button type="button" className="header-action" aria-label={t('voice.chat.close')} onClick={close}>
            <XMarkIcon aria-hidden="true" />
          </button>
          {layout === 'cover' && <MessageSearchButton />}
        </>
      }
    >
      <ChatView key={channel.id} conversation={{ id: channel.id, kind: 'channel', title: channel.name }} room />
    </SidePanel>
  );
}
