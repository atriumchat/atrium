import { Room, Track, type RemoteParticipant } from 'livekit-client';
import { showError, useStore } from '../store';
import { t } from '../i18n';

/** How loud each person plays, and which microphone and speakers calls use. */

const get = useStore.getState;

// Per-person volume (0..2), kept for the session so it survives reconnects and channel switches.
const userVolumes = new Map<string, number>();
const audibleVolumes = new Map<string, number>();

// How loud the whole call plays (0..2), on top of each person's own volume; kept on this device.
const OUTPUT_KEY = 'atrium_output_volume';
let output = (() => {
  try {
    const saved = Number(localStorage.getItem(OUTPUT_KEY));
    return localStorage.getItem(OUTPUT_KEY) !== null && Number.isFinite(saved) ? Math.min(2, Math.max(0, saved)) : 1;
  } catch {
    return 1;
  }
})();

export const getOutputVolume = () => output;

export function setOutputVolume(volume: number) {
  output = volume;
  try {
    localStorage.setItem(OUTPUT_KEY, String(volume));
  } catch {
    // Not remembered; still applied to this call.
  }
  get().room?.remoteParticipants.forEach(applyVolume);
}

export function applyVolume(participant: RemoteParticipant) {
  const volume = (userVolumes.get(participant.identity) ?? 1) * output;
  participant.setVolume(volume);
  participant.setVolume(volume, Track.Source.ScreenShareAudio);
}

export function getUserVolume(userId: string) {
  return userVolumes.get(userId) ?? 1;
}

export function setUserVolume(userId: string, volume: number) {
  userVolumes.set(userId, volume);
  if (volume > 0) audibleVolumes.set(userId, volume);
  const participant = get().room?.remoteParticipants.get(userId);
  if (participant) applyVolume(participant);
}

export function toggleUserMute(userId: string) {
  const volume = getUserVolume(userId) === 0 ? audibleVolumes.get(userId) ?? 1 : 0;
  setUserVolume(userId, volume);
  return volume;
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
