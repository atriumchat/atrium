import type { Room } from 'livekit-client';
import { loadPrefs, type VoicePrefs } from '../prefs';
import type { NoiseReason } from '../voice/suppressor';
import type { CallState, Sound, VoiceEntry } from '../types';
import { get } from './core';
import { isDmId } from './people';

/** Soundboard settings for this device: master volume, mute and the favourite clip ids. */
export type SoundboardSettings = { volume: number; muted: boolean; favorites: string[] };

const SOUNDBOARD_KEY = 'atrium_soundboard';
const DEFAULT_SOUNDBOARD: SoundboardSettings = { volume: 0.5, muted: false, favorites: [] };

export function loadSoundboard(): SoundboardSettings {
  try {
    const saved: Partial<SoundboardSettings> = JSON.parse(localStorage.getItem(SOUNDBOARD_KEY) ?? '{}');
    return {
      volume: typeof saved.volume === 'number' ? saved.volume : DEFAULT_SOUNDBOARD.volume,
      muted: typeof saved.muted === 'boolean' ? saved.muted : DEFAULT_SOUNDBOARD.muted,
      favorites: Array.isArray(saved.favorites) ? saved.favorites.filter((id): id is string => typeof id === 'string') : [],
    };
  } catch {
    return { ...DEFAULT_SOUNDBOARD };
  }
}

export function saveSoundboard(settings: SoundboardSettings) {
  try {
    localStorage.setItem(SOUNDBOARD_KEY, JSON.stringify(settings));
  } catch {
    // Not remembered; still applied for this session.
  }
}

/** Calls: who's in which room, and the call you're in (the LiveKit side lives in voice/voice.ts). */
export type VoiceSlice = {
  voicePrefs: VoicePrefs;
  /** The server makes every call go through the relay on 443. */
  serverRelayOnly: boolean;
  /** Push-to-talk key held right now. */
  pttDown: boolean;

  voiceState: VoiceEntry[];
  /** Calls in DMs and groups, by DM id. */
  calls: Record<string, CallState>;

  room: Room | null;
  /** Voice room id or DM id of the call we're in. */
  voiceChannelId: string | null;
  voiceStatus: 'idle' | 'connecting' | 'connected';
  joinedAt: number | null;
  muted: boolean;
  deafened: boolean;
  screenSharing: boolean;
  cameraOn: boolean;
  /** The camera is being switched on: the device is opening and the video isn't published yet. */
  cameraPending: boolean;
  /** Your camera straight from the device, shown in your tile while it's still being sent to the call. */
  cameraPreview: MediaStreamTrack | null;
  speaking: string[];

  /** The soundboard clips you uploaded. */
  mySounds: Sound[];
  /** Soundboard settings, kept on this device. */
  soundboard: SoundboardSettings;
  /** userId -> ms of their last sound:played, for the indicator in the UI. */
  soundPlays: Record<string, number>;
  /** Your own sound playing right now, for its playback fill in the UI; null when nothing of yours is sounding. */
  myPlaying: { soundId: string; playId: string; at: number; duration: number } | null;
  /** The sound you're listening to by yourself (the picker's preview), until it ends or you stop it. */
  previewing: string | null;
  /** How "Strong" is doing in this call: starting, on, or fallen back to the browser's own suppression. */
  noiseState: 'idle' | 'starting' | 'on' | 'fallback';
  noiseReason: NoiseReason | null;
};

export function voiceSlice(): VoiceSlice {
  return {
    voicePrefs: loadPrefs(),
    serverRelayOnly: false,
    pttDown: false,
    voiceState: [],
    calls: {},
    room: null,
    voiceChannelId: null,
    voiceStatus: 'idle',
    joinedAt: null,
    muted: false,
    deafened: false,
    screenSharing: false,
    cameraOn: false,
    cameraPending: false,
    cameraPreview: null,
    speaking: [],
    mySounds: [],
    soundboard: loadSoundboard(),
    soundPlays: {},
    myPlaying: null,
    previewing: null,
    noiseState: 'idle',
    noiseReason: null,
  };
}

/**
 * Local presence after LiveKit connects, until the server publishes its room list.
 */
export function selfEntry(channelId: string): VoiceEntry | null {
  const { me, muted, deafened } = get();
  if (!me) return null;
  return { channelId, userId: me.id, muted, deafened, video: false, screen: false, kind: isDmId(channelId) ? 'dm' : 'channel' };
}

/** Unique members of a voice channel (a user may have several tabs open). */
export function voiceMembers(entries: VoiceEntry[], channelId: string): VoiceEntry[] {
  const seen = new Map<string, VoiceEntry>();
  for (const e of entries) if (e.channelId === channelId && !seen.has(e.userId)) seen.set(e.userId, e);
  return [...seen.values()];
}
