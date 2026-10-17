import { api, setToken } from '../api';
import { disconnectSocket } from '../socket';
import { leaveVoice } from '../voice/voice';

export async function logout() {
  await leaveVoice({ silent: true });
  disconnectSocket();
  // Signing out ends the session on every device: a token lives 180 days and can't be revoked alone, so this is
  // what makes a copied or forgotten one stop working. It also drops the HttpOnly media cookie (JS can't); if the
  // token is already dead, the plain logout still drops the cookie.
  await api.logoutAll().catch(() => api.logout()).catch(() => {});
  setToken(null);
  window.location.reload();
}
