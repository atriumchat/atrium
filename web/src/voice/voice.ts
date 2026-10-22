import { createLocalVideoTrack, type AudioCaptureOptions, DisconnectReason, LocalVideoTrack, Room, RoomEvent, ScreenSharePresets, Track, VideoPresets } from 'livekit-client';
import { api } from '../api';
import { getSocket, movedText } from '../socket';
import { isDmId, openDm, selectChannel, selfEntry, showError, useStore } from '../store';
import { playSound } from './sounds';
import { applyNoise, micTrack, suspendNoise } from './noise';
import { applyVolume, getPreferredDevice } from './devices';
import { savePrefs, type VoicePrefs } from '../prefs';
import { desktop } from '../desktop';
import { startQualityReports, type QualityReporter } from './report';
// Push-to-talk listens from the moment the call code loads; it calls back into applyMic() below.
import './ptt';
import { t } from '../i18n';

/** The call itself: connecting to LiveKit, the mic, camera and screen, leaving. */

const set = useStore.setState;
const get = useStore.getState;

function emitVoiceUpdate() {
  const { voiceStatus, muted, deafened, screenSharing, cameraOn } = get();
  if (voiceStatus !== 'connected') return;
  getSocket()?.emit('voice:update', { muted, deafened, screen: screenSharing, video: cameraOn });
}

function syncLocalMedia(room: Room) {
  const before = get();
  if (before.room !== room) return;
  const screenSharing = room.localParticipant.isScreenShareEnabled;
  const cameraOn = room.localParticipant.isCameraEnabled;
  // Covers our buttons and the browser's own "Stop sharing" bar alike.
  if ((screenSharing && !before.screenSharing) || (cameraOn && !before.cameraOn)) playSound('mediaOn');
  else if ((!screenSharing && before.screenSharing) || (!cameraOn && before.cameraOn)) playSound('mediaOff');
  set({ screenSharing, cameraOn });
  emitVoiceUpdate();
}

/** The mic is live unless muted or deafened, and, in push-to-talk mode, only while the key is held. */
export async function applyMic() {
  const { room, muted, deafened, voicePrefs, pttDown } = get();
  if (!room) return;
  const live = !muted && !deafened && (!voicePrefs.ptt || pttDown);
  try {
    await room.localParticipant.setMicrophoneEnabled(live);
  } catch (e) {
    // Only a mic that really didn't come on counts as muted: a publish can time out on a slow network after the
    // mic is already live, and a muted icon over a live mic is worse than no change.
    if (live && !room.localParticipant.isMicrophoneEnabled) {
      set({ muted: true });
      showError(
        e instanceof Error && e.name === 'NotAllowedError'
          ? t('voice.err.micDenied')
          : t('voice.err.micFailed', { error: e instanceof Error ? e.message : String(e) }),
      );
    } else if (!live && room.localParticipant.isMicrophoneEnabled) {
      showError(t('voice.err.micOffFailed'));
    }
  }
  if (live) await applyNoise();
  emitVoiceUpdate();
}

/** Change voice settings: saved on this device and applied to the call right away where possible. */
export async function setVoicePrefs(patch: Partial<VoicePrefs>) {
  const before = get().voicePrefs;
  const prefs = { ...before, ...patch };
  set({ voicePrefs: prefs, pttDown: false });
  savePrefs(prefs);
  const track = micTrack();
  if (track && patch.noise && patch.noise !== before.noise) {
    // The browser's own suppression is a capture setting: re-open the mic with it on or off (off under RNNoise,
    // which does the job itself). A processor here is RNNoise on its way out: dropped first, not rebuilt on a new mic.
    try {
      if (track.getProcessor()) await track.stopProcessor();
      await track.restartTrack({
        noiseSuppression: prefs.noise === 'browser',
        echoCancellation: true,
        autoGainControl: true,
        deviceId: getPreferredDevice('audioinput'),
      });
    } catch (e) {
      showError(t('voice.err.micFailed', { error: e instanceof Error ? e.message : String(e) }));
    }
  }
  await applyMic();
  await applyNoise();
}

let reporter: QualityReporter | null = null;

function resetVoice() {
  reporter?.drop();
  reporter = null;
  suspendNoise();
  // Gone from the room's list at once, not when the server's next update comes round.
  const { me, voiceChannelId } = get();
  set((s) => ({
    voiceState: s.voiceState.filter((e) => !(e.userId === me?.id && e.channelId === voiceChannelId)),
  }));
  set({
    room: null,
    voiceChannelId: null,
    voiceStatus: 'idle',
    joinedAt: null,
    speaking: [],
    screenSharing: false,
    cameraOn: false,
    cameraPending: false,
    cameraPreview: null,
  });
}

const LAST_ROOM = 'gomex_last_room';

