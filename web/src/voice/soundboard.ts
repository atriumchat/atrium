import { api } from '../api';
import { t } from '../i18n';
import { playSoundboard, stopSoundboard } from '../socket';
import { getSessionEpoch, saveSoundboard, showError, useStore, voiceMembers, type SoundboardSettings } from '../store';
import type { Sound, SoundPatch } from '../types';
import { getPreferredDevice } from './devices';

/*
 * The soundboard: your clips (api.sounds) and everyone's in the call (api.roomSounds). Short clips are decoded into
 * AudioBuffers and played through one shared AudioContext; long ones stream through an <audio> element and are never
 * decoded or preloaded. The sender doesn't play locally: it hears its own clip through the server's sound:played
 * broadcast, like everyone else, so playSound only asks the server.
 */

const get = useStore.getState;
const set = useStore.setState;

/** The picked file: bigger than this the server won't take it (it keeps the first 4 minutes, compressed). */
const MAX_SOUND_BYTES = 50 * 1024 * 1024;
export const MIN_SOUND_SEGMENT_MS = 500;
/** Clips longer than this stream; short ones and old ones with no length (0) are decoded and preloaded. */
const LONG_LIMIT_MS = 10_000;
/** Whatever a file says, a streamed clip is cut off here (the server already trims it to 4 minutes). */
const MAX_LONG_SECONDS = 240;
/** A late clip is worse than none: one fetched more than this after the event is dropped, not played. */
const PLAY_DEADLINE = 3000;
/** How long your own clip counts as playing when its length is unknown (sounds from before lengths were kept). */
const MY_PLAY_FALLBACK = 1500;
const PRELOAD_DEBOUNCE = 400;
const PRELOAD_CONCURRENCY = 4;
const MAX_PLAYING = 3;
const BUFFER_LIMIT = 150;

/** What the server sends everyone in a call when a clip plays. */
export type SoundPlayedEvent = {
  soundId: string;
  userId: string;
  channelId: string;
  url: string;
  volume: number;
  name: string;
  emoji: string;
  durationMs: number;
  playId: string;
};

/** The server stopped a user's clips in a call (they asked, or they left): silence them here too. */
export type SoundStoppedEvent = { userId: string; channelId: string };

// One context for every clip, opened on first use; browsers only allow audio after a gesture, so it's resumed on
// the first pointerdown/keydown (like voice/sounds.ts) and before each play.
let ctx: AudioContext | null = null;

function audioCtx(): AudioContext {
  if (!ctx) ctx = new AudioContext();
  return ctx;
}

if (typeof window !== 'undefined') {
  const unlock = () => {
    if (ctx?.state === 'suspended') void ctx.resume().catch(() => undefined);
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
  };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);
}

async function ensureRunning(context: AudioContext) {
  if (context.state !== 'suspended') return;
  try {
    await context.resume();
  } catch {
    // Autoplay still blocked; the next click tries again.
  }
}

// The preferred output device, applied to the context and re-applied before a play when it changed.
let appliedSink: string | undefined;

async function applySink(context: AudioContext) {
  const setSinkId = (context as AudioContext & { setSinkId?: (id: string) => Promise<void> }).setSinkId;
  if (typeof setSinkId !== 'function') return;
  // '' is the system's default output: picking "default" again after another device must switch back too.
  const want = getPreferredDevice('audiooutput') ?? '';
  if (want === (appliedSink ?? '')) return;
  try {
    await setSinkId.call(context, want);
    appliedSink = want;
  } catch {
    // Device gone or not allowed here: keep the current output.
  }
}

// Decoded clips by url, least recently dropped first (the same url plays from cache forever). Long clips never land
// here: they stream, so minutes of music cost no memory.
const buffers = new Map<string, AudioBuffer>();

function cachedBuffer(url: string): AudioBuffer | undefined {
  const buffer = buffers.get(url);
  if (!buffer) return undefined;
  buffers.delete(url);
  buffers.set(url, buffer);
  return buffer;
}

