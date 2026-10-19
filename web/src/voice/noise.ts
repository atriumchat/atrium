import { loadRnnoise, RnnoiseWorkletNode } from '@sapphi-red/web-noise-suppressor';
import workletUrl from '@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url';
import wasmUrl from '@sapphi-red/web-noise-suppressor/rnnoise.wasm?url';
import simdUrl from '@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url';
import { LocalAudioTrack, Track, type AudioProcessorOptions, type TrackProcessor } from 'livekit-client';
import { showError, useStore } from '../store';
import { t } from '../i18n';

/**
 * Strong noise suppression: RNNoise (a small neural net, MIT, via @sapphi-red/web-noise-suppressor) between the
 * microphone and what's sent, as a LiveKit track processor. RNNoise needs 48 kHz, so the track gets its own
 * AudioContext at that rate (applyNoise below).
 */

let wasm: Promise<ArrayBuffer> | null = null;
const loaded = new WeakSet<BaseAudioContext>();

export class RnnoiseProcessor implements TrackProcessor<Track.Kind.Audio, AudioProcessorOptions> {
  name = 'rnnoise';
  processedTrack?: MediaStreamTrack;
  private source?: MediaStreamAudioSourceNode;
  private node?: RnnoiseWorkletNode;
  private destination?: MediaStreamAudioDestinationNode;
  private audioContext?: AudioContext;

  async init({ track, audioContext }: AudioProcessorOptions) {
    this.audioContext = audioContext;
    await this.build(track);
  }

  // LiveKit hands restart() the new mic track but not the AudioContext, so the one from init() is reused.
  async restart({ track }: AudioProcessorOptions) {
    await this.destroy();
    await this.build(track);
  }

  async destroy() {
    this.source?.disconnect();
    this.node?.disconnect();
    this.node?.destroy();
    this.processedTrack?.stop();
    this.source = this.node = this.destination = this.processedTrack = undefined;
  }

  private async build(track: MediaStreamTrack) {
    const audioContext = this.audioContext!;
    // The page's CSP covers the worklet too: without 'wasm-unsafe-eval' RNNoise can't start and sends silence.
    await WebAssembly.compile(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]));
    wasm ??= loadRnnoise({ url: wasmUrl, simdUrl }).catch((e) => {
      wasm = null; // a failed load isn't kept: the next try fetches again
      throw e;
    });
    if (!loaded.has(audioContext)) {
      await audioContext.audioWorklet.addModule(workletUrl);
      loaded.add(audioContext);
    }
    this.node = new RnnoiseWorkletNode(audioContext, { wasmBinary: await wasm, maxChannels: 1 });
    this.source = audioContext.createMediaStreamSource(new MediaStream([track]));
    this.destination = audioContext.createMediaStreamDestination();
    this.source.connect(this.node).connect(this.destination);
    this.processedTrack = this.destination.stream.getAudioTracks()[0];
  }
}

const get = useStore.getState;

export function micTrack(): LocalAudioTrack | undefined {
  const track = get().room?.localParticipant.getTrackPublication(Track.Source.Microphone)?.audioTrack;
  return track instanceof LocalAudioTrack ? track : undefined;
}

// RNNoise wants 48 kHz; one context for the session, suspended between calls so it doesn't run the audio
// thread (and keep the device awake) for nothing.
let rnnoiseContext: AudioContext | null = null;

/** Put the chosen noise suppression on the mic: the browser's own, RNNoise, or none. */
export async function applyNoise() {
  const track = micTrack();
  if (!track) return;
  const mode = get().voicePrefs.noise;
  const strong = track.getProcessor()?.name === 'rnnoise';
  try {
    if (mode === 'rnnoise' && !strong) {
      rnnoiseContext ??= new AudioContext({ sampleRate: 48000 });
      if (rnnoiseContext.state === 'suspended') await rnnoiseContext.resume();
      track.setAudioContext(rnnoiseContext);
      await track.setProcessor(new RnnoiseProcessor());
    } else if (mode !== 'rnnoise' && strong) {
      await track.stopProcessor();
    }
  } catch (e) {
    showError(t('voice.err.noise', { error: e instanceof Error ? e.message : String(e) }));
  }
}

/** The call is over: the RNNoise context sleeps until the next one. */
export function suspendNoise() {
  if (rnnoiseContext?.state === 'running') void rnnoiseContext.suspend();
}
