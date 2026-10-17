import { useEffect, useRef, useState } from 'react';
import { Button, Popover, Spinner } from '@heroui/react';
import { StartAudio, useIsSpeaking, useParticipants, useTracks, VideoTrack } from '@livekit/components-react';
import type { TrackReference } from '@livekit/components-react';
import { RemoteParticipant, Track, type Participant } from 'livekit-client';
import { useStore, voiceMembers } from '../store';
import { canShareScreen, joinVoice, leaveVoice, toggleCamera, toggleDeafen, toggleMute, toggleScreenShare } from './voice';
import { useIsMobile } from '../hooks';
import type { Channel } from '../types';
import { Avatar } from '../ui/Avatar';
import { BubbleCloud } from './Bubbles';
import { CallDuration } from './CallDuration';
import { ChannelHeader, HeaderIcon } from '../shell/ChannelHeader';
import { ChannelMenu } from '../shell/ChannelMenu';
import { RoundButton, VolumeSlider } from '../ui/ui';
import { LineArt } from '../ui/Illustrations';
import {
  ExpandIcon,
  HeadphonesIcon,
  HeadphonesSlashIcon,
  MicIcon,
  MicSlashIcon,
  PhoneDownIcon,
  ScreenIcon,
  SpeakerIcon,
  VideoIcon,
  VideoSlashIcon,
} from '../ui/icons';

export function VoiceView({ channel }: { channel: Channel }) {
  const myChannel = useStore((s) => s.voiceChannelId);
  const status = useStore((s) => s.voiceStatus);
  const room = useStore((s) => s.room);
  const live = myChannel === channel.id && status === 'connected' && room !== null;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <ChannelHeader
        bare
        leading={
          <HeaderIcon>
            <SpeakerIcon />
          </HeaderIcon>
        }
        title={channel.name}
        actions={<ChannelMenu channelId={channel.id} />}
        subtitle={
          live ? (
            <span className="tabular-nums">
              Идёт звонок · <CallDuration />
            </span>
          ) : undefined
        }
      />
      {live ? <ConnectedStage channelId={channel.id} /> : <JoinPrompt channel={channel} connecting={myChannel === channel.id && status === 'connecting'} />}
    </div>
  );
}

/** Discord's "No one is currently in voice / Join Voice" screen. */
function JoinPrompt({ channel, connecting }: { channel: Channel; connecting: boolean }) {
  const voiceState = useStore((s) => s.voiceState);
  const users = useStore((s) => s.users);
  const members = voiceMembers(voiceState, channel.id);

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 pb-16 text-center">
      {members.length === 0 && <LineArt art="voice" className="mb-6" />}
      <h2 className="text-[30px] font-bold">{channel.name}</h2>
      {members.length > 0 ? (
        <div className="flex flex-col items-center gap-3">
          <p className="text-[15px] text-foreground/80">Сейчас в комнате: {members.map((m) => users[m.userId]?.name ?? '…').join(', ')}</p>
          <div className="flex -space-x-2">
            {members.slice(0, 8).map((m) => (
              <Avatar key={m.userId} user={users[m.userId]} size={40} ringBg="var(--background)" />
            ))}
          </div>
        </div>
      ) : (
        <p className="text-[15px] text-muted">В комнате никого нет</p>
      )}
      <Button
        onPress={() => joinVoice(channel.id)}
        isPending={connecting}
        className="mt-4 h-10 rounded-[10px] px-5 text-[15px] [--button-bg:white] [--button-bg-hover:#e7e7ea] [--button-fg:#0b0b0c]"
      >
        {connecting ? 'Подключаемся…' : 'Присоединиться'}
      </Button>
    </div>
  );
}

const trackKey = (t: TrackReference) => `${t.participant.identity}:${t.publication.trackSid}`;

/**
 * Cameras and screens that are actually showing something. Turning a camera off only mutes its track (the
 * publication stays), and a muted track would draw as a black frame.
 */
export function useLiveVideo(sources: Track.Source[]) {
  const cameraOn = useStore((s) => s.cameraOn);
  return useTracks(sources).filter(
    (t) =>
      !t.publication.isMuted &&
      !!t.publication.track &&
      // Your own camera goes the moment you switch it off, without waiting for LiveKit to finish.
      !(t.participant.isLocal && t.source === Track.Source.Camera && !cameraOn),
  );
}

