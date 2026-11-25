import { loadGtcrn, loadRnnoise } from '@sapphi-red/web-noise-suppressor';
import rnnoiseWorkletUrl from '@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url';
import rnnoiseWasmUrl from '@sapphi-red/web-noise-suppressor/rnnoise.wasm?url';
import rnnoiseSimdUrl from '@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url';
import gtcrnWorkletUrl from '@sapphi-red/web-noise-suppressor/gtcrnWorklet.js?url';
import gtcrnWasmUrl from '@sapphi-red/web-noise-suppressor/gtcrn.wasm?url';

/**
 * The strong noise suppressor on its own, with no LiveKit in sight: one 48 kHz context, one node, and a check that
 * the node really produces sound before it is put on a microphone. The call and the microphone test both use it.
 *
 * The worklet loads its WASM asynchronously and sends silence until it is ready; an error inside the worklet is not
 * reported to the page at all. That is why `buildSuppressor` runs a second of white noise through the node and waits
 * for it at the output: a node that stays silent is a failure we can see, not a call nobody can hear.
 */

export type Engine = 'rnnoise' | 'gtcrn';

/** The engine behind "Strong": GTCRN removes keyboard clicks and steady noise that RNNoise passes through. RNNoise stays as a one-line rollback. */
export const STRONG_ENGINE: Engine = 'gtcrn';
/** An off switch for the whole "Strong" mode, for a quick rollback: the saved setting stays, it just reads as "Standard". */
export const STRONG_ENABLED = true;

export type NoiseReason = 'unsupported' | 'samplerate' | 'context' | 'wasm' | 'worklet' | 'silent' | 'sender';

export class NoiseFailure extends Error {
  constructor(readonly reason: NoiseReason, detail?: unknown) {
    super(detail instanceof Error ? detail.message : detail === undefined ? reason : String(detail));
    this.name = 'NoiseFailure';
  }
}

/** What counts as silence at the output: about −120 dBFS, so a denormal or a real zero, not a quiet room. */
export const SILENT_PEAK = 1e-6;

const RATE = 48_000;
const SELF_TEST_MS = 4_000;
const SELF_TEST_AMPLITUDE = 0.03; // ≈ −35 dBFS: loud enough for the worklet to pass through, quiet in headphones

/**
 * What sits after the model in "Strong": the model takes some of the voice's energy with the noise, so the output
 * comes back thin and quiet. Everything here is for the owner to tune by ear in one place — the microphone check in
 * Settings plays this same chain.
 */
const STRONG_POST = {
  highpass: { frequency: 80, q: 0.7 }, // rumble and desk bumps below the voice
  compressor: { threshold: -28, knee: 8, ratio: 4, attack: 0.004, release: 0.18 },
  makeupDb: 10, // ≈ 3.16×, bringing the compressed voice back up
  limiter: { threshold: -2, knee: 0, ratio: 20, attack: 0.001, release: 0.08 }, // nothing clipped on the way out
} as const;

const ENGINES = {
  rnnoise: {
    processor: '@sapphi-red/web-noise-suppressor/rnnoise',
    module: rnnoiseWorkletUrl,
    load: () => loadRnnoise({ url: rnnoiseWasmUrl, simdUrl: rnnoiseSimdUrl }),
  },
  gtcrn: {
    processor: '@sapphi-red/web-noise-suppressor/gtcrn',
    module: gtcrnWorkletUrl,
    load: () => loadGtcrn({ url: gtcrnWasmUrl }),
  },
} as const;

const binaries = new Map<Engine, Promise<ArrayBuffer>>();
const loadedModules = new WeakSet<BaseAudioContext>();

