import { api } from '../api';
import { t } from '../i18n';
import { playSoundboard, stopSoundboard } from '../socket';
import { saveSoundboard, showError, useStore, voiceMembers, type SoundboardSettings } from '../store';
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

/** Long clips (over 10 s) stream; short ones and old ones with no length are decoded. */
function isLong(durationMs: number): boolean {
  return durationMs > LONG_LIMIT_MS;
}

/**
 * One clip sounding right now, whichever path started it; `stop` silences it and fires its `onEnded`. `base` is the
 * clip's own volume; what's heard is that times the soundboard's master volume, so `refresh` re-applies it when
 * either slider moves while the clip plays.
 */
type Play = { userId: string; stop: () => void; base: number; refresh: () => void };

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

/** Silence everything sounding right here; the server still plays it for the rest of the call. */
function stopAll() {
  for (const play of [...playing]) play.stop();
}

/** A short clip from its decoded buffer, through the shared context. */
function playBuffer(buffer: AudioBuffer, base: number, userId: string, onEnded?: () => void): Play {
  const context = audioCtx();
  const gain = context.createGain();
  gain.gain.value = level(base);
  const source = context.createBufferSource();
  source.buffer = buffer;
  source.connect(gain).connect(context.destination);
  let done = false;
  let started = false;
  const finish = () => {
    if (done) return;
    done = true;
    endPlay(play);
    onEnded?.();
  };
  const play: Play = {
    userId,
    base,
    // A short ramp: a jump in gain clicks.
    refresh: () => gain.gain.setTargetAtTime(level(play.base), context.currentTime, 0.015),
    stop: () => {
      if (!started) {
        finish();
        return;
      }
      try {
        source.stop();
      } catch {
        finish();
      }
    },
  };
  source.onended = finish;
  startPlay(play);
  void (async () => {
    await ensureRunning(context);
    await applySink(context);
    if (done) return;
    started = true;
    try {
      source.start();
    } catch {
      finish();
    }
  })();
  return play;
}

/** A long clip, streamed: seek to where the call is by now so everyone stays roughly together, cut off at 4 minutes. */
function playLong(url: string, base: number, arrived: number, userId: string, onEnded?: () => void, current: () => boolean = () => true): Play {
  const audio = new Audio();
  audio.preload = 'auto';
  audio.volume = level(base);
  const setSinkId = (audio as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }).setSinkId;
  if (typeof setSinkId === 'function') {
    void setSinkId.call(audio, getPreferredDevice('audiooutput') ?? '').catch(() => undefined);
  }
  audio.src = url;
  let done = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const finish = () => {
    if (done) return;
    done = true;
    if (timer) clearTimeout(timer);
    endPlay(play);
    onEnded?.();
  };
  const play: Play = {
    userId,
    base,
    refresh: () => {
      audio.volume = level(play.base);
    },
    stop: () => {
      audio.pause();
      audio.removeAttribute('src');
      finish();
    },
  };
  audio.onended = finish;
  audio.onerror = finish;
  audio.oncanplay = () => {
    audio.oncanplay = null;
    if (done) return;
    // Replaced by a newer sound of theirs, or stopped, while it was still loading.
    if (!current()) {
      finish();
      return;
    }
    const elapsed = (Date.now() - arrived) / 1000;
    // Already past the end (a slow network, a replayed event, past the 4 minutes): don't start it at all.
    if (elapsed >= MAX_LONG_SECONDS || elapsed >= audio.duration) {
      finish();
      return;
    }
    audio.currentTime = elapsed;
    startPlay(play);
    timer = setTimeout(finish, Math.max(0, MAX_LONG_SECONDS - elapsed) * 1000);
    void audio.play().catch(finish);
  };
  audio.load();
  return play;
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
  try {
    await audioCtx().decodeAudioData(await file.arrayBuffer());
  } catch {
    return t('voice.sound.notAudio');
  }
  return null;
}

/** How long the picked file is in ms, or null when it won't decode: the dialog says when the server will cut it. */
export async function soundFileDuration(file: File): Promise<number | null> {
  try {
    const buffer = await audioCtx().decodeAudioData(await file.arrayBuffer());
    return Math.round(buffer.duration * 1000);
  } catch {
    return null;
  }
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
  if (patch.volume !== undefined) refreshLevels();
  // Muting is local and immediate: nothing of the soundboard should keep sounding.
  if (next.muted) stopAll();
}