function rememberBuffer(url: string, buffer: AudioBuffer) {
  buffers.delete(url);
  buffers.set(url, buffer);
  while (buffers.size > BUFFER_LIMIT) {
    const oldest = buffers.keys().next().value;
    if (oldest === undefined) break;
    buffers.delete(oldest);
  }
}

// A url already on its way is decoded once: preloading and a play may ask for the same clip at the same time.
const loading = new Map<string, Promise<AudioBuffer | null>>();

function loadBuffer(url: string): Promise<AudioBuffer | null> {
  const cached = cachedBuffer(url);
  if (cached) return Promise.resolve(cached);
  let pending = loading.get(url);
  if (!pending) {
    pending = decodeUrl(url);
    loading.set(url, pending);
    void pending.finally(() => loading.delete(url));
  }
  return pending;
}

async function decodeUrl(url: string): Promise<AudioBuffer | null> {
  try {
    const res = await fetch(url);
    const buffer = await audioCtx().decodeAudioData(await res.arrayBuffer());
    rememberBuffer(url, buffer);
    return buffer;
  } catch {
    // A clip that won't decode or won't download is simply not played.
    return null;
  }
}

/** Long clips (over 10 s) stream, and so do ones whose length is unknown (0): decoding a whole file to find out is worse. */
function isLong(durationMs: number): boolean {
  return durationMs === 0 || durationMs > LONG_LIMIT_MS;
}

/**
 * One clip sounding right now, whichever path started it; `stop` silences it and fires its `onEnded`. `base` is the
 * clip's own volume; what's heard is that times the soundboard's master volume, so `refresh` re-applies it when
 * either slider moves while the clip plays.
 */
type Play = { userId: string; stop: () => void; base: number; refresh: () => void; positionMs: () => number | null };

/** The part of a clip to sound, in ms from its start; absent means all of it. */
type Range = { fromMs: number; toMs: number };

/** What's heard: the clip's own volume times the master one, kept within 0..1. */
const level = (base: number) => Math.max(0, Math.min(1, get().soundboard.volume * base));

/** Both sliders change what is already sounding, not only the next clip. */
function refreshLevels() {
  for (const play of playing) play.refresh();
}

// What's sounding right now, oldest first, across both paths: a fourth at once stops the first.
const playing: Play[] = [];

function startPlay(play: Play) {
  playing.push(play);
  while (playing.length > MAX_PLAYING) playing.shift()?.stop();
}

function endPlay(play: Play) {
  const i = playing.indexOf(play);
  if (i >= 0) playing.splice(i, 1);
}

/**
 * Silence every call sound sounding right here (the server still plays them for the rest of the call) and forget
 * which ones were mine. A preview is the listener's own and stays: muting the soundboard doesn't end it.
 */
export function stopCallSounds({ clearOwn = true } = {}) {
  for (const play of [...playing]) if (play !== preview?.play) play.stop();
  latestPlay.clear();
  if (clearOwn && get().myPlaying) set({ myPlaying: null });
}

/** A short clip from its decoded buffer, through the shared context; `range` keeps only its chosen part. */
function playBuffer(
  buffer: AudioBuffer,
  base: number,
  userId: string,
  onEnded?: () => void,
  range?: Range,
): Play {
  const context = audioCtx();
  const durationMs = Math.round(buffer.duration * 1000);
  const gain = context.createGain();
  gain.gain.value = level(base);
  const source = context.createBufferSource();
  source.buffer = buffer;
  source.connect(gain).connect(context.destination);
  let done = false;
  let startedAt: number | null = null;
  const finish = () => {
    if (done) return;
    done = true;
    console.info('[soundboard] buffer end', { userId, durationMs });
    source.disconnect();
    gain.disconnect();
    endPlay(play);
    onEnded?.();
  };
  const play: Play = {
    userId,
    base,
    // A short ramp: a jump in gain clicks.
    refresh: () => gain.gain.setTargetAtTime(level(play.base), context.currentTime, 0.015),
    positionMs: () => startedAt === null ? null : (range?.fromMs ?? 0) + (context.currentTime - startedAt) * 1000,
    stop: () => {
      if (startedAt !== null && !done) source.stop();
      finish();
    },
  };
  source.onended = finish;
  startPlay(play);
  console.info('[soundboard] buffer start', { userId, durationMs });
  void (async () => {
    await ensureRunning(context);
    await applySink(context);
    if (done) return;
    try {
      source.start(0, (range?.fromMs ?? 0) / 1000, range ? (range.toMs - range.fromMs) / 1000 : undefined);
      startedAt = context.currentTime;
    } catch {
      finish();
    }
  })();
  return play;
}

