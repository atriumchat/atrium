import {
  LocalAudioTrack,
  Track,
  TrackEvent,
  type AudioCaptureOptions,
  type AudioProcessorOptions,
  type TrackProcessor,
} from 'livekit-client';
import { onStoreReset, showError, useStore } from '../store';
import { t, type Key } from '../i18n';
import type { NoiseMode } from '../prefs';
import { getPreferredDevice } from './devices';
import {
  NoiseFailure,
  SILENT_PEAK,
  STRONG_ENABLED,
  STRONG_ENGINE,
  buildSuppressor,
  createStrongContext,
  failReason,
  startContext,
  type Engine,
  type NoiseReason,
  type Suppressor,
} from './suppressor';

/**
 * "Strong" noise suppression in a call: one 48 kHz context per call, one suppressor node for its whole life, and a
 * watchdog that hears the difference between a quiet room and a broken node. The node is checked before it goes on
 * the microphone; if anything fails, the call stays on the browser's own suppression and says so, loudly.
 *
 * LiveKit owns the room's AudioContext and moves tracks onto it at every publish. We deliberately do not build on
 * that one: the graph lives on ours, so a room context of 44.1 kHz or a republish cannot change what the model
 * hears. `StrongProcessor.init/restart` ignore the `audioContext` LiveKit passes for the same reason.
 */

const REASON_KEY: Record<NoiseReason, Key> = {
  unsupported: 'voice.noise.reason.unsupported',
  samplerate: 'voice.noise.reason.samplerate',
  context: 'voice.noise.reason.context',
  wasm: 'voice.noise.reason.wasm',
  worklet: 'voice.noise.reason.worklet',
  silent: 'voice.noise.reason.silent',
  sender: 'voice.noise.reason.sender',
};

const state = () => useStore.getState();
const set = useStore.setState;

type Session = {
  ctx: AudioContext;
  ready: Promise<Suppressor>;
  sup?: Suppressor;
  closed: boolean;
  /** Times LiveKit dropped our processor and it was put back by itself. */
  reapplies: number;
};

let session: Session | null = null;
/** The reason "Strong" gave up in this call; it reads as "Standard" until the next call or a new choice. */
let fallback: NoiseReason | null = null;
let stopping = false;
let failing = false;
let retried = false;
let watchdog: ReturnType<typeof setInterval> | null = null;
let reconcileRun: Promise<void> | null = null;
let reconcileAgain = false;
let contextsCreated = 0;
let contextsClosed = 0;

const suppression: number[] = [];
const watched = new WeakSet<LocalAudioTrack>();
/** Tracks whose browser-side suppression has already been taken off once. */
const cleanCapture = new WeakSet<LocalAudioTrack>();

function debug(): boolean {
  try {
    return localStorage.getItem('atrium_noise_debug') === '1';
  } catch {
    return false;
  }
}

function log(event: string, data?: unknown) {
  if (debug()) console.debug('[noise]', event, data);
}

function noteSuppression(db: number) {
  if (!Number.isFinite(db)) return;
  suppression.push(db);
  if (suppression.length > 120) suppression.shift();
}

/** The median attenuation while the input was loud (speech, usually): a rough figure for the call report. */
export function suppressionDb(): number | undefined {
  if (!suppression.length) return undefined;
  const sorted = [...suppression].sort((a, b) => a - b);
  return Math.round(sorted[sorted.length >> 1] * 10) / 10;
}

export function micTrack(): LocalAudioTrack | undefined {
  const track = state().room?.localParticipant.getTrackPublication(Track.Source.Microphone)?.audioTrack;
  return track instanceof LocalAudioTrack ? track : undefined;
}

/** The mode actually in force: a failed "Strong" reads as "Standard" until the next call or a new choice. */
export function effectiveMode(): NoiseMode {
  const mode = state().voicePrefs.noise;
  if (mode === 'rnnoise' && (!STRONG_ENABLED || fallback)) return 'browser';
  return mode;
}

