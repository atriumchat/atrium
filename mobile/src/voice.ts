import { AudioSession, AndroidAudioTypePresets } from '@livekit/react-native';
import { Room, RoomEvent, ConnectionState } from 'livekit-client';
import { PermissionsAndroid, Platform } from 'react-native';
import { create } from 'zustand';
import { api } from './api';
import { getSocket, registerVoiceCleanup, showError, useStore } from './store';
import { haptic } from './haptics';

type Voice = { channelId: string | null; status: 'idle' | 'connecting' | 'connected'; muted: boolean; camera: boolean; speaker: boolean; room: Room | null; speaking: string[]; joinedAt: number | null };
export const useVoice = create<Voice>(() => ({ channelId: null, status: 'idle', muted: false, camera: false, speaker: true, room: null, speaking: [], joinedAt: null }));
/** The room you were in last: the home screen offers it back when everyone is quiet. */
let lastRoom: string | null = null;
export const lastRoomId = () => lastRoom;
let generation = 0;

export async function leaveVoice() {
  generation++;
  const { room } = useVoice.getState();
  useVoice.setState({ channelId: null, status: 'idle', room: null, muted: false, camera: false, speaking: [], joinedAt: null });
  getSocket()?.emit('voice:leave');
  try { await room?.disconnect(); } finally { await AudioSession.stopAudioSession().catch(() => {}); }
}
registerVoiceCleanup(leaveVoice);

/** `muted`: come in with the mic off (picked on the room's screen before joining). */
export async function joinVoice(channelId: string, opts?: { video?: boolean; muted?: boolean }) {
  if (useVoice.getState().channelId === channelId) return;
  await leaveVoice();
  const attempt = ++generation;
  const room = new Room({ adaptiveStream: { pixelDensity: 'screen' }, dynacast: true, audioCaptureDefaults: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, videoCaptureDefaults: { resolution: { width: 640, height: 360, frameRate: 24 } } });
  lastRoom = channelId;
  const muted = !!opts?.muted;
  useVoice.setState({ channelId, status: 'connecting', room, muted });
  try {
    if (Platform.OS === 'android') {
      const permission = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
      if (permission !== PermissionsAndroid.RESULTS.GRANTED) throw new Error('Microphone permission required');
    }
    const grant = await api.voiceToken(channelId);
    if (attempt !== generation) { await room.disconnect(); return; }
    await AudioSession.configureAudio({ android: { preferredOutputList: ['bluetooth', 'headset', 'speaker', 'earpiece'], audioTypeOptions: AndroidAudioTypePresets.communication }, ios: { defaultOutput: 'speaker' } });
    await AudioSession.startAudioSession();
    if (attempt !== generation) { await room.disconnect(); return; }
    room.on(RoomEvent.ActiveSpeakersChanged, (participants) => { if (attempt === generation) useVoice.setState({ speaking: participants.map((p) => p.identity) }); });
    room.on(RoomEvent.ConnectionStateChanged, (state) => {
      if (attempt !== generation) return;
      if (state === ConnectionState.Connected) useVoice.setState((v) => ({ status: 'connected', joinedAt: v.joinedAt ?? Date.now() }));
      else if (state === ConnectionState.Reconnecting) useVoice.setState({ status: 'connecting' });
    });
    room.on(RoomEvent.Disconnected, () => { if (attempt === generation) void leaveVoice(); });
    const relayOnly = useStore.getState().data?.relayOnly;
    await room.connect(grant.url, grant.token, { rtcConfig: relayOnly ? { iceTransportPolicy: 'relay' } : undefined });
    if (attempt !== generation) { await room.disconnect(); return; }
    await room.localParticipant.setMicrophoneEnabled(!muted);
    if (attempt !== generation) { await room.disconnect(); return; }
    getSocket()?.emit('voice:join', { channelId, muted, deafened: false });
    if (opts?.video) await toggleCamera();
    useVoice.setState((v) => ({ status: 'connected', joinedAt: v.joinedAt ?? Date.now() }));
    haptic.success();
  } catch (error) {
    if (attempt === generation) { await leaveVoice(); showError(error); }
    else await room.disconnect();
  }
}

export async function toggleMute() {
  const { room, muted } = useVoice.getState();
  if (!room) return;
  try {
    await room.localParticipant.setMicrophoneEnabled(muted);
    useVoice.setState({ muted: !muted });
    // Off is a hard click, on a soft one: you can tell which without looking.
    if (muted) haptic.soft(); else haptic.rigid();
    getSocket()?.emit('voice:update', { muted: !muted });
  } catch (e) { showError(e); }
}
export async function toggleCamera() {
  const { room, camera } = useVoice.getState();
  if (!room) return;
  try {
    if (Platform.OS === 'android' && !camera) {
      const permission = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.CAMERA);
      if (permission !== PermissionsAndroid.RESULTS.GRANTED) return;
    }
    await room.localParticipant.setCameraEnabled(!camera);
    useVoice.setState({ camera: !camera });
    getSocket()?.emit('voice:update', { video: !camera });
  } catch (e) { showError(e); }
}
export async function toggleSpeaker() {
  if (Platform.OS === 'ios') { await AudioSession.showAudioRoutePicker().catch(showError); return; }
  const next = !useVoice.getState().speaker;
  try { await AudioSession.selectAudioOutput(next ? 'speaker' : 'earpiece'); useVoice.setState({ speaker: next }); }
  catch (e) { showError(e); }
}

useStore.subscribe((state, prev) => {
  const voice = useVoice.getState();
  // Someone new in the call you're in: a knock you can feel.
  if (voice.status === 'connected' && voice.channelId && state.voice !== prev.voice) {
    const meId = state.data?.me.id;
    const count = (list: typeof state.voice) => list.filter((e) => e.channelId === voice.channelId && e.userId !== meId).length;
    if (count(state.voice) > count(prev.voice)) haptic.knock();
  }
  if (state.connected && !prev.connected && voice.channelId && voice.status === 'connected') {
    getSocket()?.emit('voice:join', { channelId: voice.channelId, muted: voice.muted, deafened: false });
    getSocket()?.emit('voice:update', { video: voice.camera });
  }
  if (voice.channelId && state.data !== prev.data && state.data && !state.data.channels.some((c) => c.id === voice.channelId) && !state.dms.some((d) => d.id === voice.channelId)) void leaveVoice();
});