/** A long clip, streamed: seek to where the call is by now so everyone stays roughly together, cut off at 4 minutes. */
function playLong(
  url: string,
  base: number,
  arrived: number | null,
  userId: string,
  onEnded?: () => void,
  range?: Range,
  loop = false,
): Play {
  const audio = new Audio();
  audio.preload = 'auto';
  audio.volume = level(base);
  const setSinkId = (audio as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }).setSinkId;
  if (typeof setSinkId === 'function') {
    void setSinkId.call(audio, getPreferredDevice('audiooutput') ?? '').catch(() => undefined);
  }
  audio.src = url;
  let done = false;
  let started = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const finish = () => {
    if (done) return;
    done = true;
    console.info('[soundboard] long end', { url, userId });
    if (timer) clearTimeout(timer);
    audio.onended = audio.onerror = audio.oncanplay = null;
    audio.pause();
    audio.removeAttribute('src');
    // Dropping the attribute alone leaves the loaded stream alive; load() releases the decoder and the download.
    audio.load();
    endPlay(play);
    onEnded?.();
  };
  const play: Play = {
    userId,
    base,
    refresh: () => {
      audio.volume = level(play.base);
    },
    positionMs: () => started && !done ? audio.currentTime * 1000 : null,
    stop: finish,
  };
  const checkRange = () => {
    if (!range || done) return;
    if (audio.currentTime * 1000 >= range.toMs || audio.ended) {
      if (!loop) {
        finish();
        return;
      }
      audio.currentTime = range.fromMs / 1000;
      if (audio.paused) void audio.play().catch(finish);
    }
    const left = range.toMs - audio.currentTime * 1000;
    timer = setTimeout(checkRange, Math.max(8, Math.min(80, left)));
  };
  audio.onended = loop && range ? () => {
    if (timer) clearTimeout(timer);
    checkRange();
  } : finish;
  audio.onerror = finish;
  audio.oncanplay = () => {
    audio.oncanplay = null;
    if (done) return;
    if (timer) clearTimeout(timer);
    if (range) {
      audio.currentTime = range.fromMs / 1000;
      timer = setTimeout(finish, MAX_LONG_SECONDS * 1000);
      void audio.play().then(() => {
        if (done) return;
        started = true;
        if (timer) clearTimeout(timer);
        checkRange();
      }, finish);
      return;
    }
    const elapsed = arrived === null ? 0 : (Date.now() - arrived) / 1000;
    // Already past the end (a slow network, a replayed event, past the 4 minutes): don't start it at all.
    if (elapsed >= MAX_LONG_SECONDS || elapsed >= audio.duration) {
      finish();
      return;
    }
    if (elapsed > 0) audio.currentTime = elapsed;
    timer = setTimeout(finish, (MAX_LONG_SECONDS - elapsed) * 1000);
    void audio.play().catch(finish);
  };
  startPlay(play);
  console.info('[soundboard] long start', { url, userId });
  // Release a stream that never reaches canplay, even if the browser never reports an error.
  timer = setTimeout(finish, MAX_LONG_SECONDS * 1000);
  audio.load();
  return play;
}

/** Your clips, from the server. */
export async function loadMySounds(): Promise<void> {
  const epoch = getSessionEpoch();
  try {
    const sounds = await api.sounds();
    if (getSessionEpoch() === epoch) set({ mySounds: sounds });
  } catch {
    // Offline or the server is busy: the soundboard just stays as it was.
  }
}

