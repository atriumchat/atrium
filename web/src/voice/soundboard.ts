import { api } from '../api';
import { t } from '../i18n';
import { playSoundboard } from '../socket';
import { saveSoundboard, showError, useStore, voiceMembers, type SoundboardSettings } from '../store';
import type { Sound, SoundPatch } from '../types';
import { getPreferredDevice } from './devices';

/*
 * The soundboard: your clips (api.sounds) and everyone's in the call (api.roomSounds), decoded into AudioBuffers
 * and played through one shared AudioContext. The sender doesn't play locally: it hears its own clip through the
 * server's sound:played broadcast, like everyone else, so playSound only asks the server.
 */

const get = useStore.getState;
const set = useStore.setState;

const MAX_SOUND_BYTES = 512 * 1024;
const MAX_SOUND_SECONDS = 5.2;
/** A late clip is worse than none: one fetched more than this after the event is dropped, not played. */
const PLAY_DEADLINE = 3000;
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
};

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

// Decoded clips by url, least recently used dropped first (the same url plays from cache forever).
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

// What's sounding right now, oldest first: a fourth at once stops the first.
const playing: AudioBufferSourceNode[] = [];

async function playBuffer(buffer: AudioBuffer, volume: number) {
  const context = audioCtx();
  await ensureRunning(context);
  await applySink(context);
  const gain = context.createGain();
  gain.gain.value = volume;
  const source = context.createBufferSource();
  source.buffer = buffer;
  source.connect(gain).connect(context.destination);
  playing.push(source);
  source.onended = () => {
    const i = playing.indexOf(source);
    if (i >= 0) playing.splice(i, 1);
  };
  while (playing.length > MAX_PLAYING) {
    try {
      playing.shift()?.stop();
    } catch {
      // Already ended.
    }
  }
  source.start();
}

/** Your clips, from the server. */
export async function loadMySounds(): Promise<void> {
  try {
    set({ mySounds: await api.sounds() });
  } catch {
    // Offline or the server is busy: the soundboard just stays as it was.
  }
}

/** null if the file is a fine clip, otherwise a ready-to-show reason. */
export async function checkSoundFile(file: File): Promise<string | null> {
  if (file.size > MAX_SOUND_BYTES) return t('voice.sound.tooBig');
  let buffer: AudioBuffer;
  try {
    buffer = await audioCtx().decodeAudioData(await file.arrayBuffer());
  } catch {
    return t('voice.sound.notAudio');
  }
  return buffer.duration > MAX_SOUND_SECONDS ? t('voice.sound.tooLong') : null;
}

export async function addSound(file: File, name: string, emoji: string, volume: number): Promise<boolean> {
  try {
    const sound = await api.uploadSound(file, name, emoji, volume);
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
}

export function toggleFavorite(id: string) {
  const { favorites } = get().soundboard;
  setSoundboard({ favorites: favorites.includes(id) ? favorites.filter((x) => x !== id) : [...favorites, id] });
}

/** Ask the server to play a clip for the whole call; the sound itself comes back as sound:played. */
export async function playSound(sound: Sound): Promise<boolean> {
  return (await playSoundboard(sound.id)) !== null;
}

/** Play a clip on this device only, ignoring mute: the sound picker's preview. */
export function previewSound(sound: Sound) {
  const cached = cachedBuffer(sound.url);
  if (cached) {
    void playBuffer(cached, get().soundboard.volume * sound.volume);
    return;
  }
  void loadBuffer(sound.url).then((buffer) => {
    if (buffer) void playBuffer(buffer, get().soundboard.volume * sound.volume);
  });
}

/** Someone played a clip (the sender included): show it on their tile and, unless muted or deafened, hear it. */
export function onSoundPlayed(event: SoundPlayedEvent) {
  set((s) => ({ soundPlays: { ...s.soundPlays, [event.userId]: Date.now() } }));
  const { deafened, soundboard } = get();
  if (deafened || soundboard.muted) return;
  const cached = cachedBuffer(event.url);
  if (cached) {
    void playBuffer(cached, soundboard.volume * event.volume);
    return;
  }
  const at = Date.now();
  void loadBuffer(event.url).then((buffer) => {
    if (!buffer || Date.now() - at > PLAY_DEADLINE) return;
    const now = get();
    if (now.deafened || now.soundboard.muted) return;
    void playBuffer(buffer, now.soundboard.volume * event.volume);
  });
}

/*
 * Preloading: while in a call, fetch and decode everyone's clips so the first play is instant. Tracked per call —
 * a new call (or leaving one) forgets who was loaded, while the decoded buffers stay in the LRU above.
 */
let callId: string | null = null;
const loadedUsers = new Set<string>();
let preloadTimer: ReturnType<typeof setTimeout> | null = null;

function trackCall() {
  const { voiceChannelId, voiceStatus, voiceState } = get();
  if (!voiceChannelId || voiceStatus !== 'connected') {
    if (!callId) return;
    callId = null;
    loadedUsers.clear();
    if (preloadTimer) clearTimeout(preloadTimer);
    preloadTimer = null;
    return;
  }
  if (voiceChannelId !== callId) {
    callId = voiceChannelId;
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
  const queue = sounds.filter((s) => !buffers.has(s.url));
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
}