/** The server voice room you were in last: the home screen offers it back when everyone's quiet. */
export function lastRoomId(): string | null {
  try {
    return localStorage.getItem(LAST_ROOM);
  } catch {
    return null;
  }
}

/**
 * Join a server voice room, or start/answer the call in a DM or group (`channelId` = DM id). `navigate`
 * opens it on screen; a reconnect in place leaves the screen alone.
 */
export async function joinVoice(channelId: string, { video = false, navigate = true } = {}) {
  if (isDmId(channelId)) {
    if (navigate) openDm(channelId);
  } else {
    if (navigate) selectChannel(channelId);
    try {
      localStorage.setItem(LAST_ROOM, channelId);
    } catch {
      // Private mode: the home screen falls back to the first room.
    }
  }
  const current = get();
  if (current.voiceChannelId === channelId && current.voiceStatus !== 'idle') return;
  await leaveVoice({ silent: true });

  const self = selfEntry(channelId);
  set((s) => ({
    voiceChannelId: channelId,
    voiceStatus: 'connecting',
    voiceState: self ? [...s.voiceState.filter((e) => e.userId !== self.userId), self] : s.voiceState,
  }));
  const room = new Room({
    adaptiveStream: true,
    dynacast: true,
    audioCaptureDefaults: {
      echoCancellation: true,
      // RNNoise does the job itself when it's on; doubling up only muffles the voice.
      noiseSuppression: get().voicePrefs.noise === 'browser',
      autoGainControl: true,
      deviceId: getPreferredDevice('audioinput'),
    },
    audioOutput: { deviceId: getPreferredDevice('audiooutput') },
    // Throttled networks and a 1-CPU server: the camera at about 540p / 800 kbps is plenty for faces.
    videoCaptureDefaults: { resolution: VideoPresets.h540.resolution },
    publishDefaults: {
      videoEncoding: { maxBitrate: 800_000, maxFramerate: 30 },
      // Mostly games: 720p at 30 fps (~2 Mbps, was 1080p at 5) stays smooth, plus one small layer for weak connections.
      screenShareEncoding: ScreenSharePresets.h720fps30.encoding,
      screenShareSimulcastLayers: [ScreenSharePresets.h360fps15],
    },
  });
  room
    .on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
      if (get().room === room) set({ speaking: speakers.map((p) => p.identity) });
    })
    .on(RoomEvent.ParticipantConnected, applyVolume)
    .on(RoomEvent.LocalTrackPublished, () => syncLocalMedia(room))
    .on(RoomEvent.LocalTrackUnpublished, () => syncLocalMedia(room))
    .on(RoomEvent.Disconnected, (reason) => {
      // Only an unexpected drop lands here: leaveVoice() detaches the room from the store first.
      if (get().room !== room) return;
      resetVoice();
      getSocket()?.emit('voice:leave');
      // The same person joined the same room from another tab or device, and LiveKit let only one stay.
      showError(reason === DisconnectReason.DUPLICATE_IDENTITY ? movedText() : t('voice.err.lost'));
    });

  try {
    const { token, url } = await api.voiceToken(channelId);
    const relay = get().serverRelayOnly || get().voicePrefs.relayOnly;
    await room.connect(url, token, relay ? { rtcConfig: { iceTransportPolicy: 'relay' } } : undefined);
  } catch (e) {
    await room.disconnect();
    if (get().voiceChannelId === channelId) resetVoice();
    showError(t('voice.err.connect', { error: e instanceof Error ? e.message : String(e) }));
    return;
  }

  if (get().voiceChannelId !== channelId) {
    // The user switched channels or left while we were connecting.
    await room.disconnect();
    return;
  }

  room.remoteParticipants.forEach(applyVolume);
  set({ room, voiceStatus: 'connected', joinedAt: Date.now() });
  reporter = startQualityReports(room, channelId);
  const { muted, deafened } = get();
  getSocket()?.emit('voice:join', { channelId, muted, deafened });
  playSound('join');
  room.startAudio().catch(() => {
    // Autoplay blocked; the StartAudio button in the voice view covers this.
  });
  await applyMic();
  if (video) await toggleCamera();
}

/**
 * Relay-only: every call goes only through our relay on 443, the path that holds on restrictive networks.
 * In a call it reconnects right away rather than waiting for the next one.
 */
export async function setBypass(on: boolean) {
  await setVoicePrefs({ relayOnly: on });
  const { voiceChannelId, voiceStatus, cameraOn } = get();
  if (!voiceChannelId || voiceStatus === 'idle') return;
  await leaveVoice({ silent: true });
  await joinVoice(voiceChannelId, { video: cameraOn, navigate: false });
}

/** Phones and tablets' browsers can't capture the screen. */
export const canShareScreen = typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getDisplayMedia === 'function';

