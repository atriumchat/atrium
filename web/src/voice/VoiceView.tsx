import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Popover, Spinner } from '@heroui/react';
import { StartAudio, useIsSpeaking, useParticipants, useTracks, VideoTrack } from '@livekit/components-react';
import type { TrackReference } from '@livekit/components-react';
import { RemoteParticipant, Track, type Participant } from 'livekit-client';
import { setVoiceChat, useStore, voiceMembers } from '../store';
import { ChatView } from '../chat/ChatView';
import { canShareScreen, joinVoice, leaveVoice, toggleCamera, toggleDeafen, toggleMute, toggleScreenShare } from './voice';
import { useIsMobile } from '../hooks';
import type { Channel } from '../types';
import { Avatar } from '../ui/Avatar';
import { BubbleCloud } from './Bubbles';
import { CallDuration } from './CallDuration';
import { ChannelHeader, HeaderIcon } from '../shell/ChannelHeader';
import { ChannelMenu } from '../shell/ChannelMenu';
import { RoundButton, VolumeSlider } from '../ui/ui';
import { DeviceMenu } from '../shell/SettingsMenu';
import { FaceStack } from '../shell/CallPill';
import { useTileGrid } from './tileGrid';
import { LineArt } from '../ui/Illustrations';
import {
  BubbleIcon,
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
  XIcon,
} from '../ui/icons';
import { useT } from '../i18n';

export function VoiceView({ channel }: { channel: Channel }) {
  const { t } = useT();
  const myChannel = useStore((s) => s.voiceChannelId);
  const status = useStore((s) => s.voiceStatus);
  const room = useStore((s) => s.room);
  const live = myChannel === channel.id && status === 'connected' && room !== null;
  const chatOpen = useStore((s) => s.voiceChatOpen);
  const unread = useStore((s) => (s.unread[channel.id] ?? 0) > 0);

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
        actions={
          <>
            <span className="relative">
              <RoundButton label={chatOpen ? t('voice.chat.close') : t('voice.chat.open')} tone={chatOpen ? 'on' : 'plain'} onPress={() => setVoiceChat(!chatOpen)}>
                <BubbleIcon />
              </RoundButton>
              {unread && !chatOpen && <span aria-hidden className="pointer-events-none absolute right-0.5 top-0.5 h-2.5 w-2.5 rounded-full bg-danger ring-2 ring-[var(--app-window)]" />}
            </span>
            <ChannelMenu channelId={channel.id} />
          </>
        }
        subtitle={
          live ? (
            <span className="tabular-nums">
              {t('voice.call.ongoing')} · <CallDuration />
            </span>
          ) : undefined
        }
      />
      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          {live ? <ConnectedStage channelId={channel.id} /> : <JoinPrompt channel={channel} connecting={myChannel === channel.id && status === 'connecting'} />}
        </div>
        {chatOpen && <RoomChat channel={channel} />}
      </div>
    </div>
  );
}

/**
 * The room's own chat beside the call, as in Discord: links and pictures while you talk. A column on the right on a
 * computer; on a phone it covers the room, with the call going on under it.
 */
function RoomChat({ channel }: { channel: Channel }) {
  const { t } = useT();
  return (
    <aside className="flex w-[360px] shrink-0 flex-col border-l border-white/[0.06] max-md:absolute max-md:inset-0 max-md:z-30 max-md:w-auto max-md:border-l-0 max-md:bg-[var(--app-window)]">
      <header className="flex h-14 shrink-0 items-center gap-2 pl-5 pr-3">
        <h3 className="min-w-0 flex-1 truncate text-[20px] font-light tracking-[-0.3px]">{t('voice.chat.title')}</h3>
        <RoundButton size="sm" tone="ghost" label={t('voice.chat.close')} onPress={() => setVoiceChat(false)}>
          <XIcon />
        </RoundButton>
      </header>
      <ChatView key={channel.id} conversation={{ id: channel.id, kind: 'channel', title: channel.name }} room />
    </aside>
  );
}

