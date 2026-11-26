import { getPreferredDevice } from './devices';

/**
 * The microphone's loudness in dBFS, read from a capture of our own that no processor and no mute touches: the settings'
 * meter and the sensitivity gate both listen to it, so the gate can tell a voice is back while the call's own
 * track is being held silent. One capture is shared by everyone who listens, and it ends with the last of them.
 */

type Listener = (db: number) => void;

const listeners = new Set<Listener>();
let running: { stop: () => void; device: string | undefined } | null = null;
let starting = 0;

export function watchMic(listener: Listener): () => void {
  listeners.add(listener);
  if (!running && !starting) void start();
  return () => {
    listeners.delete(listener);
    if (!listeners.size) stop();
  };
}

function stop() {
  starting++;
  running?.stop();
  running = null;
}

async function start() {
  const ticket = ++starting;
  const device = getPreferredDevice('audioinput');
  let stream: MediaStream;
  try {
    // Echo cancelled like what goes into the call, so the people you hear don't count as you speaking; no suppression
    // and no gain control, so the numbers are the microphone's own.
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { deviceId: device ? { exact: device } : undefined, echoCancellation: true, noiseSuppression: false, autoGainControl: false },
    });
  } catch {
    if (ticket === starting) starting = 0;
    return;
  }
  if (ticket !== starting || !listeners.size) {
    stream.getTracks().forEach((track) => track.stop());
    return;
  }
  const context = new AudioContext();
  void context.resume().catch(() => undefined);
  const source = context.createMediaStreamSource(stream);
  const analyser = context.createAnalyser();
  analyser.fftSize = 1024;
  source.connect(analyser);
  const samples = new Float32Array(analyser.fftSize);
  const timer = window.setInterval(() => {
    // Another microphone was picked: start over on it.
    if (getPreferredDevice('audioinput') !== device) {
      stop();
      if (listeners.size) void start();
      return;
    }
    analyser.getFloatTimeDomainData(samples);
    let sum = 0;
    for (const sample of samples) sum += sample * sample;
    const db = 10 * Math.log10(sum / samples.length || 1e-12);
    for (const listener of listeners) listener(Math.max(-100, db));
  }, 25);
  running = {
    device,
    stop: () => {
      window.clearInterval(timer);
      source.disconnect();
      stream.getTracks().forEach((track) => track.stop());
      void context.close();
    },
  };
  starting = 0;
}