/** Everyone as bubbles while it's just voice; tiles and screens once someone turns on a camera or shares. */
function ConnectedStage({ channelId }: { channelId: string }) {
  const media = useLiveVideo([Track.Source.Camera, Track.Source.ScreenShare]);
  const cameraPending = useStore((s) => s.cameraPending);
  const voiceState = useStore((s) => s.voiceState);
  const speaking = useStore((s) => s.speaking);
  const people = voiceMembers(voiceState, channelId).map((m) => ({ id: m.userId, muted: m.muted, deafened: m.deafened }));
  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {media.length > 0 || cameraPending ? <MediaStage /> : <BubbleCloud people={people} speaking={speaking} live />}
      <StartAudio
        label="Включить звук"
        className="absolute left-1/2 top-2 -translate-x-1/2 rounded-full bg-accent px-5 py-2 text-[14px] font-medium text-accent-foreground"
      />
      {/* Full-screen voice room on a phone: keep the buttons clear of the home indicator. */}
      <CallControls className="max-md:pb-[max(20px,env(safe-area-inset-bottom))]" />
    </div>
  );
}

/** Screen shares and people tiles of the call we're in. Needs the LiveKit room context. */
export function MediaStage() {
  const participants = useParticipants();
  const screens = useLiveVideo([Track.Source.ScreenShare]);
  const cameras = useLiveVideo([Track.Source.Camera]);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const isMobile = useIsMobile();
  const focused = screens.find((t) => trackKey(t) === focusKey) ?? screens[0];
  const cameraOf = new Map(cameras.map((t) => [t.participant.identity, t]));
  const cols = participants.length <= 1 ? 1 : participants.length <= 4 || isMobile ? 2 : 3;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {focused ? (
        <>
          <div className="min-h-0 flex-1 px-4">
            <ScreenStage trackRef={focused} />
          </div>
          <div className="flex shrink-0 justify-center gap-3 overflow-x-auto px-4 pt-3">
            {screens.length > 1 &&
              screens.map((t) => (
                <button
                  key={trackKey(t)}
                  onClick={() => setFocusKey(trackKey(t))}
                  aria-label="Показать эту трансляцию"
                  className={`aspect-video h-24 shrink-0 overflow-hidden rounded-[12px] bg-black ${
                    trackKey(t) === trackKey(focused) ? 'ring-2 ring-accent' : ''
                  }`}
                >
                  <VideoTrack trackRef={t} className="h-full w-full object-cover" />
                </button>
              ))}
            {participants.map((p) => (
              <div key={p.identity} className="h-24 shrink-0">
                <Tile participant={p} camera={cameraOf.get(p.identity)} compact />
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto px-4">
          <div className="grid w-full gap-3" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, maxWidth: cols === 1 ? 760 : 1240 }}>
            {participants.map((p) => (
              <Tile key={p.identity} participant={p} camera={cameraOf.get(p.identity)} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ScreenStage({ trackRef }: { trackRef: TrackReference }) {
  const ref = useRef<HTMLDivElement>(null);
  const user = useStore((s) => s.users[trackRef.participant.identity]);
  return (
    <div ref={ref} className="group relative flex h-full w-full items-center justify-center overflow-hidden rounded-[16px] bg-black">
      <VideoTrack trackRef={trackRef} className="h-full w-full object-contain" />
      <div className="absolute left-3 top-3 flex items-center gap-2 rounded-[8px] bg-black/60 px-2.5 py-1 text-[13px] font-medium text-white">
        <span className="rounded-[4px] bg-danger px-1 text-[11px] font-bold uppercase leading-4">В эфире</span>
        {user?.name ?? trackRef.participant.name}
      </div>
      <RoundButton
        label="На весь экран"
        placement="left"
        onPress={() => ref.current?.requestFullscreen()}
        className="absolute right-3 top-3 opacity-0 group-hover:opacity-100 data-[focus-visible=true]:opacity-100"
      >
        <ExpandIcon />
      </RoundButton>
    </div>
  );
}

/** A camera track that isn't in the call yet, played locally and mirrored like your published one. */
function DeviceVideo({ track }: { track: MediaStreamTrack }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = new MediaStream([track]);
  }, [track]);
  return <video ref={ref} autoPlay muted playsInline className="h-full w-full -scale-x-100 bg-black object-contain" />;
}

/** Discord-style tile: the person's colour as background, avatar centred, name tag and mute badge bottom-left. */
function Tile({ participant, camera, compact = false }: { participant: Participant; camera?: TrackReference; compact?: boolean }) {
  const speaking = useIsSpeaking(participant);
  const user = useStore((s) => s.users[participant.identity]);
  const entry = useStore((s) =>
    (s.calls[s.voiceChannelId ?? '']?.participants ?? s.voiceState).find((e) => e.userId === participant.identity),
  );
  const name = user?.name ?? participant.name ?? '';
  const muted = entry?.muted || entry?.deafened;
  // Your camera on its way: straight from the device, or a dark tile until the device opens.
  const pending = useStore((s) => s.cameraPending) && participant.isLocal && !camera;
  const preview = useStore((s) => s.cameraPreview);

  const tile = (
    <div
      className="relative flex aspect-video h-full w-full items-center justify-center overflow-hidden rounded-[16px]"
      // Black under video: a stopped or stalled stream shows dark, not a flash of the person's colour.
      style={{ background: pending || camera ? 'black' : `color-mix(in oklab, ${user?.color ?? 'var(--accent)'} 55%, var(--background))` }}
    >
      {pending ? (
        preview ? <DeviceVideo track={preview} /> : <Spinner size={compact ? 'sm' : 'md'} color="current" className="text-white/60" />
      ) : camera ? (
        // The whole frame, never cropped: 4:3 webcams get dark bars instead of losing forehead and chin.
        // Your own camera is mirrored, like a selfie preview.
        <VideoTrack trackRef={camera} className={`h-full w-full bg-black object-contain ${participant.isLocal ? '-scale-x-100' : ''}`} />
      ) : (
        <Avatar user={user} size={compact ? 40 : 96} ringBg="transparent" />
      )}
      <div
        className="pointer-events-none absolute inset-0 rounded-[16px] transition-shadow duration-100"
        style={{ boxShadow: speaking ? 'inset 0 0 0 3px var(--success)' : undefined }}
      />
      <div className="absolute bottom-2 left-2 flex max-w-[85%] items-center gap-1.5 rounded-[8px] bg-black/55 px-2 py-1 text-[13px] font-medium text-white">
        {muted && (entry?.deafened ? <HeadphonesSlashIcon size={14} /> : <MicSlashIcon size={14} />)}
        <span className="truncate">
          {name}
          {participant.isLocal ? ' (вы)' : ''}
        </span>
      </div>
    </div>
  );

  if (!(participant instanceof RemoteParticipant)) return tile;
  return (
    <Popover>
      <Popover.Trigger aria-label={`Громкость: ${name}`} className="block h-full w-full cursor-pointer rounded-[16px] outline-none">
        {tile}
      </Popover.Trigger>
      <Popover.Content placement="bottom" className="w-64">
        <Popover.Dialog className="p-5">
          <VolumeSlider userId={participant.identity} name={name} />
        </Popover.Dialog>
      </Popover.Content>
    </Popover>
  );
}

/** Call controls at the bottom of the call screen. Toggled-on buttons turn white; a muted mic gets a red icon. */
export function CallControls({ className = '' }: { className?: string }) {
  const muted = useStore((s) => s.muted);
  const deafened = useStore((s) => s.deafened);
  const cameraOn = useStore((s) => s.cameraOn);
  const screenSharing = useStore((s) => s.screenSharing);
  const micOff = muted || deafened;

  return (
    <div className={`flex shrink-0 items-center justify-center gap-3 py-5 ${className} [&_button]:h-[52px] [&_button]:min-w-[52px]`}>
      <RoundButton size="lg" tone={cameraOn ? 'on' : 'plain'} label={cameraOn ? 'Выключить камеру' : 'Включить камеру'} onPress={toggleCamera}>
        {cameraOn ? <VideoIcon /> : <VideoSlashIcon />}
      </RoundButton>
      {canShareScreen && (
        <RoundButton size="lg" tone={screenSharing ? 'on' : 'plain'} label={screenSharing ? 'Остановить демонстрацию' : 'Показать экран'} onPress={toggleScreenShare}>
          <ScreenIcon />
        </RoundButton>
      )}
      <RoundButton size="lg" tone={micOff ? 'on' : 'plain'} alert={micOff} label={micOff ? 'Включить микрофон' : 'Выключить микрофон'} onPress={toggleMute}>
        {micOff ? <MicSlashIcon /> : <MicIcon />}
      </RoundButton>
      <RoundButton size="lg" tone={deafened ? 'on' : 'plain'} alert={deafened} label={deafened ? 'Включить звук' : 'Выключить звук'} onPress={toggleDeafen}>
        {deafened ? <HeadphonesSlashIcon /> : <HeadphonesIcon />}
      </RoundButton>
      <Button variant="danger" aria-label="Отключиться" onPress={() => leaveVoice()} className="w-[72px] rounded-full px-0 text-white [--button-fg:white] [&_svg]:size-6">
        <PhoneDownIcon />
      </Button>
    </div>
  );
}