export async function inspectSoundFile(file: File, signal: AbortSignal) {
  if (file.size > MAX_SOUND_BYTES) return { error: t('voice.sound.tooBig') } as const;
  const durationMs = await readDuration(file, signal);
  signal.throwIfAborted();
  if (!durationMs) return { error: t('voice.sound.notAudio') } as const;
  if (durationMs < MIN_SOUND_SEGMENT_MS) return { error: t('voice.soundboard.shortFile') } as const;
  return { durationMs, waveform: await soundWaveform(file, durationMs, signal) } as const;
}

const WAVE_BARS = 200;
const WAVE_LIMIT = 30 * 1024 * 1024;

async function soundWaveform(file: File, durationMs: number, signal: AbortSignal) {
  const large = file.size > WAVE_LIMIT;
  const sampleMs = large ? Math.min(60_000, durationMs) : durationMs;
  const count = Math.max(1, Math.ceil(WAVE_BARS * sampleMs / durationMs));
  let context: AudioContext | undefined;
  try {
    context = new AudioContext();
    const bytes = large && durationMs > 60_000 ? await wavePrefix(file, durationMs) : await file.arrayBuffer();
    signal.throwIfAborted();
    const buffer = await context.decodeAudioData(bytes);
    signal.throwIfAborted();
    const length = Math.min(buffer.length, Math.ceil(sampleMs / 1000 * buffer.sampleRate));
    const coveredMs = Math.min(sampleMs, buffer.duration * 1000);
    const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
    const peaks = Array.from({ length: count }, (_, i) => {
      const start = Math.floor(i * length / count);
      const end = Math.floor((i + 1) * length / count);
      let peak = 0;
      for (const channel of channels) {
        for (let at = start; at < end; at++) peak = Math.max(peak, Math.abs(channel[at]));
      }
      return peak;
    });
    return { peaks, coveredMs };
  } catch {
    signal.throwIfAborted();
    // Containers such as MP4 can keep their index at the end, so a byte prefix cannot be decoded in isolation.
    return large ? sampleWaveform(file, sampleMs, count, signal) : { peaks: [], coveredMs: 0 };
  } finally {
    void context?.close().catch(() => undefined);
  }
}

/** Prefix decoders can read MP3 and PCM WAV. Make the WAV container's lengths match the sampled bytes. */
async function wavePrefix(file: File, durationMs: number) {
  const bytes = await file.slice(0, Math.min(WAVE_LIMIT, Math.ceil(file.size * 62_000 / durationMs))).arrayBuffer();
  const data = new DataView(bytes);
  if (data.byteLength >= 12 && data.getUint32(0) === 0x52494646 && data.getUint32(8) === 0x57415645) {
    data.setUint32(4, data.byteLength - 8, true);
    for (let at = 12; at + 8 <= data.byteLength;) {
      const length = data.getUint32(at + 4, true);
      if (data.getUint32(at) === 0x64617461) {
        data.setUint32(at + 4, Math.min(length, data.byteLength - at - 8), true);
        break;
      }
      at += 8 + length + (length % 2);
    }
  }
  return bytes;
}

/** Sample only the first minute through the media decoder when a large container has no decodable prefix. */
function sampleWaveform(file: File, sampleMs: number, count: number, signal: AbortSignal) {
  return new Promise<{ peaks: number[]; coveredMs: number }>((resolve) => {
    let context: AudioContext;
    try {
      context = new AudioContext();
    } catch {
      resolve({ peaks: [], coveredMs: 0 });
      return;
    }
    const url = URL.createObjectURL(file);
    const audio = new Audio(url);
    const analyser = context.createAnalyser();
    const silence = context.createGain();
    silence.gain.value = 0;
    context.createMediaElementSource(audio).connect(analyser).connect(silence).connect(context.destination);
    const samples = new Float32Array(analyser.fftSize);
    const peaks: number[] = Array.from({ length: count }, () => 0);
    const speed = 4;
    audio.playbackRate = speed;
    let frame = 0;
    let lastMs = 0;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timeout);
      cancelAnimationFrame(frame);
      signal.removeEventListener('abort', finish);
      audio.onended = audio.onerror = null;
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
      URL.revokeObjectURL(url);
      void context.close().catch(() => undefined);
      resolve({ peaks: peaks.slice(0, Math.ceil(lastMs / sampleMs * count)), coveredMs: lastMs });
    };
    const draw = () => {
      lastMs = Math.min(sampleMs, audio.currentTime * 1000);
      const i = Math.min(count - 1, Math.floor(lastMs / sampleMs * count));
      analyser.getFloatTimeDomainData(samples);
      for (const sample of samples) peaks[i] = Math.max(peaks[i], Math.abs(sample));
      if (lastMs >= sampleMs) finish();
      else frame = requestAnimationFrame(draw);
    };
    const timeout = setTimeout(finish, sampleMs / speed + 4000);
    if (signal.aborted) {
      finish();
      return;
    }
    signal.addEventListener('abort', finish, { once: true });
    audio.onended = audio.onerror = finish;
    void Promise.all([context.resume(), audio.play()]).then(() => {
      if (!done) frame = requestAnimationFrame(draw);
    }, finish);
  });
}

