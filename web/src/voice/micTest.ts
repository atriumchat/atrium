import type { NoiseMode } from '../prefs';
import { captureOptions } from './noise';
import { SILENT_PEAK, STRONG_ENABLED, STRONG_ENGINE, buildSuppressor, createStrongContext, type Suppressor } from './suppressor';

export type MicTestError = 'unsupported' | 'denied' | 'missing' | 'capture' | 'output' | 'play' | 'noise';

export class MicTestFailure extends Error {
  constructor(readonly reason: MicTestError) {
    super(reason);
  }
}

export const supportsMicTest = () =>
  typeof navigator.mediaDevices?.getUserMedia === 'function' && typeof AudioContext === 'function';

export const supportsOutputSelection = () => typeof HTMLMediaElement.prototype.setSinkId === 'function';

/** Monitor a private microphone stream. Its only destination is this browser's audio output. */
export async function runMicTest({ inputId, outputId, noise, signal, onStarted, onLevel }: {
  inputId: string;
  outputId: string;
  /** Run the test through the chosen suppression, so switching the mode really changes what is heard. */
  noise: NoiseMode;
  signal: AbortSignal;
  onStarted: () => void;
  onLevel: (level: number) => void;
}): Promise<void> {
  if (!supportsMicTest()) throw new MicTestFailure('unsupported');
  signal.throwIfAborted();
  const strong = noise === 'rnnoise' && STRONG_ENABLED;
  const mode: NoiseMode = noise === 'rnnoise' && !strong ? 'browser' : noise;
  let context: AudioContext;
  try {
    // The strong mode needs its 48 kHz context; the plain test is fine with the device's own rate.
    context = strong ? createStrongContext() : new AudioContext();
  } catch {
    throw new MicTestFailure('noise');
  }
  let stream: MediaStream | undefined;
  let source: MediaStreamAudioSourceNode | undefined;
  let suppressor: Suppressor | undefined;
  let playback: MediaStreamAudioDestinationNode | undefined;
  let audio: HTMLAudioElement | undefined;
  let meterTimer: ReturnType<typeof setInterval> | undefined;
  let closing = false;
  const release = () => {
    clearInterval(meterTimer);
    audio?.pause();
    if (audio) audio.srcObject = null;
    audio = undefined;
    source?.disconnect();
    source = undefined;
    suppressor?.dispose();
    suppressor = undefined;
    playback?.stream.getTracks().forEach((track) => track.stop());
    playback = undefined;
    stream?.getTracks().forEach((track) => track.stop());
    stream = undefined;
    if (!closing) {
      closing = true;
      void context.close().catch(() => undefined);
    }
  };
  signal.addEventListener('abort', release, { once: true });
  // Resume inside the button gesture so system output also works with strict autoplay settings.
  const resumed = context.resume().then(() => true, () => false);
  try {
    const capture = captureOptions(mode);
    // The test has its own picker; the device remembered in the call settings is not it.
    delete capture.deviceId;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          ...capture,
          ...(inputId !== 'default' && { deviceId: { exact: inputId } }),
        },
      });
    } catch (error) {
      const name = error instanceof DOMException ? error.name : '';
      if (name === 'NotAllowedError' || name === 'SecurityError') throw new MicTestFailure('denied');
      if (name === 'NotFoundError' || name === 'OverconstrainedError') throw new MicTestFailure('missing');
      throw error;
    }
    signal.throwIfAborted();
    if (!(await resumed)) throw new MicTestFailure('play');
    signal.throwIfAborted();

    try {
      source = context.createMediaStreamSource(stream);
    } catch {
      // Firefox refuses a source on a context of another sample rate (bug 1725336): that is the suppressor's limit.
      throw new MicTestFailure(strong ? 'noise' : 'capture');
    }
    let monitor: AudioNode;
    let level: () => number;
    if (strong) {
      try {
        suppressor = await buildSuppressor(context, STRONG_ENGINE);
      } catch {
        throw new MicTestFailure('noise');
      }
      signal.throwIfAborted();
      try {
        source.connect(suppressor.input);
      } catch {
        // Firefox refuses a source at a different sample rate (bug 1725336): that is the suppressor, not the mic.
        throw new MicTestFailure('noise');
      }
      monitor = suppressor.output;
      level = () => suppressor!.meterOut.level();
    } else {
      const analyser = context.createAnalyser();
      const waveform = new Float32Array(new ArrayBuffer(analyser.fftSize * Float32Array.BYTES_PER_ELEMENT));
      monitor = source.connect(analyser);
      level = () => {
        analyser.getFloatTimeDomainData(waveform);
        const rms = Math.sqrt(waveform.reduce((sum, x) => sum + x * x, 0) / waveform.length);
        return Math.round(Math.max(0, Math.min(100, (20 * Math.log10(rms) + 60) * (100 / 60))));
      };
    }
    const delay = context.createDelay();
    const volume = context.createGain();
    delay.delayTime.value = 0.18;
    volume.gain.value = 0.65;
    monitor.connect(delay).connect(volume);
    if (outputId === 'default') {
      volume.connect(context.destination);
    } else {
      playback = context.createMediaStreamDestination();
      const player = new Audio();
      audio = player;
      try {
        await player.setSinkId(outputId);
      } catch {
        throw new MicTestFailure('output');
      }
      signal.throwIfAborted();
      player.srcObject = playback.stream;
      // Attach the signal only after the selected sink is configured.
      volume.connect(playback);
      try {
        await player.play();
      } catch {
        throw new MicTestFailure('play');
      }
      signal.throwIfAborted();
    }
    const tracks = stream.getAudioTracks();
    if (!tracks.length || tracks.some((track) => track.readyState === 'ended')) throw new MicTestFailure('missing');
    let abortTest: ((error: MicTestFailure) => void) | undefined;
    let silentSince = 0;
    let stoppedSince = 0;
    meterTimer = setInterval(() => {
      onLevel(level());
      // The same rule as in a call: loud in, nothing out for two seconds means the suppressor is broken. Safari
      // briefly interrupts a context on its own, so a stopped one only fails the test after a couple of seconds.
      if (!suppressor) return;
      if (context.state !== 'running') {
        if (!stoppedSince) stoppedSince = performance.now();
        else if (performance.now() - stoppedSince > 2_000) abortTest?.(new MicTestFailure('noise'));
        return;
      }
      stoppedSince = 0;
      const input = suppressor.meterIn.read();
      const output = suppressor.meterOut.read();
      if (input.rmsDb > -55 && output.peak < SILENT_PEAK) {
        if (!silentSince) silentSince = performance.now();
        else if (performance.now() - silentSince > 2_000) abortTest?.(new MicTestFailure('noise'));
      } else {
        silentSince = 0;
      }
    }, 1000 / 30);
    await new Promise<void>((resolve, reject) => {
      const player = audio;
      const removeListeners = () => {
        signal.removeEventListener('abort', stop);
        tracks.forEach((track) => track.removeEventListener('ended', disconnected));
        player?.removeEventListener('error', failed);
      };
      const stop = () => { removeListeners(); resolve(); };
      const disconnected = () => { removeListeners(); reject(new MicTestFailure('missing')); };
      const failed = () => { removeListeners(); reject(new MicTestFailure('play')); };
      abortTest = (error) => { removeListeners(); reject(error); };
      signal.addEventListener('abort', stop, { once: true });
      tracks.forEach((track) => track.addEventListener('ended', disconnected, { once: true }));
      player?.addEventListener('error', failed, { once: true });
      onStarted();
    });
  } finally {
    signal.removeEventListener('abort', release);
    release();
  }
}
