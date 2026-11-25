import { Room, Track, type RemoteParticipant } from 'livekit-client';
import { showError, useStore } from '../store';
import { t } from '../i18n';

/** How loud each person plays, and which microphone and speakers calls use. */

const get = useStore.getState;

// Per-person volume (0..2), kept for the session so it survives reconnects and channel switches.
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

// Devices used by calls, remembered across sessions.
export type AudioDeviceKind = 'audioinput' | 'audiooutput';
export type DeviceKind = AudioDeviceKind | 'videoinput';
const DEVICE_KEYS: Record<DeviceKind, string> = { audioinput: 'hangout_mic', audiooutput: 'hangout_speaker', videoinput: 'hangout_camera' };

export function getPreferredDevice(kind: DeviceKind): string | undefined {
  try {
    const id = localStorage.getItem(DEVICE_KEYS[kind]);
    return id && id !== 'default' ? id : undefined;
  } catch {
    return undefined;
  }
}

export async function listDevices(kind: DeviceKind, requestPermissions = true): Promise<MediaDeviceInfo[]> {
  try {
    return await Room.getLocalDevices(kind, requestPermissions);
  } catch {
    return [];
  }
}

export async function setPreferredDevice(kind: DeviceKind, deviceId: string) {
  const system = deviceId === 'default';
  const { room } = get();
  if (kind === 'videoinput' && room) {
    try {
      if (!await room.switchActiveDevice(kind, deviceId, !system)) {
        showError(t('voice.err.device'));
        return;
      }
    } catch {
      showError(t('voice.err.device'));
      return;
    }
  }
  try {
    if (system) localStorage.removeItem(DEVICE_KEYS[kind]);
    else localStorage.setItem(DEVICE_KEYS[kind], deviceId);
  } catch {
    // Not persisted, but still applied to the current call below.
  }
  if (!room || kind === 'videoinput') return;
  try {
    await room.switchActiveDevice(kind, system && kind === 'audiooutput' ? '' : deviceId, !system);
  } catch {
    showError(t('voice.err.device'));
  }
}
