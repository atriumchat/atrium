import { Room, Track, type RemoteParticipant } from 'livekit-client';
import { showError, useStore } from '../store';

/** How loud each person plays, and which microphone and speakers calls use. */

const get = useStore.getState;

// Per-person volume (0..1), kept for the session so it survives reconnects and channel switches.
const userVolumes = new Map<string, number>();

export function applyVolume(participant: RemoteParticipant) {
  const volume = userVolumes.get(participant.identity);
  if (volume === undefined) return;
  participant.setVolume(volume);
  participant.setVolume(volume, Track.Source.ScreenShareAudio);
}

export function getUserVolume(userId: string) {
  return userVolumes.get(userId) ?? 1;
}

export function setUserVolume(userId: string, volume: number) {
  userVolumes.set(userId, volume);
  const participant = get().room?.remoteParticipants.get(userId);
  if (participant) applyVolume(participant);
}

// Preferred microphone / output device, remembered across sessions.
export type AudioDeviceKind = 'audioinput' | 'audiooutput';
const DEVICE_KEYS: Record<AudioDeviceKind, string> = { audioinput: 'hangout_mic', audiooutput: 'hangout_speaker' };

export function getPreferredDevice(kind: AudioDeviceKind): string | undefined {
  try {
    return localStorage.getItem(DEVICE_KEYS[kind]) ?? undefined;
  } catch {
    return undefined;
  }
}

export async function listDevices(kind: AudioDeviceKind): Promise<MediaDeviceInfo[]> {
  try {
    return await Room.getLocalDevices(kind);
  } catch {
    return [];
  }
}

export async function setPreferredDevice(kind: AudioDeviceKind, deviceId: string) {
  try {
    localStorage.setItem(DEVICE_KEYS[kind], deviceId);
  } catch {
    // Not persisted, but still applied to the current call below.
  }
  const { room } = get();
  if (!room) return;
  try {
    await room.switchActiveDevice(kind, deviceId);
  } catch {
    showError('Не удалось переключить устройство');
  }
}
