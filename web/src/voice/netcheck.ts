import { toast } from '@heroui/react';
import { useStore } from '../store';
import { setVoicePrefs } from './voice';
import { attempt } from './ConnectionCheck';

const CHECKED = 'gomex_net_checked';

/**
 * The first time Gomex runs on a device (right after sign-up, or a new device), quietly try a call: if it
 * goes through directly, leave things as they are; if only the relay on 443 gets through — a restrictive
 * network — switch the relay on so the person's first call just works. Once per device: the network depends
 * on where they sit, and they can flip the switch themselves any time.
 */
export async function firstRunNetCheck() {
  try {
    if (localStorage.getItem(CHECKED)) return;
  } catch {
    return;
  }
  const { serverRelayOnly, voicePrefs } = useStore.getState();
  const remember = () => {
    try {
      localStorage.setItem(CHECKED, String(Date.now()));
    } catch {
      // Private mode: it checks again next time, which is harmless.
    }
  };
  if (serverRelayOnly || voicePrefs.relayOnly) return remember();

  const direct = await attempt(false);
  if (direct.state === 'ok') return remember();
  const relay = await attempt(true);
  if (relay.state !== 'ok') return; // Nothing gets through right now; try again on the next launch.
  remember();
  // Don't swap paths under a call that's already going.
  if (useStore.getState().voiceStatus !== 'idle') return;
  await setVoicePrefs({ relayOnly: true });
  toast.success('Антилаг включён');
}