/** Capture settings for a mode. The only place that decides on the browser's own suppression: never under "Strong". */
export function captureOptions(mode: NoiseMode = effectiveMode()): AudioCaptureOptions {
  return {
    echoCancellation: true,
    autoGainControl: true,
    noiseSuppression: mode === 'browser',
    deviceId: getPreferredDevice('audioinput'),
  };
}

/**
 * Capture settings for a call or a microphone that is about to be opened: while "Strong" is still loading its model
 * the browser's own suppression stays on, so a slow start sends suppressed sound rather than raw noise. The strong
 * processor turns it off once it is proven and takes over.
 */
export function callCaptureOptions(): AudioCaptureOptions {
  const pref = state().voicePrefs.noise;
  // Once the node is built the browser's suppression can go: opening the microphone without it avoids a restart on
  // every publish (push-to-talk would lose the first words of each press).
  const ready = !!session?.sup && !session.closed;
  if (pref === 'rnnoise' && STRONG_ENABLED && !fallback && !ready) return captureOptions('browser');
  return captureOptions(effectiveMode());
}

function ensureSession(): Session {
  if (session && !session.closed) return session;
  const ctx = createStrongContext();
  contextsCreated++;
  const made = { ctx, closed: false, reapplies: 0 } as Session;
  made.ready = startContext(ctx)
    .then(() => {
      if (made.closed) throw new NoiseFailure('context', 'closed');
      return buildSuppressor(ctx, STRONG_ENGINE);
    })
    .then((sup) => {
      if (made.closed) {
        sup.dispose();
        throw new NoiseFailure('context', 'closed');
      }
      made.sup = sup;
      return sup;
    });
  // The same promise is awaited by whoever needs it; this only keeps a rejection from counting as unhandled.
  made.ready.catch(() => undefined);
  session = made;
  return made;
}

function closeSession() {
  stopWatchdog();
  const ended = session;
  session = null;
  if (!ended) return;
  ended.closed = true;
  contextsClosed++;
  void ended.ctx.close().catch(() => undefined);
}

/** The call is over: the context goes with it, so the next call starts clean. */
export function closeNoise() {
  closeSession();
  fallback = null;
  retried = false;
  suppression.length = 0;
  set({ noiseState: 'idle', noiseReason: null });
}

// Signing out resets the store and stops the room from outside `resetVoice`: the context must not outlive it.
onStoreReset(closeNoise);

/**
 * Warms the suppressor up inside the click that starts or joins a call, so the first phrase after joining (or the
 * first push-to-talk press) is not lost to a WASM download. Safe to call when "Strong" is off.
 */
export function primeNoise(inCall = false) {
  if (!STRONG_ENABLED || fallback || state().voicePrefs.noise !== 'rnnoise') return;
  // From the settings page (no call, nothing connecting) there is nothing to warm up; the next call primes itself.
  if (!inCall && state().voiceStatus === 'idle' && !state().room) return;
  try {
    const made = ensureSession();
    void made.ctx.resume().catch(() => undefined);
    log('session', { sampleRate: made.ctx.sampleRate, state: made.ctx.state });
  } catch (e) {
    const reason = failReason(e);
    fallback = reason;
    set({ noiseState: 'fallback', noiseReason: reason });
    console.warn('[noise] strong suppression is unavailable:', reason);
    showError(t('voice.err.noise', { error: t(REASON_KEY[reason]) }));
  }
}

/** The person picked another mode: a fallback from earlier no longer applies, and "Strong" gets a fresh start. */
export function noiseModeChanged() {
  fallback = null;
  retried = false;
  set({ noiseState: 'idle', noiseReason: null });
  if (effectiveMode() === 'rnnoise') primeNoise();
}

function sameSession(made: Session, track: LocalAudioTrack) {
  return session === made && !made.closed && micTrack() === track;
}