/** Read duration from metadata without decoding the entire track. */
function readDuration(file: File, signal: AbortSignal): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const audio = new Audio();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const done = (ms: number | null) => {
      audio.onloadedmetadata = audio.onerror = null;
      signal.removeEventListener('abort', abort);
      if (timer) clearTimeout(timer);
      audio.removeAttribute('src');
      audio.load();
      URL.revokeObjectURL(url);
      resolve(ms);
    };
    const abort = () => done(null);
    if (signal.aborted) return abort();
    signal.addEventListener('abort', abort, { once: true });
    audio.preload = 'metadata';
    audio.onloadedmetadata = () => done(Number.isFinite(audio.duration) ? Math.round(audio.duration * 1000) : null);
    audio.onerror = () => done(null);
    timer = setTimeout(() => done(null), 8000);
    audio.src = url;
  });
}

export async function addSound(
  file: File,
  name: string,
  emoji: string,
  volume: number,
  range?: Range,
): Promise<boolean> {
  try {
    const sound = await api.uploadSound(file, name, emoji, volume, range?.fromMs, range?.toMs);
    set((s) => ({ mySounds: [...s.mySounds, sound] }));
    return true;
  } catch (e) {
    showError(e instanceof Error ? e.message : String(e));
    return false;
  }
}

export async function editSound(id: string, patch: SoundPatch): Promise<boolean> {
  try {
    const sound = await api.updateSound(id, patch);
    set((s) => ({ mySounds: s.mySounds.map((x) => (x.id === id ? sound : x)) }));
    return true;
  } catch (e) {
    showError(e instanceof Error ? e.message : String(e));
    return false;
  }
}

export async function removeSound(id: string): Promise<boolean> {
  try {
    await api.deleteSound(id);
    set((s) => ({ mySounds: s.mySounds.filter((x) => x.id !== id) }));
    if (get().soundboard.favorites.includes(id)) toggleFavorite(id);
    return true;
  } catch (e) {
    showError(e instanceof Error ? e.message : String(e));
    return false;
  }
}

/** Change soundboard settings: applied at once and saved on this device. */
export function setSoundboard(patch: Partial<SoundboardSettings>) {
  const next = { ...get().soundboard, ...patch };
  set({ soundboard: next });
  saveSoundboard(next);
  if (patch.volume !== undefined) refreshLevels();
  // Muting is local and immediate: nothing of the soundboard should keep sounding.
  if (next.muted) stopCallSounds({ clearOwn: false });
}

export function toggleFavorite(id: string) {
  const { favorites } = get().soundboard;
  setSoundboard({ favorites: favorites.includes(id) ? favorites.filter((x) => x !== id) : [...favorites, id] });
}

/** Ask the server to play a clip for the whole call; the sound itself comes back as sound:played. */
export async function playSound(sound: Sound): Promise<boolean> {
  return (await playSoundboard(sound.id)) !== null;
}

/**
 * Stop your sound for everyone in the call. Local previews have their own stop button.
 * Nothing goes to the server when no sound is playing for the call.
 */
