import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Popover, Spinner } from '@heroui/react';
import { ArrowsPointingInIcon, ArrowsPointingOutIcon, ChatBubbleLeftIcon, SpeakerWaveIcon } from '@heroicons/react/24/solid';
import { StartAudio, useIsSpeaking, useParticipants, useTracks, VideoTrack } from '@livekit/components-react';
import type { TrackReference } from '@livekit/components-react';
import { RemoteParticipant, Track, type Participant } from 'livekit-client';
import { setVoiceChat, showError, useStore, voiceMembers } from '../store';
import { joinVoice, toggleMute } from './voice';
import { useIsMobile } from '../hooks';
import type { Channel } from '../types';
import { Avatar } from '../ui/Avatar';
import { BubbleCloud } from './Bubbles';
import { CallDuration } from './CallDuration';
import { ChannelHeader, HeaderIcon } from '../shell/ChannelHeader';
import { ChannelMenu } from '../shell/ChannelMenu';
import { RoundButton, VolumeSlider } from '../ui/ui';
import { FaceStack } from '../shell/CallPill';
import { useTileGrid } from './tileGrid';
import { LineArt } from '../ui/Illustrations';
import {
  HeadphonesSlashIcon,
  MicIcon,
  MicSlashIcon,
  ScreenIcon,
  VideoIcon,
  XIcon,
} from '../ui/icons';
import { useT } from '../i18n';
import { CallBarButton, CallControls } from './CallControls';
import { RoomChat } from './RoomChat';
import { StreamWindow } from './StreamWindow';
import { SoundPlayedMark } from './SoundPad';

export function VoiceView({ channel }: { channel: Channel }) {
  const { t } = useT();
  const isMobile = useIsMobile();
  const myChannel = useStore((s) => s.voiceChannelId);
  const status = useStore((s) => s.voiceStatus);
  const room = useStore((s) => s.room);
  const live = myChannel === channel.id && status === 'connected' && room !== null;
  const connecting = myChannel === channel.id && status === 'connecting';
  const chatOpen = useStore((s) => s.voiceChatOpen);
  const unread = useStore((s) => (s.unread[channel.id] ?? 0) > 0);

  return (
    <div className={`relative flex min-h-0 flex-1 flex-col ${chatOpen ? 'max-md:[&>header]:invisible' : ''}`}>
      <ChannelHeader
        compactTitle
        showOnline={false}
        leading={
          <HeaderIcon compact>
            <SpeakerWaveIcon />
          </HeaderIcon>
        }
        title={channel.name}
        actions={
          <span className="relative">
            <button
              id={`room-chat-trigger-${channel.id}`}
              type="button"
              className="grid size-9 shrink-0 place-items-center rounded-full bg-default text-muted outline-none transition-colors hover:bg-surface-tertiary hover:text-foreground aria-pressed:bg-white/[0.12] aria-pressed:text-foreground focus-visible:ring-2 focus-visible:ring-focus [&_svg]:size-5"
              aria-label={t(chatOpen ? 'voice.chat.close' : 'voice.chat.open')}
              title={t(chatOpen ? 'voice.chat.close' : 'voice.chat.open')}
              aria-pressed={chatOpen}
              aria-controls={chatOpen ? `room-chat-${channel.id}` : undefined}
              onClick={() => setVoiceChat(!chatOpen)}
            >
              <ChatBubbleLeftIcon aria-hidden="true" />
            </button>
            {unread && !chatOpen && <span aria-hidden className="pointer-events-none absolute right-0.5 top-0.5 h-2.5 w-2.5 rounded-full bg-danger ring-2 ring-[var(--app-window)]" />}
          </span>
        }
        menu={isMobile ? <ChannelMenu channelId={channel.id} /> : undefined}
        subtitle={
          live ? (
            <span className="inline-flex items-center gap-1.5 tabular-nums" title={t('voice.call.ongoing')}>
              <span aria-hidden="true" className="size-1.5 rounded-full bg-success" />
              <span className="sr-only">{t('voice.call.ongoing')} </span>
              <CallDuration />
            </span>
          ) : undefined
        }
      />
      <div className={`flex min-h-0 min-w-0 flex-1 flex-col ${chatOpen ? 'max-md:invisible' : ''}`}>
        {connecting ? <JoiningStage /> : live ? <ConnectedStage channel={channel} /> : <JoinPrompt channel={channel} />}
      </div>
      {isMobile && chatOpen && <RoomChat channel={channel} layout="cover" />}
    </div>
  );
}

