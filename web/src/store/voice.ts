import type { Room } from 'livekit-client';
import { loadPrefs, type VoicePrefs } from '../prefs';
import type { CallState, VoiceEntry } from '../types';
import { get } from './core';
import { isDmId } from './people';

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
  };
}

/**
 * You, in the room you're joining, before the server has heard of it: the list shows you the moment you
 * click instead of a second later. The server's own list replaces this once it arrives.
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
