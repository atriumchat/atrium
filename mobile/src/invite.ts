import { Share } from 'react-native';
import { api, getCredentials } from './api';
import { showError } from './store';

/** A fresh invite to the server, handed to the system share sheet as a link. */
export async function shareInvite() {
  try {
    const item = await api.invite();
    await Share.share({ message: `${getCredentials()!.server}/?invite=${encodeURIComponent(item.code)}` });
  } catch (e) { showError(e); }
}
