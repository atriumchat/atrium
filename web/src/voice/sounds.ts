import { useStore } from '../store';

/*
 * Atrium's interface sounds: one instrument for every moment (a deep FM percussion voice made in FL Studio, with a
 * short room), rendered to short files in public/sounds. Paired moments are one motif played up and down, so the ear
 * learns them as pairs: join/leave, mute/unmute, deafen/undeafen, camera or screen on/off.
 */
const KINDS = [
  'join', 'leave', 'message', 'mention', 'mute', 'unmute', 'deafen', 'undeafen', 'mediaOn', 'mediaOff', 'ringIn', 'ringOut',
] as const;

export type SoundKind = (typeof KINDS)[number];

// How often a ring repeats (the files themselves are under a second).
const RING_IN_EVERY_MS = 2200;
const RING_OUT_EVERY_MS = 2000;

let ctx: AudioContext | null = null;
const buffers = new Map<SoundKind, Promise<AudioBuffer | null>>();

function context(): AudioContext | null {
  if (ctx) return ctx;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  ctx = new Ctor();
  return ctx;
}

/** Fetched and decoded once; a failed load is forgotten, so the next play tries again. */
function load(kind: SoundKind): Promise<AudioBuffer | null> {
  let buffer = buffers.get(kind);
  if (!buffer) {
    buffer = fetch(`${import.meta.env.BASE_URL}sounds/${kind}.mp3`)
      .then((res) => (res.ok ? res.arrayBuffer() : Promise.reject(new Error(String(res.status)))))
      .then((data) => context()?.decodeAudioData(data) ?? null)
      .catch(() => {
        buffers.delete(kind);
        return null;
      });
    buffers.set(kind, buffer);
  }
  return buffer;
}

// Browsers only allow audio after the person has done something on the page: wake the context then, and fetch the
// sounds while we're at it, so the first one plays without a gap.
if (typeof window !== 'undefined') {
  const unlock = () => {
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
    context()?.resume().catch(() => undefined);
    KINDS.forEach((kind) => void load(kind));
  };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);
}

/** Plays a sound and returns a way to cut it short. */
function play(kind: SoundKind): () => void {
  const audio = context();
  if (!audio) return () => undefined;
  let source: AudioBufferSourceNode | null = null;
  let stopped = false;
  void load(kind).then((buffer) => {
    if (!buffer || stopped) return;
    if (audio.state === 'suspended') audio.resume().catch(() => undefined);
    source = audio.createBufferSource();
    source.buffer = buffer;
    source.connect(audio.destination);
    source.start();
  });
  return () => {
    stopped = true;
    try {
      source?.stop();
    } catch {
      // Already finished.
    }
  };
}

/** `force` plays even while deafened — used for the deafen cue itself. */
export function playSound(kind: SoundKind, { force = false } = {}) {
  if (!force && useStore.getState().deafened) return;
  try {
    play(kind);
  } catch {
    // Audio is a nicety; never let it break the app.
  }
}

/**
 * Ring until the returned function is called: an incoming call repeats its ring (and sounds even while deafened), an
 * outgoing one repeats a softer one while you wait, unless you are deafened.
 */
export function startRing(kind: 'ringIn' | 'ringOut'): () => void {
  const force = kind === 'ringIn';
  let stopCurrent = () => {};
  const ring = () => {
    if (!force && useStore.getState().deafened) return;
    stopCurrent = play(kind);
  };
  ring();
  const timer = setInterval(ring, kind === 'ringIn' ? RING_IN_EVERY_MS : RING_OUT_EVERY_MS);
  return () => {
    clearInterval(timer);
    stopCurrent();
  };
}
