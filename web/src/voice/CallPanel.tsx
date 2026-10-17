import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@heroui/react';
import { StartAudio } from '@livekit/components-react';
import { Track } from 'livekit-client';
import { dmTitle, useStore } from '../store';
import { declineCall, ringAgain } from '../socket';
import { joinVoice } from './voice';
import { startRing } from './sounds';
import { desktop } from '../desktop';
import type { CallState, Dm } from '../types';
import { Avatar } from '../ui/Avatar';
import { BubblePair, BubblePeanut } from './Bubbles';
import { DmAvatar } from '../ui/DmAvatar';
import { CallDuration } from './CallDuration';
import { CallControls, MediaStage, useLiveVideo } from './VoiceView';
import { RoundButton } from '../ui/ui';
import { PhoneDownIcon, PhoneIcon, SignalIcon, VideoIcon } from '../ui/icons';

/** Phone and camera buttons in a DM/group header, like Discord's. Hidden once you're in that call. */
export function CallButtons({ dm }: { dm: Dm }) {
  const inThisCall = useStore((s) => s.voiceChannelId === dm.id);
  const live = useStore((s) => !!s.calls[dm.id]);
  if (inThisCall) return null;
  return (
    <>
      <RoundButton tone="ghost" label={live ? 'Присоединиться к звонку' : 'Позвонить'} onPress={() => joinVoice(dm.id)}>
        <PhoneIcon />
      </RoundButton>
      <RoundButton tone="ghost" label="Видеозвонок" onPress={() => joinVoice(dm.id, { video: true })}>
        <VideoIcon />
      </RoundButton>
    </>
  );
}

/** The call area across the top of a DM or group chat: everyone's avatars in circles, or video once someone turns it on. */
export function DmCallPanel({ dm }: { dm: Dm }) {
  const call = useStore((s) => s.calls[dm.id]);
  const mine = useStore((s) => s.voiceChannelId === dm.id);
  const connected = useStore((s) => s.voiceChannelId === dm.id && s.voiceStatus === 'connected' && s.room !== null);
  if (!call && !mine) return null;

  return (
    <section aria-label="Звонок" className="relative flex shrink-0 flex-col">
      {connected ? <LiveCall dm={dm} call={call} /> : <CallPreview dm={dm} call={call} connecting={mine} />}
    </section>
  );
}

function LiveCall({ dm, call }: { dm: Dm; call: CallState | undefined }) {
  const live = useLiveVideo([Track.Source.Camera, Track.Source.ScreenShare]);
  const cameraPending = useStore((s) => s.cameraPending);
  // Your tile shows up the moment you switch the camera on, loading until the video arrives.
  const media = live.length > 0 || cameraPending ? [true] : [];
  const alone = (call?.participants.length ?? 1) <= 1;
  const ringing = (call?.ringing.length ?? 0) > 0;
  const missing = dm.members.some((id) => !call?.participants.some((p) => p.userId === id));

  return (
    <div className={`flex flex-col ${media.length > 0 ? 'h-[min(66vh,600px)] pt-4' : ''}`}>
      {media.length > 0 ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <MediaStage />
        </div>
      ) : (
        <CallBubbles dm={dm} call={call} live />
      )}
      {/* Status sits right above the controls, Discord-style: signal bars + what's going on. */}
      <div className="flex items-center justify-center gap-3 pt-3 text-[13px]">
        <CallStatus tone={alone && !ringing ? 'idle' : alone ? 'ringing' : 'live'}>
          {alone && ringing ? 'Вызываем…' : alone ? 'Никто не ответил' : <>Звонок · <CallDuration /></>}
        </CallStatus>
        {missing && !ringing && (
          <button onClick={() => ringAgain(dm.id)} className="rounded-full bg-white/10 px-3 py-1 font-medium text-foreground hover:bg-white/20">
            {dm.kind === 'group' ? 'Позвать остальных' : 'Позвонить ещё раз'}
          </button>
        )}
      </div>
      <StartAudio
        label="Включить звук"
        className="absolute left-1/2 top-2 -translate-x-1/2 rounded-full bg-accent px-5 py-2 text-[14px] font-medium text-accent-foreground"
      />
      <CallControls className="pt-3" />
    </div>
  );
}

/** Signal bars and a status line: green while talking, pulsing while ringing, grey when nobody's there. */
function CallStatus({ tone, children }: { tone: 'live' | 'ringing' | 'idle'; children: ReactNode }) {
  const color = tone === 'idle' ? 'text-muted' : 'text-success';
  return (
    <span className={`flex items-center gap-1.5 font-medium tabular-nums ${color}`}>
      <SignalIcon size={16} className={tone === 'ringing' ? 'animate-pulse' : ''} />
      {children}
    </span>
  );
}

