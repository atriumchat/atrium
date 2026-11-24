import { api } from '../api';
import { getNavigationRevision, getSessionEpoch, openDm, refreshDms, selectChannel, setVoiceChat, showError, useStore } from '../store';
import { t } from '../i18n';
import { copyText } from './imageCopy';

let request = 0;

export function copyMessageLink(id: string) {
  const url = new URL('/', location.origin);
  url.hash = 'message=' + encodeURIComponent(id);
  copyText(url.href);
}

export async function openMessage(id: string, navigate = true, active = () => true) {
  const ticket = ++request;
  const epoch = getSessionEpoch();
  const revision = getNavigationRevision();
  const current = () => active() && ticket === request && epoch === getSessionEpoch() && revision === getNavigationRevision();
  try {
    const messages = await api.messageContext(id);
    const target = messages.find(m => m.id === id);
    if (!target || !current()) return false;
    if (target.dm && !useStore.getState().dms.some(d => d.id === target.channelId)) await refreshDms();
    if (!current()) return false;
    const state = useStore.getState();
    const channel = state.channels.find(c => c.id === target.channelId);
    if (target.dm ? !state.dms.some(d => d.id === target.channelId) : !channel) throw new Error(t('chat.search.gone'));
    if (navigate) {
      if (target.dm) openDm(target.channelId);
      else {
        selectChannel(target.channelId);
        if (channel?.kind === 'voice') setVoiceChat(true);
      }
    }
    const cached = state.messages[target.channelId]?.some(m => m.id === id);
    useStore.setState({jumpTo: id, searchContext: cached ? null : {conversation: target.channelId, messages}});
    return true;
  } catch (error) {
    if (current()) showError(error instanceof Error ? error.message : t('chat.search.gone'));
    return false;
  }
}