/** Puts the chosen mode on the microphone. Cheap when nothing changed: push-to-talk calls it on every key press. */
export function applyNoise(): Promise<void> {
  if (!reconcileRun) {
    reconcileRun = (async () => {
      try {
        do {
          reconcileAgain = false;
          await reconcileOnce();
        } while (reconcileAgain);
      } catch (e) {
        // A microphone that will not reopen is the call's own failure to report, not a suppressor one.
        console.warn('[noise] applying the noise mode failed:', e);
        if (!(e instanceof NoiseFailure) && micTrack()) {
          showError(t('voice.err.micFailed', { error: e instanceof Error ? e.message : String(e) }));
        }
      } finally {
        reconcileRun = null;
      }
    })();
  } else {
    reconcileAgain = true;
  }
  return reconcileRun;
}

/** What the browser says it is doing: from the raw microphone, never from the processed track in the sender. */
function browserSuppression(track: LocalAudioTrack): boolean | undefined {
  const settings = track.getSourceTrackSettings().noiseSuppression;
  if (settings !== undefined) return settings;
  const wanted = track.constraints.noiseSuppression;
  if (typeof wanted === 'boolean') return wanted;
  if (wanted && typeof wanted === 'object') return wanted.exact ?? wanted.ideal;
  return undefined;
}

async function reconcileOnce() {
  const track = micTrack();
  const want = effectiveMode();
  const strongOn = track?.getProcessor() instanceof StrongProcessor;

  // A session primed for a microphone that was never published (push-to-talk not pressed yet) must not outlive the
  // mode that asked for it.
  if (want !== 'rnnoise' && !strongOn) closeSession();
  if (!track) return;

  if (want !== 'rnnoise') {
    if (strongOn) {
      const owner = (track.getProcessor() as StrongProcessor).session;
      stopping = true;
      try {
        await track.stopProcessor();
      } catch (e) {
        log('stopProcessor failed', e);
      } finally {
        stopping = false;
      }
      // The call may have moved on while the processor was going away: only close the session it belonged to.
      if (session === owner) closeSession();
    }
    if (micTrack() !== track) return;

    // The browser's own suppression is a capture setting: on for "Standard", off for "Off".
    const wantNs = want === 'browser';
    const haveNs = browserSuppression(track);
    if (haveNs !== undefined && haveNs !== wantNs) {
      await track.restartTrack(captureOptions(want));
    }
    return;
  }

  if (strongOn) {
    // A new track can appear while the processor is already on (a recreate by the SDK): it comes with the browser's
    // suppression on until this point, so take it off once. Once per track: a browser that keeps reporting otherwise
    // must not make push-to-talk reopen the microphone on every press.
    if (browserSuppression(track) === true && !cleanCapture.has(track)) {
      cleanCapture.add(track);
      await track.restartTrack(captureOptions('rnnoise'));
    }
    return;
  }
  await enableStrong(track);
}

async function enableStrong(track: LocalAudioTrack) {
  let made: Session;
  try {
    made = ensureSession();
  } catch (e) {
    await fail(track, failReason(e));
    return;
  }
  set({ noiseState: 'starting' });
  try {
    const sup = await made.ready;
    if (!sameSession(made, track)) return;
    // The browser's own suppression stays on while the model loads, so a slow start does not send raw noise. It goes
    // off only here, right before the processor takes over.
    if (browserSuppression(track) !== false) {
      try {
        await track.restartTrack(captureOptions('rnnoise'));
      } catch (e) {
        // The microphone itself did not open: that is not a suppressor failure, and the second restart in `fail`
        // would only hide it behind the wrong message.
        if (sameSession(made, track)) {
          showError(t('voice.err.micFailed', { error: e instanceof Error ? e.message : String(e) }));
        }
        return;
      }
      if (!sameSession(made, track)) return;
    }
    // LiveKit refuses a processor on a track without a context; ours is the one the graph actually runs in.
    await track.setAudioContext(made.ctx);
    if (!sameSession(made, track)) return;
    const processor = new StrongProcessor(made, sup);
    await track.setProcessor(processor);
    if (!sameSession(made, track)) {
      stopping = true;
      try {
        await track.stopProcessor();
      } catch {
        // The processor went with the session.
      } finally {
        stopping = false;
      }
      return;
    }
    verify(made, track, processor);
    watchProcessorEvents(track);
    startWatchdog(made, track, processor);
    set({ noiseState: 'on', noiseReason: null });
    log('attached', { engine: sup.engine, readyMs: sup.readyMs, channelCount: processor.processedTrack?.getSettings().channelCount });
  } catch (e) {
    // The call may have ended or moved on while the model was loading: that is not this call's failure.
    if (!sameSession(made, track)) return;
    await fail(track, failReason(e));
  }
}