function CallPreview({ dm, call, connecting }: { dm: Dm; call: CallState | undefined; connecting: boolean }) {
  const meId = useStore((s) => s.me?.id);
  const ringingMe = !!meId && !!call?.ringing.includes(meId);

  return (
    <div className="flex flex-col items-center pb-5">
      <CallBubbles dm={dm} call={call} live={false} />
      <div className="pb-4 text-[13px]">
        <CallStatus tone={connecting ? 'ringing' : 'live'}>
          {connecting ? 'Подключаемся…' : <>Идёт звонок · <CallDuration since={call?.startedAt} /></>}
        </CallStatus>
      </div>
      {!connecting && (
        <div className="flex gap-3">
          {ringingMe && (
            <Button variant="danger" onPress={() => declineCall(dm.id)} className="h-10 rounded-full px-5 text-white [--button-fg:white] [&_svg]:size-5">
              <PhoneDownIcon />
              Отклонить
            </Button>
          )}
          <Button onPress={() => joinVoice(dm.id)} className="h-10 rounded-full px-5 [--button-bg:var(--success)] [--button-fg:#06210f] [&_svg]:size-5">
            <PhoneIcon />
            {ringingMe ? 'Ответить' : 'Присоединиться'}
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * Everyone in the call as bubbles, plus the people being rung (faded, pulsing): side by side for two,
 * the peanut once three or more are in a group call.
 */
function CallBubbles({ dm, call, live }: { dm: Dm; call: CallState | undefined; live: boolean }) {
  const speaking = useStore((s) => s.speaking);
  const present = call?.participants ?? [];
  const ringing = (call?.ringing ?? []).filter((id) => !present.some((p) => p.userId === id));
  const people = [
    ...present.map((p) => ({ id: p.userId, muted: p.muted, deafened: p.deafened })),
    ...ringing.map((id) => ({ id, ringing: true })),
  ];
  const peanut = dm.kind === 'group' && people.length >= 3;
  return (
    <div className={`flex w-full px-6 pt-2 ${peanut ? 'h-[300px]' : 'h-[230px]'}`}>
      {peanut ? <BubblePeanut people={people} speaking={live ? speaking : []} live={live} /> : <BubblePair people={people} speaking={live ? speaking : []} live={live} />}
    </div>
  );
}

/** "Someone is calling you": over everything, until you answer or decline. */
export function IncomingCall() {
  const meId = useStore((s) => s.me?.id);
  const call = useStore((s) =>
    Object.values(s.calls).find((c) => !!meId && c.ringing.includes(meId) && s.voiceChannelId !== c.dmId),
  );
  const dm = useStore((s) => (call ? s.dms.find((d) => d.id === call.dmId) : undefined));
  const users = useStore((s) => s.users);
  if (!call || !dm) return null;

  const caller = users[call.participants[0]?.userId ?? ''];
  const group = dm.kind === 'group';

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6 max-md:bg-background">
      <div
        role="alertdialog"
        aria-label="Входящий звонок"
        className="flex w-full max-w-[320px] flex-col items-center rounded-[28px] bg-surface px-6 pb-7 pt-9 text-center shadow-2xl max-md:bg-transparent max-md:shadow-none"
      >
        <div className="call-ringing rounded-full">
          {group ? <DmAvatar dm={dm} size={104} ringBg="var(--surface)" /> : <Avatar user={caller} size={104} />}
        </div>
        <h2 className="mt-5 max-w-full truncate text-[22px] font-bold">{group ? dmTitle(dm, users, meId) : caller?.name}</h2>
        <p className="mt-1 text-[15px] text-muted">{group ? `${caller?.name ?? 'Кто-то'} звонит в группу` : 'Входящий звонок…'}</p>
        <div className="mt-9 flex gap-12">
          <CallAction label="Отклонить" className="bg-danger text-white" onPress={() => declineCall(dm.id)}>
            <PhoneDownIcon size={28} />
          </CallAction>
          <CallAction label="Ответить" className="bg-success text-[#06210f]" onPress={() => joinVoice(dm.id)}>
            <PhoneIcon size={28} />
          </CallAction>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function CallAction({ label, className, onPress, children }: { label: string; className: string; onPress: () => void; children: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2">
      <button onClick={onPress} aria-label={label} className={`flex h-16 w-16 items-center justify-center rounded-full transition-transform active:scale-95 ${className}`}>
        {children}
      </button>
      <span className="text-[13px] text-muted">{label}</span>
    </div>
  );
}

/** Plays the ring: incoming while someone calls you, ringback while you wait for an answer. */
export function CallRinger() {
  const ringingDmId = useStore((s) => {
    const meId = s.me?.id;
    return Object.values(s.calls).find((c) => !!meId && c.ringing.includes(meId) && s.voiceChannelId !== c.dmId)?.dmId;
  });
  const incoming = !!ringingDmId;
  const outgoing = useStore((s) => {
    const call = s.calls[s.voiceChannelId ?? ''];
    return !!call && s.voiceStatus === 'connected' && call.participants.length === 1 && call.ringing.length > 0;
  });

  useEffect(() => {
    if (incoming) return startRing('ringIn');
    if (outgoing) return startRing('ringOut');
  }, [incoming, outgoing]);

  useEffect(() => {
    if (!incoming) return;
    const title = document.title;
    document.title = 'Входящий звонок · Gomex';
    return () => {
      document.title = title;
    };
  }, [incoming]);

  // In the desktop app: bring the window up and show a system notification, even if it was closed to the tray.
  useEffect(() => {
    if (!desktop || !ringingDmId) return;
    const s = useStore.getState();
    const call = s.calls[ringingDmId];
    const dm = s.dms.find((d) => d.id === ringingDmId);
    const caller = s.users[call?.participants[0]?.userId ?? '']?.name ?? 'Кто-то';
    if (dm?.kind === 'group') desktop.incomingCall(dmTitle(dm, s.users, s.me?.id), `${caller} звонит в группу`);
    else desktop.incomingCall(caller, 'Входящий звонок');
    return () => desktop?.callHandled();
  }, [ringingDmId]);

  return null;
}
