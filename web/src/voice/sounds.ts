import { createUISFX, type CueName, type PlayingSFX } from 'uisfx';
import { useStore } from '../store';

/*
 * Interface sounds from uisfx's "minimal" pack (MIT code, CC0 audio): dry, short, almost invisible.
 * The runtime synthesizes them in the browser, so nothing is downloaded.
 */
const ui = createUISFX({ pack: 'minimal', volume: 0.6 });

// Browsers only allow audio after the person has done something on the page.
if (typeof window !== 'undefined') {
  const unlock = () => {
    ui.unlock().catch(() => undefined);
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
  };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);
}

// What each moment in Gomex sounds like. Paired moments use paired cues (on/off, start/stop).
const CUES = {
  join: 'connect',
  leave: 'disconnect',
  message: 'receive',
  mention: 'mention',
  mute: 'toggle-off',
  unmute: 'toggle-on',
  deafen: 'sleep',
  undeafen: 'wake',
  mediaOn: 'start',
  mediaOff: 'stop',
  ringIn: 'notification',
} satisfies Record<string, CueName>;

export type SoundKind = keyof typeof CUES;

/** `force` plays even while deafened — used for the deafen cue itself. */
export function playSound(kind: SoundKind, { force = false } = {}) {
  if (!force && useStore.getState().deafened) return;
  try {
    ui.play(CUES[kind]);
  } catch {
    // Audio is a nicety; never let it break the app.
  }
}

/**
 * Ring until the returned function is called: an incoming call repeats a notification (and sounds even while
 * deafened), an outgoing one plays the pack's "connecting" loop.
 */
export function startRing(kind: 'ringIn' | 'ringOut'): () => void {
  if (kind === 'ringOut') {
    let loop: PlayingSFX | null = null;
    if (!useStore.getState().deafened) {
      try {
        loop = ui.play('connecting');
      } catch {
        loop = null;
      }
    }
    return () => loop?.stop();
  }
  const play = () => playSound('ringIn', { force: true });
  play();
  const timer = setInterval(play, 2200);
  return () => clearInterval(timer);
}
