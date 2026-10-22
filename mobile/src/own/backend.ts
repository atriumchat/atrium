import { api } from '../api';
import { enter } from '../store';
import { cancelMail, checkDomain, close, connect, loadSaved, readProgress, register, rent, resume, reuse, save, startInstall, waitMail } from './setup';

/**
 * Everything "Your own server" asks of the outside world: the VPS over SSH and deSEC (setup.ts), then the new server's
 * own API for its first run. One object, so the screen can run on mocks instead (mock.ts).
 */
export const real = {
  loadSaved,
  save,
  connect,
  rent,
  resume,
  close,
  register,
  waitMail,
  cancelMail,
  reuse,
  checkDomain,
  startInstall,
  readProgress,
  /** The server's own page answers over HTTPS (a new address may still be spreading). */
  reachable: async (origin: string) => (await fetch(`${origin}/api/setup`, { cache: 'no-store' })).ok,
  setupStatus: api.setupStatus,
  setup: api.setup,
  renameServer: api.renameServer,
  uploadServerIcon: api.uploadServerIcon,
  makeRecoveryKey: api.makeRecoveryKey,
  invite: api.invite,
  enter,
};

export type Backend = typeof real;
