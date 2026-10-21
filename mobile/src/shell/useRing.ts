import { useEffect } from 'react';
import { startRinging } from '../haptics';
import { useStore } from '../store';
import { useVoice } from '../voice';

const GIVE_UP = 45_000;

/**
 * While someone is ringing you (and you're not already in that call), the phone rings in your hand on any screen:
 * the ring haptic every 1.6 s, until you answer, decline, they hang up, or 45 s pass.
 */
export function useRing() {
  const ringing = useStore((s) => {
    const meId = s.data?.me.id;
    return Object.values(s.calls).some((c) => !!meId && c.ringing.includes(meId) && c.dmId !== useVoice.getState().channelId);
  });
  useEffect(() => {
    if (!ringing) return;
    const stop = startRinging();
    const timeout = setTimeout(stop, GIVE_UP);
    return () => { clearTimeout(timeout); stop(); };
  }, [ringing]);
}