function JoiningStage() {
  const { t } = useT();
  return (
    <div role="status" className="flex flex-1 items-center justify-center gap-3 px-4 text-sm text-muted">
      <Spinner aria-hidden="true" size="sm" color="current" />
      <span>{t('voice.call.connecting')}</span>
    </div>
  );
}

/**
 * Before you're in (as in the native app): the faces of who's there, their names, a line when someone shows their
 * screen, the list of people; at the bottom the mic you'll come in with and a big green Join.
 */
function JoinPrompt({ channel }: { channel: Channel }) {
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
            className="mt-6 flex h-11 min-w-40 items-center justify-center whitespace-nowrap rounded-control bg-[#f2f2f4] px-(--app-radius-control) text-[15px] font-semibold text-[#0c0c0e] transition-[background-color,transform] duration-150 hover:bg-white active:scale-[0.98] disabled:opacity-80 max-md:hidden"
          >
            {t('voice.room.joinVoice')}
          </button>
        </div>
        {sharing && (
          <div className="mx-auto mt-5 flex w-full max-w-md items-center gap-2.5 rounded-2xl bg-default p-3.5">
            <ScreenIcon size={20} className="shrink-0 text-danger" />
            <span className="truncate text-[16px]">{t('voice.room.sharing', { name: users[sharing.userId]?.name ?? '…' })}</span>
          </div>
        )}
        {members.length > 0 && (
          <div className="mx-auto mt-5 w-full max-w-md overflow-hidden rounded-panel bg-default">
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
            className="flex h-14 flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-full bg-[#f2f2f4] text-[17px] font-semibold text-[#0c0c0e] transition-[background-color,transform] duration-150 hover:bg-white active:scale-[0.98] disabled:opacity-80"
          >
            {t('voice.room.joinVoice')}
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
function ConnectedStage({ channel }: { channel: Channel }) {
  const { t } = useT();
  const isMobile = useIsMobile();
  const media = useLiveVideo([Track.Source.Camera, Track.Source.ScreenShare]);
  const cameraPending = useStore((s) => s.cameraPending);
  const voiceState = useStore((s) => s.voiceState);
  const speaking = useStore((s) => s.speaking);
  const people = voiceMembers(voiceState, channel.id).map((m) => ({ id: m.userId, muted: m.muted, deafened: m.deafened }));
  const bubbles = isMobile && !(media.length > 0 || cameraPending);
  const controls = (viewActions?: ReactNode, fullscreen?: boolean) => (
    <CallControls channel={channel} viewActions={viewActions} fullscreen={fullscreen} className="max-md:pb-[max(20px,env(safe-area-inset-bottom))]" />
  );
  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <MediaStage
        fallback={bubbles ? <BubbleCloud people={people} speaking={speaking} live /> : undefined}
        renderControls={controls}
      />
      <StartAudio
        label={t('voice.audio.enable')}
        className="absolute left-1/2 top-2 -translate-x-1/2 rounded-full bg-accent px-5 py-2 text-[14px] font-medium text-accent-foreground"
      />
    </div>
  );
}

/**
 * The people and screens of the call we're in, as tiles (from the #metro design): as big as the area allows, between
 * 16:9 and square, rows centred, at most nine; whoever doesn't fit folds into a last "+N" tile that opens everyone at
 * the side. Cameras come first, then whoever is talking. A screen share takes the middle with everyone in a strip
 * under it. Needs the LiveKit room context.
 */
export function MediaStage({ fallback, renderControls }: {
  fallback?: ReactNode;
  renderControls: (viewActions?: ReactNode, fullscreen?: boolean) => ReactNode;
}) {
  const { t } = useT();
  const participants = useParticipants();
  const screens = useLiveVideo([Track.Source.ScreenShare]);
  const cameras = useLiveVideo([Track.Source.Camera]);
  const speaking = useStore((s) => s.speaking);
  const users = useStore((s) => s.users);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [side, setSide] = useState(false);
  const [area, setArea] = useState<HTMLDivElement | null>(null);
  const [full, setFull] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const stage = useRef<HTMLDivElement>(null);
  const controls = useRef<HTMLDivElement>(null);
  const ownsFullscreen = useRef(false);
  const hideTimer = useRef<number | null>(null);
  const pinnable = [...screens, ...cameras];
  const focused = pinnable.find((track) => trackKey(track) === focusKey);
  const cameraOf = new Map(cameras.map((camera) => [camera.participant.identity, camera]));
  const fit = useTileGrid(area, focused ? 0 : participants.length + screens.length);
  const tiles = [
    ...screens.map((video) => ({ key: trackKey(video), participant: video.participant, video })),
    ...participants.map((participant) => ({ key: participant.identity, participant, video: cameraOf.get(participant.identity) })),
  ];
  const rank = ({ participant, video }: (typeof tiles)[number]) =>
    (video?.source === Track.Source.ScreenShare ? 4 : video ? 2 : 0) + Number(speaking.includes(participant.identity));
  const overflow = fit.fits < tiles.length;
  const ordered = overflow ? [...tiles].sort((a, b) => rank(b) - rank(a)) : tiles;
  const shown = overflow ? ordered.slice(0, Math.max(1, fit.fits - 1)) : ordered;
  const hidden = ordered.slice(shown.length);
  const viewTrack = focused ?? screens[0] ?? cameras.find((camera) => !camera.participant.isLocal) ?? cameras[0];
  const focusOn = (track: TrackReference) =>
    setFocusKey(focusKey === trackKey(track) ? null : trackKey(track));
  // A publication can be replaced while a camera is off. The grid remains active until another explicit selection.
  useEffect(() => {
    if (focusKey && !focused) setFocusKey(null);
  }, [focusKey, focused]);
  const handleFullscreen = (exit = false) => {
    if (!document.fullscreenEnabled) return;
    if (exit) {
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => showError(t('voice.stream.windowError')));
      return;
    }
    ownsFullscreen.current = true;
    // The document stays the fullscreen element so dialogs and popovers portalled to body remain usable.
    void document.documentElement.requestFullscreen().catch(() => {
      ownsFullscreen.current = false;
      showError(t('voice.stream.windowError'));
    });
  };
  const overlayOpen = useCallback(() =>
    Boolean(controls.current?.querySelector('[aria-expanded="true"]') ||
      document.querySelector('[aria-modal="true"], [data-slot="popover-dialog"], [data-slot="dropdown-menu"]')), []);

  const wake = useCallback(function showControls() {
    setControlsVisible(true);
    if (hideTimer.current !== null) window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => {
      hideTimer.current = null;
      if (overlayOpen() || controls.current?.querySelector(':focus-visible')) showControls();
      else setControlsVisible(false);
    }, 2500);
  }, [overlayOpen]);

  useEffect(() => {
    const onChange = () => {
      const entered = ownsFullscreen.current && document.fullscreenElement === document.documentElement;
      setFull(entered);
      if (entered) wake();
      else {
        ownsFullscreen.current = false;
        if (hideTimer.current !== null) window.clearTimeout(hideTimer.current);
        setControlsVisible(true);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (!ownsFullscreen.current) return;
      if (event.key === 'Escape' && !overlayOpen() && document.fullscreenElement) {
        void document.exitFullscreen().catch(() => undefined);
      } else {
        wake();
      }
    };
    document.addEventListener('fullscreenchange', onChange);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      document.removeEventListener('keydown', onKey);
      if (hideTimer.current !== null) window.clearTimeout(hideTimer.current);
      if (ownsFullscreen.current && document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    };
  }, [overlayOpen, wake]);

  useEffect(() => {
    if (full && !viewTrack && document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
  }, [full, viewTrack]);

  const activeTrack = full ? viewTrack : focused;
  const viewActions = (full || viewTrack) && (
    <>
      {!full && viewTrack && <StreamWindow key={trackKey(viewTrack)} stage={stage} trackRef={viewTrack} />}
      {document.fullscreenEnabled && (
        <CallBarButton
          label={t(full ? 'voice.stream.exitFullscreen' : 'voice.stream.fullscreen')}
          onPress={() => handleFullscreen(full)}
        >
          {full ? <ArrowsPointingInIcon /> : <ArrowsPointingOutIcon />}
        </CallBarButton>
      )}
    </>
  );

  return (
    <div
      data-call-fullscreen={full || undefined}
      className={full ? `fixed inset-0 z-[40] flex flex-col bg-black ${controlsVisible ? '' : 'cursor-none [&_*]:cursor-none!'}` : 'contents'}
      onPointerMove={full ? wake : undefined}
      onPointerDown={full ? wake : undefined}
      onFocusCapture={full ? (event) => { if (event.target.matches(':focus-visible')) wake(); } : undefined}
    >
      {(full ? null : fallback) ?? (
        <div ref={stage} className={`relative flex min-h-0 flex-1 ${full ? 'bg-black' : 'bg-window'}`}>
          <div className="flex min-w-0 flex-1 flex-col">
            {activeTrack ? (
              <>
                <div className={`flex min-h-0 flex-1 flex-col ${full ? '' : 'px-(--app-pane-inset)'}`}>
                  <ScreenStage trackRef={activeTrack} full={full} onGrid={() => setFocusKey(null)} onFullscreen={() => handleFullscreen(full)} />
                </div>
                {!full && <div className="no-scrollbar flex shrink-0 justify-center-safe gap-2 overflow-x-auto px-(--app-pane-inset) pt-2">
                  {tiles.map(({ key, participant, video }) => (
                    <div key={key} className="h-[90px] w-[160px] shrink-0">
                      <Tile participant={participant} video={video} height={90}
                        selected={!!video && trackKey(video) === trackKey(activeTrack)}
                        onSelect={video ? () => focusOn(video) : undefined} />
                    </div>
                  ))}
                </div>}
              </>
            ) : (
              <div ref={setArea} className="flex min-h-0 flex-1 flex-wrap content-center justify-center gap-2 px-(--app-pane-inset)">
                {shown.map(({ key, participant, video }) => (
                  <div key={key} className="shrink-0" style={{ width: fit.tileW, height: fit.tileH }}>
                    <Tile participant={participant} video={video} height={fit.tileH} onSelect={video ? () => focusOn(video) : undefined} />
                  </div>
                ))}
                {hidden.length > 0 && (
                  <button
                    onClick={() => setSide(true)}
                    aria-label={t('voice.people.open')}
                    className={`flex shrink-0 flex-col items-center justify-center gap-3 rounded-surface bg-[#18181b] text-foreground transition-colors hover:bg-default ${fit.fits < 2 ? 'absolute right-4 top-2 z-10 size-9' : ''}`}
                    style={fit.fits < 2 ? undefined : { width: fit.tileW, height: fit.tileH }}
                  >
                    {fit.fits >= 2 && <FaceStack users={hidden.map(({ participant }) => users[participant.identity])} ringBg="#18181b" size={Math.round(Math.min(56, Math.max(24, fit.tileH * 0.22)))} />}
                    <span className={`font-medium ${fit.tileH < 120 ? 'text-[13px]' : 'text-[16px]'}`}>+{hidden.length}</span>
                  </button>
                )}
              </div>
            )}
          </div>
          {!full && side && <CallPeople participants={participants} onClose={() => setSide(false)} />}
        </div>
      )}
      <div
        ref={controls}
        data-fullscreen-controls={full || undefined}
        className={full ? `absolute inset-x-0 bottom-0 z-10 bg-linear-to-t from-black/80 via-black/40 to-transparent pt-12 transition-opacity duration-200 motion-reduce:transition-none ${controlsVisible ? 'opacity-100' : 'pointer-events-none opacity-0'}` : 'contents'}
      >
        {renderControls(fallback && !full ? undefined : viewActions, full)}
      </div>
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
    <aside className="flex w-[280px] shrink-0 flex-col border-l border-white/[0.06] bg-window max-md:absolute max-md:inset-y-0 max-md:right-0 max-md:z-20 max-md:max-w-full">
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

function ScreenStage({ trackRef, full, onGrid, onFullscreen }: {
  trackRef: TrackReference;
  full: boolean;
  onGrid: () => void;
  onFullscreen: () => void;
}) {
  const { t } = useT();
  const user = useStore((s) => s.users[trackRef.participant.identity]);
  const clickTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(clickTimer.current), []);
  const camera = trackRef.source === Track.Source.Camera;
  const name = user?.name ?? trackRef.participant.name;
  return (
    <>
      <div className={`min-w-0 shrink-0 items-center gap-2 py-2 ${full ? 'hidden' : 'flex'}`}>
        <div className="flex min-w-0 flex-1 items-baseline gap-2">
          <h3 className="min-w-0 truncate text-[18px] font-normal">{name}</h3>
          {!camera && <span className="shrink-0 text-[13px] text-muted">{t('voice.stream.live')}</span>}
        </div>
        <button type="button" onClick={onGrid} className="h-9 shrink-0 rounded-full bg-default px-4 text-sm outline-none transition-colors hover:bg-surface-tertiary focus-visible:ring-2 focus-visible:ring-focus">
          {t('voice.stream.grid')}
        </button>
      </div>
      <button
        type="button"
        aria-label={t(full ? 'voice.stream.exitFullscreen' : 'voice.stream.grid')}
        tabIndex={full ? -1 : 0}
        className={`relative min-h-0 flex-1 overflow-hidden bg-black outline-none focus-visible:ring-2 focus-visible:ring-focus ${full ? '' : 'rounded-surface'}`}
        onClick={(event) => {
          if (full) return;
          if (event.detail === 0 || !document.fullscreenEnabled) onGrid();
          else if (event.detail === 1) clickTimer.current = window.setTimeout(onGrid, 300);
        }}
        onDoubleClick={() => {
          window.clearTimeout(clickTimer.current);
          onFullscreen();
        }}
      >
        <VideoTrack
          trackRef={trackRef}
          className={`h-full w-full object-contain ${camera && trackRef.participant.isLocal ? '-scale-x-100' : ''}`}
        />
      </button>
    </>
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
 * else's tile sets their volume; their camera, when they have one, comes up big instead, and the volume moves to the
 * speaker button or the right-click.
 */
function Tile({ participant, video, height, onSelect, selected = false }: {
  participant: Participant;
  video?: TrackReference;
  selected?: boolean;
  height: number;
  onSelect?: () => void;
}) {
  const { t } = useT();
  const speaking = useIsSpeaking(participant);
  const user = useStore((s) => s.users[participant.identity]);
  const entry = useStore((s) =>
    (s.calls[s.voiceChannelId ?? '']?.participants ?? s.voiceState).find((e) => e.userId === participant.identity),
  );
  const [volumeOpen, setVolumeOpen] = useState(false);
  const name = user?.name ?? participant.name ?? '';
  const label = `${name}${participant.isLocal ? ` ${t('voice.you')}` : ''}`;
  // Your camera on its way: straight from the device, or a dark tile until the device opens.
  const screen = video?.source === Track.Source.ScreenShare;
  const pending = useStore((s) => s.cameraPending) && participant.isLocal && !video;
  const preview = useStore((s) => s.cameraPreview);
  const small = height < 120;
  const remote = participant instanceof RemoteParticipant;
  const handleClick = onSelect ?? (remote ? () => setVolumeOpen(true) : undefined);
  // The speaker button owns the corner; the sound mark steps aside so the two never sit on top of each other.
  const markPlace = remote
    ? (small ? 'right-8 top-1.5 size-5' : 'right-11 top-2.5 size-7')
    : (small ? 'right-1.5 top-1.5 size-5' : 'right-2.5 top-2.5 size-7');

  return (
    <div
      className={`group relative flex h-full w-full items-center justify-center overflow-hidden rounded-surface ${pending || video ? 'bg-black' : 'bg-[#18181b]'}`}
      onContextMenu={remote ? (e) => { if (!e.currentTarget.contains(e.target as Node)) return; e.preventDefault(); setVolumeOpen(true); } : undefined}
    >
      {pending ? (
        preview ? <DeviceVideo track={preview} /> : <Spinner size={small ? 'sm' : 'md'} color="current" className="text-white/60" />
      ) : video ? (
        // The whole frame, never cropped: 4:3 webcams get dark bars instead of losing forehead and chin.
        // Your own camera is mirrored, like a selfie preview.
        <VideoTrack trackRef={video} className={`h-full w-full bg-black object-contain ${!screen && participant.isLocal ? '-scale-x-100' : ''}`} />
      ) : (
        <Avatar user={user} size={Math.round(Math.min(128, Math.max(28, height * 0.4)))} ringBg="transparent" />
      )}
      {handleClick && (
        <button
          type="button"
          aria-pressed={onSelect ? selected : undefined}
          aria-label={onSelect ? `${screen ? t('voice.stream.show') : t('voice.stream.focus')}: ${name}` : t('voice.volume', { name })}
          onClick={handleClick}
          className="absolute inset-0 cursor-pointer rounded-surface outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white"
        />
      )}
      <div className={`pointer-events-none absolute inset-0 rounded-surface ${selected || speaking ? 'ring-2 ring-inset ring-white' : ''}`} />
      <SoundPlayedMark
        userId={participant.identity}
        size={small ? 12 : 14}
        className={`pointer-events-none absolute items-center justify-center rounded-full bg-black/55 text-white ${markPlace}`}
      />
      <div
        className={`pointer-events-none absolute flex max-w-[calc(100%-16px)] items-center gap-1.5 rounded-full bg-black/55 font-medium text-white ${small ? 'bottom-1.5 left-1.5 px-2 py-0.5 text-[12px]' : 'bottom-2.5 left-2.5 px-2.5 py-1 text-[13px]'}`}
      >
        {screen ? (
          <ScreenIcon size={12} className="shrink-0" />
        ) : entry?.deafened ? (
          <HeadphonesSlashIcon size={12} className="shrink-0 text-danger" />
        ) : entry?.muted ? (
          <MicSlashIcon size={12} className="shrink-0 text-danger" />
        ) : (
          <MicIcon size={12} className="shrink-0" />
        )}
        <span className="min-w-0 truncate">{label}</span>
      </div>
      {remote && (
        <Popover isOpen={volumeOpen} onOpenChange={setVolumeOpen}>
          <Popover.Trigger
            aria-label={t('voice.volume', { name })}
            onClick={(e) => e.stopPropagation()}
            className={`absolute z-10 grid shrink-0 place-items-center rounded-full bg-black/55 text-white outline-none transition-opacity ${volumeOpen ? '' : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100'} ${small ? 'right-1.5 top-1.5 size-5' : 'right-2.5 top-2.5 size-7'}`}
          >
            <SpeakerWaveIcon className={small ? 'size-3' : 'size-3.5'} aria-hidden="true" />
          </Popover.Trigger>
          <Popover.Content isNonModal placement="bottom end" className="w-64">
            <Popover.Dialog aria-label={t('voice.volume', { name })} className="p-4">
              <VolumeSlider userId={participant.identity} name={name} showMute />
            </Popover.Dialog>
          </Popover.Content>
        </Popover>
      )}
    </div>
  );
}
