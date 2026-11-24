export type MicTestError = 'unsupported' | 'denied' | 'missing' | 'capture' | 'output' | 'play';

export class MicTestFailure extends Error {
  constructor(readonly reason: MicTestError) {
    super(reason);
  }
}

export const supportsMicTest = () =>
  typeof navigator.mediaDevices?.getUserMedia === 'function' && typeof AudioContext === 'function';

export const supportsOutputSelection = () => typeof HTMLMediaElement.prototype.setSinkId === 'function';

/** Monitor a private microphone stream. Its only destination is this browser's audio output. */
export async function runMicTest({ inputId, outputId, signal, onStarted, onLevel }: {
  inputId: string;
  outputId: string;
  signal: AbortSignal;
  onStarted: () => void;
  onLevel: (level: number) => void;
}): Promise<void> {
  if (!supportsMicTest()) throw new MicTestFailure('unsupported');
  signal.throwIfAborted();
  const context = new AudioContext();
  let stream: MediaStream | undefined;
  let source: MediaStreamAudioSourceNode | undefined;
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
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
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
    const tracks = stream.getAudioTracks();
    source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    const delay = context.createDelay();
    const volume = context.createGain();
    delay.delayTime.value = 0.18;
    volume.gain.value = 0.65;
    const monitor = source.connect(analyser).connect(delay).connect(volume);
    if (outputId === 'default') {
      monitor.connect(context.destination);
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
      monitor.connect(playback);
      try {
        await player.play();
      } catch {
        throw new MicTestFailure('play');
      }
      signal.throwIfAborted();
    }
    if (!tracks.length || tracks.some((track) => track.readyState === 'ended')) throw new MicTestFailure('missing');
    const waveform = new Float32Array(analyser.fftSize);
    meterTimer = setInterval(() => {
      analyser.getFloatTimeDomainData(waveform);
      const rms = Math.sqrt(waveform.reduce((sum, x) => sum + x * x, 0) / waveform.length);
      const db = 20 * Math.log10(rms);
      onLevel(Math.round(Math.max(0, Math.min(100, (db + 60) * (100 / 60)))));
    }, 80);
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