function verify(made: Session, track: LocalAudioTrack, processor: StrongProcessor) {
  const sup = made.sup;
  if (!sup) throw new NoiseFailure('context');
  if (sup.failure) throw new NoiseFailure(sup.failure);
  if (made.ctx.state !== 'running') throw new NoiseFailure('context', made.ctx.state);
  if (!processor.processedTrack || processor.processedTrack.readyState !== 'live') throw new NoiseFailure('sender');
  if (track.getProcessor() !== processor) throw new NoiseFailure('sender');
  if (track.sender && track.sender.track !== processor.processedTrack) throw new NoiseFailure('sender');
}

/** The way out that keeps the call working: back to the browser's suppression, one message, no second attempt. */
async function fail(track: LocalAudioTrack, reason: NoiseReason) {
  // A failure from a call that is already gone must not touch the microphone or the next call's session.
  if (failing || fallback || micTrack() !== track) return;
  failing = true;
  fallback = reason;
  set({ noiseState: 'fallback', noiseReason: reason });
  console.warn('[noise] strong suppression failed:', reason);
  // Said before any await: a hanging getUserMedia below must not swallow the explanation.
  showError(t('voice.err.noise', { error: t(REASON_KEY[reason]) }));
  stopWatchdog();
  const ended = session;
  session = null;
  if (ended) ended.closed = true;
  try {
    if (track.getProcessor() instanceof StrongProcessor) {
      stopping = true;
      try {
        await track.stopProcessor();
      } finally {
        stopping = false;
      }
    }
  } catch {
    // The processor is already gone; the capture is what matters now.
  }
  if (ended) {
    contextsClosed++;
    void ended.ctx.close().catch(() => undefined);
  }
  if (micTrack() === track && !track.isStopped) {
    try {
      await track.restartTrack(captureOptions('browser'));
    } catch (e) {
      if (micTrack() === track) {
        showError(t('voice.err.micFailed', { error: e instanceof Error ? e.message : String(e) }));
      }
    }
  }
  failing = false;
  if (reason === 'context' && !retried) {
    retried = true;
    retryOnGesture();
  }
}

/** A blocked context is the one failure a click can fix: one more try, then it is "Standard" for this call. */
function retryOnGesture() {
  const retry = () => {
    clearTimeout(timer);
    window.removeEventListener('pointerdown', retry, true);
    window.removeEventListener('keydown', retry, true);
    if (useStore.getState().voicePrefs.noise !== 'rnnoise' || !useStore.getState().room) return;
    fallback = null;
    set({ noiseState: 'idle', noiseReason: null });
    // Inside the click: a context the browser blocked can only be started from a gesture.
    primeNoise(true);
    void applyNoise();
  };
  const timer = setTimeout(() => {
    window.removeEventListener('pointerdown', retry, true);
    window.removeEventListener('keydown', retry, true);
  }, 30_000);
  window.addEventListener('pointerdown', retry, true);
  window.addEventListener('keydown', retry, true);
}

function stopWatchdog() {
  if (watchdog !== null) {
    clearInterval(watchdog);
    watchdog = null;
  }
}

/**
 * Listens to what actually comes out. Three ways "Strong" dies without an error anywhere: the context stops, the
 * node goes quiet while the microphone still hears something, or the call sends a track other than ours.
 */