function storedFault(): string {
  try {
    return localStorage.getItem('atrium_noise_fault') ?? '';
  } catch {
    return '';
  }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Nothing here may hang: a worklet module that never loads would leave "Strong" starting forever, with no sound of it. */
async function withTimeout<T>(work: Promise<T>, ms: number, reason: NoiseReason, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new NoiseFailure(reason, `${what} timed out`)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** An AudioContext the strong suppression can run in: 48 kHz, as RNNoise is trained for, and no other rate pretending. */
export function createStrongContext(): AudioContext {
  if (typeof AudioContext === 'undefined') throw new NoiseFailure('unsupported', 'no AudioContext');
  let ctx: AudioContext;
  try {
    ctx = new AudioContext({ sampleRate: RATE, latencyHint: 'interactive' });
  } catch (e) {
    throw new NoiseFailure('unsupported', e);
  }
  if (ctx.sampleRate !== RATE) {
    void ctx.close().catch(() => undefined);
    throw new NoiseFailure('samplerate', `${ctx.sampleRate} Hz`);
  }
  if (!ctx.audioWorklet) {
    void ctx.close().catch(() => undefined);
    throw new NoiseFailure('unsupported', 'no AudioWorklet');
  }
  return ctx;
}

/** Runs the context, waiting at most `timeoutMs` for a browser that will not start it without a click. */
export async function startContext(ctx: AudioContext, timeoutMs = 3_000): Promise<void> {
  if (ctx.state === 'running') return;
  // Safari has "interrupted" on top of "suspended": resume() is the way out of both, when the page is allowed to.
  await Promise.race([ctx.resume().catch(() => undefined), sleep(timeoutMs)]);
  // Read through a function: the state is changed by the browser, not by anything TypeScript can see.
  const now = (): AudioContextState => ctx.state;
  if (now() !== 'running') throw new NoiseFailure('context', now());
}

function engineBinary(engine: Engine): Promise<ArrayBuffer> {
  let binary = binaries.get(engine);
  if (!binary) {
    if (storedFault() === 'wasm') {
      binary = Promise.reject(new NoiseFailure('wasm', 'injected'));
    } else {
      binary = ENGINES[engine].load().catch((e) => {
        binaries.delete(engine);
        throw new NoiseFailure('wasm', e);
      });
    }
    binaries.set(engine, binary);
  }
  return binary;
}

/** The WASM itself, checked here: a 404 page or a CSP without WebAssembly fails loudly instead of silencing the node. */
async function checkedBinary(engine: Engine): Promise<ArrayBuffer> {
  const binary = await withTimeout(engineBinary(engine), 15_000, 'wasm', 'download');
  try {
    await withTimeout(WebAssembly.compile(binary), 5_000, 'wasm', 'compile');
  } catch (e) {
    binaries.delete(engine);
    throw e instanceof NoiseFailure ? e : new NoiseFailure('wasm', e);
  }
  return binary;
}

/** A level meter that is pulled by the graph: an analyser on its own is never asked for samples by the browser. */
export class Meter {
  readonly node: AnalyserNode;
  private readonly sink: GainNode;
  private readonly buffer: Float32Array<ArrayBuffer>;

  constructor(ctx: AudioContext, source: AudioNode) {
    this.node = ctx.createAnalyser();
    this.node.fftSize = 2048;
    this.buffer = new Float32Array(new ArrayBuffer(this.node.fftSize * Float32Array.BYTES_PER_ELEMENT));
    this.sink = ctx.createGain();
    this.sink.gain.value = 0;
    source.connect(this.node).connect(this.sink).connect(ctx.destination);
  }

  read() {
    this.node.getFloatTimeDomainData(this.buffer);
    let peak = 0;
    let sum = 0;
    for (const x of this.buffer) {
      const value = Math.abs(x);
      if (value > peak) peak = value;
      sum += x * x;
    }
    return { peak, rmsDb: 10 * Math.log10(sum / this.buffer.length || 1e-12) };
  }

  /** 0–100, the same scale as the microphone test's ruler: −60 dBFS at the bottom, 0 at the top. */
  level() {
    return Math.round(Math.max(0, Math.min(100, (this.read().rmsDb + 60) * (100 / 60))));
  }

  dispose() {
    this.node.disconnect();
    this.sink.disconnect();
  }
}

export type Suppressor = {
  engine: Engine;
  ctx: AudioContext;
  /** The mono sum of whatever is attached to it. */
  input: GainNode;
  /** The processed sound: what the call or the test plays. */
  output: GainNode;
  meterIn: Meter;
  meterOut: Meter;
  /** How long the node took to prove it produces sound. */
  readyMs: number;
  /** A worklet that crashed after it was built. */
  failure: NoiseReason | null;
  dispose(): void;
};

export function failReason(e: unknown): NoiseReason {
  if (e instanceof NoiseFailure) return e.reason;
  if (e instanceof DOMException && e.name === 'NotSupportedError') return 'samplerate';
  return 'worklet';
}

/** Builds the node, proves it produces sound, and only then hands it over. */
export async function buildSuppressor(ctx: AudioContext, engine: Engine = STRONG_ENGINE): Promise<Suppressor> {
  const config = ENGINES[engine];
  const binary = await checkedBinary(engine);
  if (!loadedModules.has(ctx)) {
    try {
      await withTimeout(ctx.audioWorklet.addModule(config.module), 10_000, 'worklet', 'module');
    } catch (e) {
      throw e instanceof NoiseFailure ? e : new NoiseFailure('worklet', e);
    }
    loadedModules.add(ctx);
  }

  const input = ctx.createGain();
  // One channel in: a stereo interface with the mic on the second input would otherwise lose the voice (only the
  // first channel reaches the network model). "speakers" mixing averages L+R into that one channel (−6 dB if the
  // voice sits on one channel alone, which is why mono microphones are left as they are).
  input.channelCount = 1;
  input.channelCountMode = 'explicit';
  input.channelInterpretation = 'speakers';

  const output = ctx.createGain();
  output.channelCount = 1;
  output.channelCountMode = 'explicit';
  output.channelInterpretation = 'speakers';

  let node: AudioWorkletNode;
  try {
    node = new AudioWorkletNode(ctx, config.processor, {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      // One channel out. The model writes its result into channel 0 only; a stereo node would send a silent right
      // channel, which sounds like a broken or half-dead microphone on headphones.
      outputChannelCount: [1],
      channelCount: 1,
      channelCountMode: 'explicit',
      processorOptions: { wasmBinary: binary, maxChannels: 1 },
    });
  } catch (e) {
    throw new NoiseFailure('worklet', e);
  }

  // After the model: rumble out, level evened, voice brought back up, peaks caught before the call hears them.
  const highpass = ctx.createBiquadFilter();
  highpass.type = 'highpass';
  highpass.frequency.value = STRONG_POST.highpass.frequency;
  highpass.Q.value = STRONG_POST.highpass.q;

  const compressor = ctx.createDynamicsCompressor();
  compressor.threshold.value = STRONG_POST.compressor.threshold;
  compressor.knee.value = STRONG_POST.compressor.knee;
  compressor.ratio.value = STRONG_POST.compressor.ratio;
  compressor.attack.value = STRONG_POST.compressor.attack;
  compressor.release.value = STRONG_POST.compressor.release;

  const makeup = ctx.createGain();
  makeup.gain.value = 10 ** (STRONG_POST.makeupDb / 20);

  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = STRONG_POST.limiter.threshold;
  limiter.knee.value = STRONG_POST.limiter.knee;
  limiter.ratio.value = STRONG_POST.limiter.ratio;
  limiter.attack.value = STRONG_POST.limiter.attack;
  limiter.release.value = STRONG_POST.limiter.release;

  const post = [highpass, compressor, makeup, limiter];
  for (const part of post) {
    part.channelCount = 1;
    part.channelCountMode = 'explicit';
    part.channelInterpretation = 'speakers';
  }

  const suppressor: Suppressor = {
    engine,
    ctx,
    input,
    output,
    meterIn: new Meter(ctx, input),
    meterOut: new Meter(ctx, output),
    readyMs: 0,
    failure: null,
    dispose() {
      input.disconnect();
      node.disconnect();
      for (const part of post) part.disconnect();
      output.disconnect();
      suppressor.meterIn.dispose();
      suppressor.meterOut.dispose();
      try {
        // The packaged worklet listens for this without starting its port, so it usually does not arrive; closing
        // the context is what actually frees the WASM heap.
        node.port.postMessage('destroy');
      } catch {
        // The context is going away anyway.
      }
    },
  };
  node.onprocessorerror = () => {
    suppressor.failure = 'worklet';
  };

  input.connect(node).connect(highpass).connect(compressor).connect(makeup).connect(limiter).connect(output);

  // The proof: white noise in, sound out. A worklet whose WASM failed stays at zero forever, and nothing else in
  // the app could tell that apart from a quiet room.
  const noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const samples = noise.getChannelData(0);
  for (let i = 0; i < samples.length; i++) samples[i] = (Math.random() * 2 - 1) * SELF_TEST_AMPLITUDE;
  const source = ctx.createBufferSource();
  source.buffer = noise;
  source.loop = true;
  source.connect(input);
  source.start();
  const started = performance.now();
  try {
    let heard = false;
    while (performance.now() - started < SELF_TEST_MS) {
      await sleep(50);
      if (ctx.state !== 'running') throw new NoiseFailure('context', ctx.state);
      if (suppressor.meterOut.read().peak > SILENT_PEAK) {
        heard = true;
        break;
      }
    }
    if (!heard) throw new NoiseFailure(ctx.state === 'running' ? 'worklet' : 'context');
  } finally {
    try {
      source.stop();
    } catch {
      // Already stopped.
    }
    source.disconnect();
  }
  suppressor.readyMs = Math.round(performance.now() - started);

  // Test hooks: they break only this device's own sound and are read at build time, so a reload clears them.
  if (storedFault() === 'silent') output.gain.value = 0;
  // A closed context cannot be resumed: this is the failure path, not the "blocked until a click" one.
  if (storedFault() === 'context') setTimeout(() => void ctx.close().catch(() => undefined), 5_000);

  return suppressor;
}