export async function stopMySounds(): Promise<boolean> {
  const me = get().me?.id;
  if (!get().myPlaying && !playing.some((play) => play.userId === me)) return true;
  return (await stopSoundboard()) !== null;
}

// One request owns the preview while the clip is loading and while it plays.
let preview: { play: Play | null; volume: number } | null = null;

/** Stop listening to a preview. */
export function stopPreview() {
  const previous = preview;
  preview = null;
  previous?.play?.stop();
  if (get().previewing !== null) set({ previewing: null });
}

/** Play a clip on this device only, ignoring mute; `range` plays just the chosen part. Returns controls scoped to this preview. */
export function previewSound(sound: Sound, range?: Range, loop = false) {
  stopPreview();
  const request = { play: null as Play | null, volume: sound.volume };
  preview = request;
  set({ previewing: sound.id });
  console.info('[soundboard] preview start', { soundId: sound.id, url: sound.url, durationMs: sound.durationMs });
  const ended = () => {
    if (preview !== request) return;
    console.info('[soundboard] preview end', { soundId: sound.id, url: sound.url });
    preview = null;
    set({ previewing: null });
  };
  if (isLong(sound.durationMs)) {
    request.play = playLong(sound.url, request.volume, null, '', ended, range, loop);
  } else {
    const cached = cachedBuffer(sound.url);
    if (cached) request.play = playBuffer(cached, request.volume, '', ended, range);
    else void loadBuffer(sound.url).then((buffer) => {
      if (preview !== request) return;
      if (buffer) request.play = playBuffer(buffer, request.volume, '', ended, range);
      else ended();
    });
  }
  return {
    positionMs: () => preview === request ? request.play?.positionMs() ?? null : null,
    stop: () => {
      if (preview === request) stopPreview();
    },
    setVolume: (volume: number) => {
      if (preview !== request) return;
      request.volume = volume;
      if (request.play) {
        request.play.base = volume;
        request.play.refresh();
      }
    },
  };
}

/** How long a clip is in ms, from the decoded cache: undefined for a long (streamed) clip or one not decoded yet. */
export function soundDuration(url: string): number | undefined {
  const buffer = cachedBuffer(url);
  return buffer ? Math.round(buffer.duration * 1000) : undefined;
}

/** Drop the UI's playback state for one play, unless a newer play has already taken its place. */
function clearMyPlay(playId: string) {
  if (get().myPlaying?.playId === playId) set({ myPlaying: null });
}

/** Each person's latest play: anything of theirs still loading that isn't it doesn't start. */
const latestPlay = new Map<string, string>();

/** Someone played a clip (the sender included): show it on their tile and, unless muted or deafened, hear it. */
export function onSoundPlayed(event: SoundPlayedEvent) {
  if (!inCall(event.channelId)) return;
  console.info('[soundboard] played', { soundId: event.soundId, userId: event.userId, durationMs: event.durationMs });
  set((s) => ({ soundPlays: { ...s.soundPlays, [event.userId]: Date.now() } }));
  // One sound per person at a time: a new one cuts off whatever they played before (other people's keep going),
  // including one still loading, which then never starts.
  for (const play of [...playing]) if (play.userId === event.userId) play.stop();
  latestPlay.set(event.userId, event.playId);
  const current = () => {
    const now = get();
    return inCall(event.channelId) && latestPlay.get(event.userId) === event.playId && !now.deafened && !now.soundboard.muted;
  };
  const mine = event.userId === get().me?.id;
  const at = Date.now();
  const { deafened, soundboard } = get();
  const hear = !deafened && !soundboard.muted;
  // Playing for the call replaces listening by yourself: never both at once.
  if (mine) stopPreview();
  // Your own clip sounds for the call whether or not you hear it yourself, so its state (the fill, the stop button)
  // follows the sound itself: the real end when you hear it, a long timer as a safety net, and its own length when
  // the soundboard is muted or you're deafened.
  if (mine) {
    set({ myPlaying: { soundId: event.soundId, playId: event.playId, at, duration: event.durationMs } });
    setTimeout(
      () => clearMyPlay(event.playId),
      hear ? MAX_LONG_SECONDS * 1000 : Math.min(event.durationMs || MY_PLAY_FALLBACK, MAX_LONG_SECONDS * 1000),
    );
  }
  if (!hear) return;
  const endMine = mine ? () => clearMyPlay(event.playId) : undefined;
  if (isLong(event.durationMs)) {
    playLong(event.url, event.volume, at, event.userId, endMine);
    return;
  }
  const cached = cachedBuffer(event.url);
  if (cached) {
    playBuffer(cached, event.volume, event.userId, endMine);
    return;
  }
  void loadBuffer(event.url).then((buffer) => {
    if (!buffer || Date.now() - at > PLAY_DEADLINE || !current()) {
      // Never started here, but it still plays for the call: the stop button follows the clip's length instead.
      if (endMine) setTimeout(endMine, Math.max(0, (event.durationMs || MY_PLAY_FALLBACK) - (Date.now() - at)));
      return;
    }
    playBuffer(buffer, event.volume, event.userId, endMine);
  });
}