function startWatchdog(made: Session, track: LocalAudioTrack, processor: StrongProcessor) {
  stopWatchdog();
  let lastTime = made.ctx.currentTime;
  let progressing = performance.now();
  let silentSince = 0;
  let wrongSender = 0;
  let quietUpstream = 0;
  let ticks = 0;
  let resumed = false;
  watchdog = setInterval(() => {
    if (session !== made || made.closed || track.getProcessor() !== processor) {
      stopWatchdog();
      return;
    }
    const sup = made.sup;
    if (!sup) return;
    if (sup.failure) {
      void fail(track, sup.failure);
      return;
    }
    if (made.ctx.state !== 'running') {
      if (!resumed) {
        resumed = true;
        void made.ctx.resume().catch(() => undefined);
      } else if (performance.now() - progressing > 3_000) {
        void fail(track, 'context');
      }
      return;
    }
    if (made.ctx.currentTime > lastTime + 0.0001) {
      lastTime = made.ctx.currentTime;
      progressing = performance.now();
    }
    const input = sup.meterIn.read();
    const output = sup.meterOut.read();
    if (track.isMuted) {
      silentSince = 0;
    } else {
      // Only a clearly loud microphone counts: a denoiser that silences a quiet room is doing its job, not dying.
      if (input.rmsDb > -55 && output.peak < SILENT_PEAK) {
        if (!silentSince) silentSince = performance.now();
        else if (performance.now() - silentSince > 2_000) {
          void fail(track, 'silent');
          return;
        }
      } else {
        silentSince = 0;
      }
      if (input.rmsDb > -50) noteSuppression(input.rmsDb - output.rmsDb);
    }
    // A paused upstream has no track by design (the OS took the microphone, a Bluetooth switch): not our failure.
    if (track.sender && !track.isUpstreamPaused && track.sender.track) {
      const ours = track.sender.track === processor.processedTrack && processor.processedTrack?.readyState === 'live';
      wrongSender = ours ? 0 : wrongSender + 1;
      if (wrongSender >= 2) void fail(track, 'sender');
    } else {
      wrongSender = 0;
    }
    // The last stretch the meters cannot see: what the sender actually puts on the wire. Only while the node itself
    // is clearly producing sound: fan noise that the model has already silenced is not a broken sender, and int16
    // rounding turns very quiet audio into zeros.
    ticks++;
    if (ticks % 4 === 0 && !track.isMuted && output.rmsDb > -60 && track.sender) {
      void track.sender.getStats().then((report) => {
        let level: number | undefined;
        report.forEach((stat) => {
          const source = stat as RTCStats & { audioLevel?: number; kind?: string };
          if (source.type === 'media-source' && source.kind === 'audio' && typeof source.audioLevel === 'number') level = source.audioLevel;
        });
        if (level === undefined || session !== made) return;
        quietUpstream = level < SILENT_PEAK ? quietUpstream + 1 : 0;
        if (quietUpstream >= 3) void fail(track, 'sender');
      }, () => undefined);
    }
  }, 500);
}

/**
 * LiveKit takes the processor off when it detaches the audio graph: a disconnect that keeps the tracks, or a context
 * swap with no context left. Put it back a few times; after that it is not a hiccup and the fallback takes over.
 */
function watchProcessorEvents(track: LocalAudioTrack) {
  if (watched.has(track)) return;
  watched.add(track);
  track.on(TrackEvent.TrackProcessorUpdate, (processor) => {
    if (processor || stopping || fallback) return;
    if (!state().room || effectiveMode() !== 'rnnoise') return;
    const made = session;
    if (!made || made.closed) return;
    made.reapplies++;
    log('processorUpdate', { reapplies: made.reapplies });
    if (made.reapplies > 3) void fail(track, 'sender');
    else void applyNoise();
  });
}

/** Between the microphone and the call: our node's output, on our context, in place of the raw track. */
class StrongProcessor implements TrackProcessor<Track.Kind.Audio, AudioProcessorOptions> {
  readonly name = 'atrium-strong';
  processedTrack?: MediaStreamTrack;
  private source?: MediaStreamAudioSourceNode;
  private destination?: MediaStreamAudioDestinationNode;
  private mic?: MediaStreamTrack;

  constructor(private readonly made: Session, private readonly sup: Suppressor) {}

  get session() {
    return this.made;
  }

