import { useEffect, useReducer } from 'react';
import { RoomEvent, Track, type Participant, type Room } from 'livekit-client';

const EVENTS = [
  RoomEvent.ParticipantConnected, RoomEvent.ParticipantDisconnected, RoomEvent.TrackSubscribed, RoomEvent.TrackUnsubscribed,
  RoomEvent.TrackMuted, RoomEvent.TrackUnmuted, RoomEvent.LocalTrackPublished, RoomEvent.LocalTrackUnpublished, RoomEvent.TrackPublished, RoomEvent.TrackUnpublished,
] as const;

type TrackRef = { participant: Participant; publication: NonNullable<ReturnType<Participant['getTrackPublication']>>; source: Track.Source };
/** Someone in the call, with their camera and their shared screen when each is really showing something. */
export type Stage = { participant: Participant; camera?: TrackRef; screen?: TrackRef };

/** Everyone in the room, with their camera and screen when really showing something (a muted track would draw black). */
export function useStage(room: Room | null): Stage[] {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    if (!room) return;
    for (const e of EVENTS) room.on(e, bump);
    return () => { for (const e of EVENTS) room.off(e, bump); };
  }, [room]);
  if (!room) return [];
  return [room.localParticipant, ...room.remoteParticipants.values()].map((participant) => {
    const track = (source: Track.Source): TrackRef | undefined => {
      const publication = participant.getTrackPublication(source);
      return publication && !publication.isMuted && publication.track ? { participant, publication, source } : undefined;
    };
    return { participant, camera: track(Track.Source.Camera), screen: track(Track.Source.ScreenShare) };
  });
}