function inCall(channelId: string) {
  const now = get();
  return now.voiceStatus === 'connected' && now.voiceChannelId === channelId;
}

/** The server stopped a user's clips (they asked, or they left): silence their plays here and drop your own state. */
export function onSoundStopped(event: SoundStoppedEvent) {
  if (!inCall(event.channelId)) return;
  latestPlay.delete(event.userId);
  for (const play of [...playing]) if (play.userId === event.userId) play.stop();
  if (get().me?.id === event.userId) set({ myPlaying: null });
}

/*
 * Preloading: while in a call, fetch and decode everyone's short clips so the first play is instant; long ones are
 * left alone. Tracked per call — a new call (or leaving one) forgets who was loaded, while the decoded buffers stay
 * in the LRU above.
 */
let callId: string | null = null;
const loadedUsers = new Set<string>();
let preloadTimer: ReturnType<typeof setTimeout> | null = null;

function trackCall() {
  const { voiceChannelId, voiceStatus, voiceState } = get();
  if (!voiceChannelId || voiceStatus !== 'connected') {
    if (!callId) return;
    callId = null;
    // Out of the call: whatever of it was still sounding (a minute of someone's music) ends with it.
    stopCallSounds();
    stopPreview();
    loadedUsers.clear();
    if (preloadTimer) clearTimeout(preloadTimer);
    preloadTimer = null;
    return;
  }
  if (voiceChannelId !== callId) {
    const switched = callId !== null;
    callId = voiceChannelId;
    if (switched) {
      stopCallSounds();
      stopPreview();
    }
    loadedUsers.clear();
    void loadMySounds();
  }
  const members = voiceMembers(voiceState, voiceChannelId);
  if (members.every((e) => loadedUsers.has(e.userId))) return;
  for (const e of members) loadedUsers.add(e.userId);
  if (preloadTimer) clearTimeout(preloadTimer);
  preloadTimer = setTimeout(() => {
    preloadTimer = null;
    void preloadCall(voiceChannelId);
  }, PRELOAD_DEBOUNCE);
}

async function preloadCall(channelId: string) {
  let sounds: Sound[];
  try {
    sounds = await api.roomSounds(channelId);
  } catch {
    return;
  }
  const queue = sounds.filter((s) => !isLong(s.durationMs) && !buffers.has(s.url));
  await Promise.all(
    Array.from({ length: PRELOAD_CONCURRENCY }, async () => {
      while (queue.length) {
        const sound = queue.shift();
        if (sound) await loadBuffer(sound.url);
      }
    }),
  );
}

let started = false;

/** Start watching the store for calls to preload their sounds. Called once, from socket.ts. */
export function initSoundboard() {
  if (started) return;
  started = true;
  useStore.subscribe(trackCall);
  // Deafening silences the soundboard at once, the way muting it does in setSoundboard.
  useStore.subscribe((s, prev) => {
    if (s.me?.id !== prev.me?.id) stopPreview();
    if (!prev.deafened && s.deafened) stopCallSounds({ clearOwn: false });
  });
}