export function toggleFavorite(id: string) {
  const { favorites } = get().soundboard;
  setSoundboard({ favorites: favorites.includes(id) ? favorites.filter((x) => x !== id) : [...favorites, id] });
}

/** Ask the server to play a clip for the whole call; the sound itself comes back as sound:played. */
export async function playSound(sound: Sound): Promise<boolean> {
  return (await playSoundboard(sound.id)) !== null;
}

/** Ask the server to stop every clip sounding in the call; everyone silences them on sound:stopped. */
export async function stopMySounds(): Promise<boolean> {
  return (await stopSoundboard()) !== null;
}

// The preview sounding right now: asking for another one stops it first, so previews never pile up.
let preview: Play | null = null;

function startPreview(play: Play) {
  // The new one first: the old one's end then sees it's no longer current and leaves the stop state alone.
  const old = preview;
  preview = play;
  if (old && old !== play) old.stop();
}

/** The clip you're listening to by yourself changes its own volume as the slider moves (the add/edit window's). */
export function setPreviewVolume(volume: number) {
  if (!preview) return;
  preview.base = volume;
  preview.refresh();
}

/** Stop listening to a preview. */
export function stopPreview() {
  preview?.stop();
  preview = null;
  set({ previewing: null });
}

/** Play a clip on this device only, ignoring mute: the sound picker's preview. Long clips stream like in a call. */
export function previewSound(sound: Sound) {
  let play: Play | null = null;
  // The tile shows a stop while this preview sounds; a newer preview or the end clears it.
  const ended = () => {
    if (preview !== play) return;
    preview = null;
    set({ previewing: null });
  };
  const start = (next: Play) => {
    play = next;
    startPreview(next);
  };
  set({ previewing: sound.id });
  if (isLong(sound.durationMs)) {
    start(playLong(sound.url, sound.volume, Date.now(), '', ended));
    return;
  }
  const cached = cachedBuffer(sound.url);
  if (cached) {
    start(playBuffer(cached, sound.volume, '', ended));
    return;
  }
  void loadBuffer(sound.url).then((buffer) => {
    if (buffer && get().previewing === sound.id) start(playBuffer(buffer, sound.volume, '', ended));
    else if (!buffer && get().previewing === sound.id) set({ previewing: null });
  });
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
  set((s) => ({ soundPlays: { ...s.soundPlays, [event.userId]: Date.now() } }));
  // One sound per person at a time: a new one cuts off whatever they played before (other people's keep going),
  // including one still loading, which then never starts.
  for (const play of [...playing]) if (play.userId === event.userId) play.stop();
  latestPlay.set(event.userId, event.playId);
  const current = () => latestPlay.get(event.userId) === event.playId;
  const mine = event.userId === get().me?.id;
  const at = Date.now();
  // Your own clip sounds for the call whether or not you hear it yourself, so its state (the fill, the stop button)
  // follows its length, not your speakers.
  if (mine) {
    set({ myPlaying: { soundId: event.soundId, playId: event.playId, at, duration: event.durationMs } });
    setTimeout(() => clearMyPlay(event.playId), Math.min(event.durationMs || MY_PLAY_FALLBACK, MAX_LONG_SECONDS * 1000));
  }
  const { deafened, soundboard } = get();
  if (deafened || soundboard.muted) return;
  if (isLong(event.durationMs)) {
    playLong(event.url, event.volume, at, event.userId, undefined, current);
    return;
  }
  const cached = cachedBuffer(event.url);
  if (cached) {
    playBuffer(cached, event.volume, event.userId);
    return;
  }
  void loadBuffer(event.url).then((buffer) => {
    if (!buffer || Date.now() - at > PLAY_DEADLINE || !current()) return;
    const now = get();
    if (now.deafened || now.soundboard.muted) return;
    playBuffer(buffer, event.volume, event.userId);
  });
}

/** The server stopped a user's clips (they asked, or they left): silence their plays here and drop your own state. */
export function onSoundStopped(event: SoundStoppedEvent) {
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
    if (!prev.deafened && s.deafened) stopAll();
  });
}
