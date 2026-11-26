import { useStore } from '../store';
import { watchMic } from './micLevel';
import { micTrack } from './noise';

/**
 * Input sensitivity, as in Discord: below the threshold nothing of the microphone goes into the call. Done by switching
 * the track that is sent off and on (a disabled track is silence), so whatever noise mode is on stays as it is. Off
 * (the default: no automatic mode, the slider at its far left) the gate does nothing at all and the track is left alone.
 */

const HOLD_MS = 450;
/** Closing waits for a little under the level that opened the gate, so a voice on the edge doesn't flutter. */
const CLOSE_MARGIN_DB = 3;
/** Automatic: how far above the room's own noise a voice must be. */
const AUTO_ABOVE_DB = 12;

let stopWatching: (() => void) | null = null;
let open = true;
let heldByGate: MediaStreamTrack | null = null;
let lastLoud = 0;
let floor = -70;

function release() {
  if (heldByGate) heldByGate.enabled = true;
  heldByGate = null;
  open = true;
}

function onLevel(db: number) {
  const { voicePrefs } = useStore.getState();
  const track = micTrack();
  const sent = track?.mediaStreamTrack;
  if (!track || !sent || track.isMuted) return;
  // The track can be replaced (a new microphone, the strong processor): whatever we held is let go.
  if (heldByGate && heldByGate !== sent) release();

  if (!voicePrefs.autoSensitivity && voicePrefs.sensitivity <= -100) {
    if (heldByGate) release();
    return;
  }
  // The noise floor of the room: follows a quiet moment down quickly and creeps up slowly.
  floor = db < floor ? floor * 0.8 + db * 0.2 : floor + 0.01;
  const threshold = voicePrefs.autoSensitivity ? Math.min(-25, Math.max(-75, floor + AUTO_ABOVE_DB)) : voicePrefs.sensitivity;

  const now = performance.now();
  if (db > threshold) {
    lastLoud = now;
    open = true;
  } else if (open && db < threshold - CLOSE_MARGIN_DB && now - lastLoud > HOLD_MS) {
    open = false;
  }
  sent.enabled = open;
  heldByGate = open ? null : sent;
}

useStore.subscribe((state) => {
  const inCall = state.voiceStatus === 'connected';
  if (inCall && !stopWatching) stopWatching = watchMic(onLevel);
  else if (!inCall && stopWatching) {
    stopWatching();
    stopWatching = null;
    release();
  }
});