  // The context LiveKit hands over is the room's; the graph stays on ours, so it is ignored on purpose.
  async init({ track }: AudioProcessorOptions) {
    if (this.made.closed || session !== this.made) throw new NoiseFailure('context');
    this.openDestination();
    this.attach(track);
  }

  async restart({ track }: AudioProcessorOptions) {
    // Never throw from here: LiveKit has already stopped the old microphone and is holding its lock, so a throw
    // would leave the call with a dead track and nobody to tell. The watchdog path below handles the same failure.
    try {
      if (this.made.closed || session !== this.made) throw new NoiseFailure('context');
      if (this.processedTrack?.readyState !== 'live') this.openDestination();
      this.attach(track);
      // LiveKit swaps the sender's track right after this; check once it has settled, outside its lock.
      setTimeout(() => {
        const current = micTrack();
        if (!current || current.getProcessor() !== this || session !== this.made || this.made.closed) return;
        try {
          verify(this.made, current, this);
        } catch (e) {
          void fail(current, failReason(e));
        }
      }, 1_000);
    } catch (e) {
      setTimeout(() => {
        const current = micTrack();
        if (current && current.getProcessor() === this) void fail(current, failReason(e));
      }, 0);
    }
  }

  async destroy() {
    this.source?.disconnect();
    this.source = undefined;
    this.mic = undefined;
    if (this.destination) {
      try {
        this.sup.output.disconnect(this.destination);
      } catch {
        // Already detached.
      }
      this.destination.stream.getTracks().forEach((track) => track.stop());
      this.destination = undefined;
    }
    this.processedTrack?.stop();
    this.processedTrack = undefined;
  }

  private openDestination() {
    if (this.destination) {
      try {
        this.sup.output.disconnect(this.destination);
      } catch {
        // Already detached.
      }
      this.destination.stream.getTracks().forEach((track) => track.stop());
    }
    const destination = this.made.ctx.createMediaStreamDestination();
    destination.channelCount = 1;
    destination.channelCountMode = 'explicit';
    this.sup.output.connect(destination);
    this.destination = destination;
    this.processedTrack = destination.stream.getAudioTracks()[0];
  }

  private attach(track: MediaStreamTrack) {
    if (this.mic === track && this.source) return;
    this.source?.disconnect();
    this.mic = track;
    this.source = this.made.ctx.createMediaStreamSource(new MediaStream([track]));
    this.source.connect(this.sup.input);
  }
}

/** What goes into the call report, if a call is being measured. */
export function noiseReport() {
  const effective = effectiveMode();
  return {
    noise: fallback ? 'fallback' : effective === 'rnnoise' ? 'strong' : effective,
    noiseEngine: effective === 'rnnoise' ? STRONG_ENGINE : undefined,
    noiseReason: fallback ?? undefined,
    noiseAtt: suppressionDb(),
  };
}

type NoiseSnapshot = {
  mode: NoiseMode;
  effective: NoiseMode;
  engine: Engine;
  context?: { state: AudioContextState; sampleRate: number; baseLatency?: number };
  attached: boolean;
  fallback: NoiseReason | null;
  suppressionDb?: number;
  readyMs?: number;
  contextsCreated: number;
  contextsClosed: number;
};

/** A debug snapshot for the console and for a friend's machine when a call sounds wrong. */
export function noiseSnapshot(): NoiseSnapshot {
  const track = micTrack();
  return {
    mode: state().voicePrefs.noise,
    effective: effectiveMode(),
    engine: STRONG_ENGINE,
    context: session
      ? { state: session.ctx.state, sampleRate: session.ctx.sampleRate, baseLatency: session.ctx.baseLatency }
      : undefined,
    attached: track?.getProcessor() instanceof StrongProcessor,
    fallback,
    suppressionDb: suppressionDb(),
    readyMs: session?.sup?.readyMs,
    contextsCreated,
    contextsClosed,
  };
}

if (typeof window !== 'undefined' && (import.meta.env.DEV || debug())) {
  (window as unknown as { __atriumNoise?: typeof noiseSnapshot }).__atriumNoise = noiseSnapshot;
}
