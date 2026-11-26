/**
 * Whether a live call's controls have gone quiet on this screen. The picture's own controls work it out; the channel
 * header above them only needs to know, and to wake them when the pointer crosses it.
 */

let idle = false;
const listeners = new Set<(idle: boolean) => void>();

export function setCallIdle(next: boolean) {
  if (next === idle) return;
  idle = next;
  for (const listener of listeners) listener(next);
}

export function onCallIdle(listener: (idle: boolean) => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Set by the picture: brings the controls (and the header) back at once. */
export let wakeCall: (() => void) | null = null;
export function setWakeCall(wake: (() => void) | null) {
  wakeCall = wake;
}