/**
 * Before you're in (as in the native app): the faces of who's there, their names, a line when someone shows their
 * screen, the list of people; at the bottom the mic you'll come in with and a big green Join.
 */
function JoinPrompt({ channel, connecting }: { channel: Channel; connecting: boolean }) {
  const { t } = useT();
  const voiceState = useStore((s) => s.voiceState);
  const users = useStore((s) => s.users);
  const micOff = useStore((s) => s.muted || s.deafened);
  const members = voiceMembers(voiceState, channel.id);
  const names = members.map((m) => users[m.userId]?.name ?? '…');
  const who = names.length > 3 ? t('people.who.andMore', { names: names.slice(0, 2).join(', '), n: names.length - 2 }) : names.join(', ');
  const sharing = members.find((m) => m.screen);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className={`flex flex-1 flex-col overflow-y-auto px-4 pt-4 ${members.length ? '' : 'justify-center pb-16'}`}>
        <div className="flex flex-col items-center text-center">
          {members.length ? (
            <div className="flex items-center justify-center">
              {members.slice(0, 4).map((m, i) => (
                <span key={m.userId} className={`rounded-full ring-[3px] ring-[var(--app-window)] ${i ? '-ml-4' : ''} ${i % 2 ? 'mt-6' : ''}`}>
                  <Avatar user={users[m.userId]} size={64} />
                </span>
              ))}
            </div>
          ) : (
            <LineArt art="voice" />
          )}
          <h2 className="mt-4 line-clamp-2 text-[26px] font-bold leading-8">{channel.name}</h2>
          <p className="mt-1 text-[16px] text-muted">{members.length ? who : t('voice.room.nobody')}</p>
          {/* On a computer Join sits right under the room; the mic is in the panel at the bottom left. */}
          <button
            type="button"
            onClick={() => joinVoice(channel.id)}
            disabled={connecting}
            className="mt-6 flex h-11 min-w-40 items-center justify-center whitespace-nowrap rounded-full bg-[#f2f2f4] px-6 text-[15px] font-semibold text-[#0c0c0e] transition-[background-color,transform] duration-150 hover:bg-white active:scale-[0.98] disabled:opacity-80 max-md:hidden"
          >
            {connecting ? <Spinner size="sm" color="current" /> : t('voice.room.joinVoice')}
          </button>
        </div>
        {sharing && (
          <div className="mx-auto mt-5 flex w-full max-w-md items-center gap-2.5 rounded-2xl bg-default p-3.5">
            <ScreenIcon size={20} className="shrink-0 text-danger" />
            <span className="truncate text-[16px]">{t('voice.room.sharing', { name: users[sharing.userId]?.name ?? '…' })}</span>
          </div>
        )}
        {members.length > 0 && (
          <div className="mx-auto mt-5 w-full max-w-md overflow-hidden rounded-[20px] bg-default">
            {members.map((m, i) => (
              <div key={m.userId}>
                {i > 0 && <div className="ml-[62px] h-px bg-white/[0.08]" />}
                <div className="flex min-h-14 items-center gap-3 px-3.5">
                  <Avatar user={users[m.userId]} size={36} ringBg="var(--default)" />
                  <span className="min-w-0 flex-1 truncate text-[16px] max-md:text-[17px]">{users[m.userId]?.name ?? '…'}</span>
                  {m.screen && <ScreenIcon size={18} className="shrink-0 text-danger" />}
                  {m.video && <VideoIcon size={18} className="shrink-0 text-muted" />}
                  {m.deafened ? <HeadphonesSlashIcon size={18} className="shrink-0 text-muted" /> : m.muted ? <MicSlashIcon size={18} className="shrink-0 text-muted" /> : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      {/* The phone's dock: the mic you'll come in with (white is on), and Join under the thumb. */}
      <div className="shrink-0 px-3 pb-[max(12px,env(safe-area-inset-bottom))] pt-2 md:hidden">
        <div className="mx-auto flex max-w-md items-center gap-2.5 rounded-[38px] border-[0.5px] border-white/10 bg-default p-3">
          <button
            type="button"
            onClick={() => void toggleMute()}
            aria-label={micOff ? t('voice.mic.unmute') : t('voice.mic.mute')}
            className={`flex size-14 shrink-0 items-center justify-center rounded-full transition-[background-color,transform] duration-150 active:scale-95 ${micOff ? 'bg-white/10 text-danger' : 'bg-white text-black'}`}
          >
            {micOff ? <MicSlashIcon size={26} /> : <MicIcon size={26} />}
          </button>
          <button
            type="button"
            onClick={() => joinVoice(channel.id)}
            disabled={connecting}
            className="flex h-14 flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-full bg-[#f2f2f4] text-[17px] font-semibold text-[#0c0c0e] transition-[background-color,transform] duration-150 hover:bg-white active:scale-[0.98] disabled:opacity-80"
          >
            {connecting ? <Spinner size="sm" color="current" /> : t('voice.room.joinVoice')}
          </button>
        </div>
      </div>
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

/**
 * The call we're in. On a computer everyone is a tile (MediaStage), voice or not; on a phone, bubbles while it's just
 * voice, tiles once someone turns on a camera or shares.
 */
function ConnectedStage({ channelId }: { channelId: string }) {
  const { t } = useT();
  const isMobile = useIsMobile();
  const media = useLiveVideo([Track.Source.Camera, Track.Source.ScreenShare]);
  const cameraPending = useStore((s) => s.cameraPending);
  const voiceState = useStore((s) => s.voiceState);
  const speaking = useStore((s) => s.speaking);
  const people = voiceMembers(voiceState, channelId).map((m) => ({ id: m.userId, muted: m.muted, deafened: m.deafened }));
  const bubbles = isMobile && !(media.length > 0 || cameraPending);
  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {bubbles ? <BubbleCloud people={people} speaking={speaking} live /> : <MediaStage />}
      <StartAudio
        label={t('voice.audio.enable')}
        className="absolute left-1/2 top-2 -translate-x-1/2 rounded-full bg-accent px-5 py-2 text-[14px] font-medium text-accent-foreground"
      />
      {/* Full-screen voice room on a phone: keep the buttons clear of the home indicator. */}
      <CallControls className="max-md:pb-[max(20px,env(safe-area-inset-bottom))]" />
    </div>
  );
}

/**
 * The people and screens of the call we're in, as tiles (from the #metro design): as big as the area allows, between
 * 16:9 and square, rows centred, at most nine; whoever doesn't fit folds into a last "+N" tile that opens everyone at
 * the side. Cameras come first, then whoever is talking. A screen share takes the middle with everyone in a strip
 * under it. Needs the LiveKit room context.
 */
export function MediaStage() {
  const { t } = useT();
  const participants = useParticipants();
  const screens = useLiveVideo([Track.Source.ScreenShare]);
  const cameras = useLiveVideo([Track.Source.Camera]);
  const speaking = useStore((s) => s.speaking);
  const users = useStore((s) => s.users);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [side, setSide] = useState(false);
  const [area, setArea] = useState<HTMLDivElement | null>(null);
  const focused = screens.find((s) => trackKey(s) === focusKey) ?? screens[0];
  const cameraOf = new Map(cameras.map((c) => [c.participant.identity, c]));
  const fit = useTileGrid(area, focused ? 0 : participants.length);
  // Only when they don't all fit does the order matter: cameras first, then talking, the rest as they came.
  const rank = (p: Participant) => (cameraOf.has(p.identity) ? 2 : 0) + (speaking.includes(p.identity) ? 1 : 0);
  const overflow = fit.fits < participants.length;
  const ordered = overflow ? [...participants].sort((a, b) => rank(b) - rank(a)) : participants;
  const shown = overflow ? ordered.slice(0, Math.max(1, fit.fits - 1)) : ordered;
  const hidden = ordered.slice(shown.length);

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        {focused ? (
          <>
            <div className="min-h-0 flex-1 px-6">
              <ScreenStage trackRef={focused} />
            </div>
            {/* Everyone else in a strip under it, scrolled sideways when it's longer than the window. */}
            <div className="no-scrollbar flex shrink-0 justify-center gap-2 overflow-x-auto px-6 pt-2">
              {screens.length > 1 &&
                screens.map((s) => (
                  <button
                    key={trackKey(s)}
                    onClick={() => setFocusKey(trackKey(s))}
                    aria-label={t('voice.stream.show')}
                    className={`h-[90px] w-[160px] shrink-0 overflow-hidden rounded-[12px] bg-black ${trackKey(s) === trackKey(focused) ? 'ring-2 ring-inset ring-white' : ''}`}
                  >
                    <VideoTrack trackRef={s} className="h-full w-full object-cover" />
                  </button>
                ))}
              {participants.map((p) => (
                <div key={p.identity} className="h-[90px] w-[160px] shrink-0">
                  <Tile participant={p} camera={cameraOf.get(p.identity)} height={90} />
                </div>
              ))}
            </div>
          </>
        ) : (
          <div ref={setArea} className="flex min-h-0 flex-1 flex-wrap content-center justify-center gap-2 px-6">
            {shown.map((p) => (
              <div key={p.identity} className="shrink-0" style={{ width: fit.tileW, height: fit.tileH }}>
                <Tile participant={p} camera={cameraOf.get(p.identity)} height={fit.tileH} />
              </div>
            ))}
            {hidden.length > 0 && (
              <button
                onClick={() => setSide(true)}
                aria-label={t('voice.people.open')}
                className="flex shrink-0 flex-col items-center justify-center gap-3 rounded-[16px] bg-[#18181b] text-foreground transition-colors hover:bg-default"
                style={{ width: fit.tileW, height: fit.tileH }}
              >
                <FaceStack users={hidden.map((p) => users[p.identity])} ringBg="#18181b" size={Math.round(Math.min(56, Math.max(24, fit.tileH * 0.22)))} />
                <span className={`font-medium ${fit.tileH < 120 ? 'text-[13px]' : 'text-[16px]'}`}>+{hidden.length}</span>
              </button>
            )}
          </div>
        )}
      </div>
      {side && <CallPeople participants={ordered} onClose={() => setSide(false)} />}
    </div>
  );
}

/** Everyone in the call at the side of the tiles: the "+N" tile opens it. */
function CallPeople({ participants, onClose }: { participants: Participant[]; onClose: () => void }) {
  const { t } = useT();
  const users = useStore((s) => s.users);
  const speaking = useStore((s) => s.speaking);
  const entries = useStore((s) => s.calls[s.voiceChannelId ?? '']?.participants ?? s.voiceState);
  return (
    <aside className="flex w-[280px] shrink-0 flex-col border-l border-white/[0.06] max-md:hidden">
      <header className="flex h-14 shrink-0 items-center gap-2 pl-5 pr-3">
        <h3 className="flex-1 text-[20px] font-light tracking-[-0.3px]">{t('voice.people.title', { n: participants.length })}</h3>
        <RoundButton size="sm" tone="ghost" label={t('voice.people.close')} onPress={onClose}>
          <XIcon />
        </RoundButton>
      </header>
      <ul className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {participants.map((p) => {
          const user = users[p.identity];
          const entry = entries.find((e) => e.userId === p.identity);
          const name = `${user?.name ?? p.name ?? ''}${p.isLocal ? ` ${t('voice.you')}` : ''}`;
          return (
            <li key={p.identity} className="flex h-11 items-center gap-2.5 rounded-full px-2.5 hover:bg-white/[0.04]">
              <Avatar user={user} size={28} ringBg="var(--app-window)" />
              <span className={`min-w-0 flex-1 truncate text-[15px] ${speaking.includes(p.identity) ? 'font-medium text-foreground' : 'text-foreground/85'}`}>
                {name}
              </span>
              {entry?.video && <VideoIcon size={15} className="shrink-0 text-muted" />}
              {entry?.deafened ? (
                <HeadphonesSlashIcon size={15} className="shrink-0 text-danger" />
              ) : entry?.muted ? (
                <MicSlashIcon size={15} className="shrink-0 text-danger" />
              ) : (
                <MicIcon size={15} className="shrink-0 text-muted" />
              )}
            </li>
          );
        })}
      </ul>
    </aside>
  );
}

function ScreenStage({ trackRef }: { trackRef: TrackReference }) {
  const { t } = useT();
  const ref = useRef<HTMLDivElement>(null);
  const user = useStore((s) => s.users[trackRef.participant.identity]);
  return (
    <div ref={ref} className="group relative flex h-full w-full items-center justify-center overflow-hidden rounded-[16px] bg-black">
      <VideoTrack trackRef={trackRef} className="h-full w-full object-contain" />
      <div className="absolute left-3 top-3 flex items-center gap-2 rounded-[8px] bg-black/60 px-2.5 py-1 text-[13px] font-medium text-white">
        <span className="rounded-[4px] bg-danger px-1 text-[11px] font-bold uppercase leading-4">{t('voice.stream.live')}</span>
        {user?.name ?? trackRef.participant.name}
      </div>
      <RoundButton
        label={t('voice.stream.fullscreen')}
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

/**
 * A person's tile: one plain fill with their face sized to the tile (about 40% of its height), or their camera; whoever
 * talks gets a white stroke on the inside of the edge; the name, with the mic, in a tag at the foot. A tap on someone
 * else's tile sets their volume.
 */
function Tile({ participant, camera, height }: { participant: Participant; camera?: TrackReference; height: number }) {
  const { t } = useT();
  const speaking = useIsSpeaking(participant);
  const user = useStore((s) => s.users[participant.identity]);
  const entry = useStore((s) =>
    (s.calls[s.voiceChannelId ?? '']?.participants ?? s.voiceState).find((e) => e.userId === participant.identity),
  );
  const name = user?.name ?? participant.name ?? '';
  const label = `${name}${participant.isLocal ? ` ${t('voice.you')}` : ''}`;
  // Your camera on its way: straight from the device, or a dark tile until the device opens.
  const pending = useStore((s) => s.cameraPending) && participant.isLocal && !camera;
  const preview = useStore((s) => s.cameraPreview);
  const small = height < 120;

  const tile = (
    <div className={`relative flex h-full w-full items-center justify-center overflow-hidden rounded-[16px] ${pending || camera ? 'bg-black' : 'bg-[#18181b]'}`}>
      {pending ? (
        preview ? <DeviceVideo track={preview} /> : <Spinner size={small ? 'sm' : 'md'} color="current" className="text-white/60" />
      ) : camera ? (
        // The whole frame, never cropped: 4:3 webcams get dark bars instead of losing forehead and chin.
        // Your own camera is mirrored, like a selfie preview.
        <VideoTrack trackRef={camera} className={`h-full w-full bg-black object-contain ${participant.isLocal ? '-scale-x-100' : ''}`} />
      ) : (
        <Avatar user={user} size={Math.round(Math.min(128, Math.max(28, height * 0.4)))} ringBg="transparent" />
      )}
      <div className={`pointer-events-none absolute inset-0 rounded-[16px] ${speaking ? 'ring-2 ring-inset ring-white' : ''}`} />
      <div
        className={`absolute flex max-w-[calc(100%-16px)] items-center gap-1.5 rounded-full bg-black/55 font-medium text-white ${small ? 'bottom-1.5 left-1.5 px-2 py-0.5 text-[12px]' : 'bottom-2.5 left-2.5 px-2.5 py-1 text-[13px]'}`}
      >
        {entry?.deafened ? (
          <HeadphonesSlashIcon size={12} className="shrink-0 text-danger" />
        ) : entry?.muted ? (
          <MicSlashIcon size={12} className="shrink-0 text-danger" />
        ) : (
          <MicIcon size={12} className="shrink-0" />
        )}
        <span className="min-w-0 truncate">{label}</span>
      </div>
    </div>
  );

  if (!(participant instanceof RemoteParticipant)) return tile;
  return (
    <Popover>
      <Popover.Trigger aria-label={t('voice.volume', { name })} className="block h-full w-full cursor-pointer rounded-[16px] outline-none">
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

/**
 * Call controls at the bottom of the call screen, as in Webex: each button says what it is, mic and sound have the
 * device choice glued on, leaving is red and apart. Switched from the usual (muted, camera on) a button turns white;
 * narrower than all the labels, the labels go and the icons stay (a label never wraps).
 */
export function CallControls({ className = '' }: { className?: string }) {
  const { t } = useT();
  const muted = useStore((s) => s.muted);
  const deafened = useStore((s) => s.deafened);
  const cameraOn = useStore((s) => s.cameraOn);
  const screenSharing = useStore((s) => s.screenSharing);
  const micOff = muted || deafened;

  return (
    <div className={`@container flex shrink-0 items-center justify-center gap-2 px-6 py-5 ${className}`}>
      <ControlButton
        on={micOff}
        alert={micOff}
        label={micOff ? t('voice.mic.unmute') : t('voice.mic.mute')}
        text={t('voice.controls.mic')}
        onPress={toggleMute}
        icon={micOff ? <MicSlashIcon size={18} /> : <MicIcon size={18} />}
        device={<DeviceMenu kind="audioinput" label={t('shell.call.pickMic')} className={DEVICE_CHEVRON(micOff)} />}
      />
      <ControlButton
        on={deafened}
        alert={deafened}
        label={deafened ? t('voice.deafen.off') : t('voice.deafen.on')}
        text={t('voice.controls.sound')}
        onPress={toggleDeafen}
        icon={deafened ? <HeadphonesSlashIcon size={18} /> : <HeadphonesIcon size={18} />}
        device={<DeviceMenu kind="audiooutput" label={t('shell.call.pickOutput')} className={DEVICE_CHEVRON(deafened)} />}
      />
      <ControlButton
        on={cameraOn}
        label={cameraOn ? t('voice.camera.off') : t('voice.camera.on')}
        text={t('voice.controls.camera')}
        onPress={toggleCamera}
        icon={cameraOn ? <VideoIcon size={18} /> : <VideoSlashIcon size={18} />}
      />
      {canShareScreen && (
        <ControlButton
          on={screenSharing}
          label={screenSharing ? t('voice.screen.stop') : t('voice.screen.start')}
          text={t('voice.controls.screen')}
          onPress={toggleScreenShare}
          icon={<ScreenIcon size={18} />}
        />
      )}
      <button
        aria-label={t('voice.leave')}
        title={t('voice.leave')}
        onClick={() => leaveVoice()}
        className="ml-2 flex h-11 items-center gap-2 whitespace-nowrap rounded-full bg-danger px-4 text-[15px] font-medium text-white transition-[filter] hover:brightness-110 @[640px]:px-5"
      >
        <PhoneDownIcon size={18} />
        <span className="hidden @[640px]:inline">{t('voice.controls.leave')}</span>
      </button>
    </div>
  );
}

const CONTROL = (on: boolean) => (on ? 'bg-white text-black' : 'bg-default text-foreground hover:bg-[#28282d]');
const DEVICE_CHEVRON = (on: boolean) =>
  `ml-px flex h-11 items-center rounded-r-full pl-1.5 pr-2.5 outline-none transition-colors data-[focus-visible=true]:ring-2 data-[focus-visible=true]:ring-focus ${CONTROL(on)}`;

/** One labelled call button; `device` glues the device choice (a chevron) to its right. */
function ControlButton(props: { on: boolean; alert?: boolean; label: string; text: string; onPress: () => void; icon: ReactNode; device?: ReactNode }) {
  return (
    <span className="flex h-11 items-stretch">
      <button
        aria-label={props.label}
        title={props.label}
        onClick={props.onPress}
        className={`flex items-center gap-2 whitespace-nowrap px-3.5 text-[15px] font-medium transition-colors @[640px]:px-4 ${CONTROL(props.on)} ${props.device ? 'rounded-l-full' : 'rounded-full'}`}
      >
        <span className={props.alert ? 'text-danger' : ''}>{props.icon}</span>
        <span className="hidden @[640px]:inline">{props.text}</span>
      </button>
      {props.device}
    </span>
  );
}