export async function leaveVoice({ silent = false } = {}) {
  const { room, voiceChannelId } = get();
  if (!voiceChannelId) return;
  // Taken before resetVoice() drops it: the last report needs the room still connected.
  const last = reporter;
  // Telemetry must never keep a microphone/camera alive after hangup.
  void last?.stop().catch(() => {});
  room?.localParticipant.trackPublications.forEach((publication) => publication.track?.stop());
  resetVoice();
  getSocket()?.emit('voice:leave');
  if (room) {
    await room.disconnect();
    if (!silent) playSound('leave');
  }
}

export async function toggleMute() {
  const { muted, deafened } = get();
  // Unmuting while deafened undeafens too, like Discord.
  if (muted || deafened) {
    set({ muted: false, deafened: false });
    playSound('unmute');
  } else {
    set({ muted: true });
    playSound('mute');
  }
  await applyMic();
}

export async function toggleDeafen() {
  const deafened = !get().deafened;
  set({ deafened });
  // The deafen cue must play even though we've just silenced everything else.
  playSound(deafened ? 'deafen' : 'undeafen', { force: true });
  await applyMic();
}

// The shared system sound without Atrium's own: otherwise everyone in the call hears their own voice back. Chrome and
// the desktop app honour it on Windows 11 (elsewhere it is ignored); livekit's types don't list it yet.
const sharedSound: AudioCaptureOptions & { restrictOwnAudio: boolean } = { restrictOwnAudio: true };

export async function toggleScreenShare() {
  const { room } = get();
  if (!room) return;
  const enable = !room.localParticipant.isScreenShareEnabled;
  try {
    await room.localParticipant.setScreenShareEnabled(
      enable,
      {
        audio: sharedSound,
        systemAudio: 'include',
        selfBrowserSurface: 'exclude',
        contentHint: 'motion',
        resolution: ScreenSharePresets.h720fps30.resolution,
      },
      { screenShareEncoding: ScreenSharePresets.h720fps30.encoding, screenShareSimulcastLayers: [ScreenSharePresets.h360fps15] },
    );
  } catch (e) {
    // Closing the screen picker throws NotAllowedError; that's a cancel, not an error. The desktop app's own picker
    // says it with an AbortError ("Invalid capture constraints"): Electron has no way to deny from there.
    const cancelled = e instanceof Error && (e.name === 'NotAllowedError' || (desktop && e.name === 'AbortError'));
    if (!cancelled) {
      showError(t('voice.err.share', { error: e instanceof Error ? e.message : String(e) }));
    }
  }
  syncLocalMedia(room);
}

/** Resolves once the browser has painted the current state (at most 150 ms: hidden windows don't paint). */
function afterPaint() {
  return new Promise<void>((resolve) => {
    if (document.hidden) return resolve();
    requestAnimationFrame(() => setTimeout(resolve, 0));
    setTimeout(resolve, 150);
  });
}

/**
 * The screen answers the click at once and the camera catches up. On: your tile appears straight away,
 * shows the camera as soon as the device opens and only then is the video sent to the call (sending
 * takes a round trip to the server, through the relay even longer). Off: the tile goes at once and the
 * track is dropped, not muted, so nobody is left looking at a frozen frame or an empty tile.
 */
export async function toggleCamera() {
  const { room, cameraOn } = get();
  if (!room) return;
  const local = room.localParticipant;

  if (cameraOn) {
    playSound('mediaOff');
    set({ cameraOn: false, cameraPending: false, cameraPreview: null });
    // Stopping the camera blanks the video at once, but the new layout only lands with the next painted
    // frame; stop it after that frame, or the empty tile shows for a moment.
    await afterPaint();
    const track = local.getTrackPublication(Track.Source.Camera)?.track;
    if (track) await local.unpublishTrack(track, true);
    syncLocalMedia(room);
    return;
  }

  playSound('mediaOn');
  set({ cameraOn: true, cameraPending: true });
  let track: LocalVideoTrack | null = null;
  const stillWanted = () => get().room === room && get().cameraOn;
  try {
    track = await createLocalVideoTrack({ resolution: VideoPresets.h720.resolution });
    if (stillWanted()) {
      set({ cameraPreview: track.mediaStreamTrack });
      await local.publishTrack(track, { source: Track.Source.Camera });
    }
    // Switched off (or left) while the camera was opening.
    if (!stillWanted()) {
      if (local.getTrackPublication(Track.Source.Camera)?.track === track) await local.unpublishTrack(track, true);
      else track.stop();
    }
  } catch {
    track?.stop();
    if (get().room === room) set({ cameraOn: false });
    showError(t('voice.err.camera'));
  } finally {
    if (get().room === room) set({ cameraPending: false, cameraPreview: null });
  }
  syncLocalMedia(room);
}
