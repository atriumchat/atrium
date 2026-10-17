import { useRef, type ReactNode, type RefObject } from 'react';
import { Button, Tooltip } from '@heroui/react';
import { dmTitle, isDmId, openDm, selectChannel, useStore } from '../store';
import { leaveVoice, toggleCamera, toggleDeafen, toggleMute, toggleScreenShare } from '../voice/voice';
import { Avatar } from '../ui/Avatar';
import { useCallStats } from '../voice/stats';
import { BypassHint, CallQuality } from '../voice/Bypass';
import { DeviceMenu, SettingsMenu } from './SettingsMenu';
import { MeCard, STATUS_LABEL } from './MeCard';
import { RoundButton } from '../ui/ui';
import {
  HeadphonesIcon,
  HeadphonesSlashIcon,
  MicIcon,
  MicSlashIcon,
  PhoneDownIcon,
  ScreenIcon,
  VideoIcon,
  VideoSlashIcon,
} from '../ui/icons';

/** Discord-style block at the bottom of the left column: voice status (while in a call) and your own row. */
export function UserPanel() {
  // Your card opens above the whole panel, flush with its left edge, as in Discord.
  const island = useRef<HTMLDivElement>(null);
  return (
    <div className="shrink-0 px-2">
      <div ref={island} className="overflow-hidden rounded-[28px] border-[0.5px] border-[#26262b] bg-[#141417]">
        <VoiceStatus />
        <MeRow island={island} />
      </div>
    </div>
  );
}

function VoiceStatus() {
  const channelId = useStore((s) => s.voiceChannelId);
  const status = useStore((s) => s.voiceStatus);
  // "room / server" for a voice room, the person or group for a call in DMs.
  const where = useStore((s) => {
    const channel = s.channels.find((c) => c.id === s.voiceChannelId);
    if (channel) return `${channel.name} / ${s.serverName}`;
    const dm = s.dms.find((d) => d.id === s.voiceChannelId);
    return dm ? dmTitle(dm, s.users, s.me?.id) : '';
  });
  const cameraOn = useStore((s) => s.cameraOn);
  const screenSharing = useStore((s) => s.screenSharing);
  const stats = useCallStats(!!channelId);
  if (!channelId) return null;
  const connected = status === 'connected';

  return (
    <div className="border-b-[0.5px] border-[#26262b] p-3">
      <div className="flex items-center gap-2 pl-1.5">
        <CallQuality stats={stats} connected={connected} />
        <button onClick={() => (isDmId(channelId) ? openDm(channelId) : selectChannel(channelId))} className="min-w-0 flex-1 text-left">
          <span className={`block text-[14px] font-medium ${connected ? 'text-success' : 'text-warning'}`}>
            {connected ? 'Голос подключён' : 'Подключение…'}
          </span>
          <span className="block truncate text-[12px] text-muted hover:underline">{where}</span>
        </button>
        <RoundButton size="sm" tone="ghost" label="Отключиться" onPress={() => leaveVoice()} className="hover:text-danger">
          <PhoneDownIcon />
        </RoundButton>
      </div>
      <BypassHint stats={stats} />
      <div className="mt-2 grid grid-cols-2 gap-2">
        <WideButton label={cameraOn ? 'Выключить камеру' : 'Включить камеру'} on={cameraOn} disabled={!connected} onPress={toggleCamera}>
          {cameraOn ? <VideoIcon /> : <VideoSlashIcon />}
        </WideButton>
        <WideButton
          label={screenSharing ? 'Остановить демонстрацию' : 'Показать экран'}
          on={screenSharing}
          disabled={!connected}
          onPress={toggleScreenShare}
        >
          <ScreenIcon />
        </WideButton>
      </div>
    </div>
  );
}

function WideButton(props: { label: string; on: boolean; disabled: boolean; onPress: () => void; children: ReactNode }) {
  return (
    <Tooltip delay={300} closeDelay={0}>
      <Tooltip.Trigger>
        <Button
          fullWidth
          variant="tertiary"
          aria-label={props.label}
          aria-pressed={props.on}
          isDisabled={props.disabled}
          onPress={props.onPress}
          className={`h-10 rounded-full [&_svg]:size-5 ${props.on ? '[--button-bg:white] [--button-bg-hover:#e7e7ea] [--button-fg:#0b0b0c]' : ''}`}
        >
          {props.children}
        </Button>
      </Tooltip.Trigger>
      <Tooltip.Content>{props.label}</Tooltip.Content>
    </Tooltip>
  );
}

function MeRow({ island }: { island: RefObject<HTMLDivElement | null> }) {
  const me = useStore((s) => s.me);
  const muted = useStore((s) => s.muted);
  const deafened = useStore((s) => s.deafened);
  const speaking = useStore((s) => (s.me ? s.speaking.includes(s.me.id) : false));
  const myStatus = useStore((s) => s.myStatus);
  const myStatusText = useStore((s) => s.myStatusText);
  const micOff = muted || deafened;

  return (
    <div className="flex items-center gap-1 p-3 pr-2">
      {me && (
        <MeCard
          anchor={island}
          className="-m-1 flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 rounded-full p-1 pr-2 transition-colors hover:bg-default/60"
        >
          <Avatar user={me} size={36} speaking={speaking} online status={myStatus} ringBg="#141417" />
          <div className="min-w-0">
            <div className="truncate text-[14px] font-medium leading-5">{me.name}</div>
            <div className="truncate text-[12px] text-muted">
              {deafened ? 'Звук выкл.' : muted ? 'Микрофон выкл.' : myStatusText || STATUS_LABEL[myStatus]}
            </div>
          </div>
        </MeCard>
      )}
      <ToggleWithDevice
        active={micOff}
        label={micOff ? 'Включить микрофон' : 'Выключить микрофон'}
        onPress={toggleMute}
        device={<DeviceMenu kind="audioinput" label="Выбрать микрофон" />}
      >
        {micOff ? <MicSlashIcon /> : <MicIcon />}
      </ToggleWithDevice>
      <ToggleWithDevice
        active={deafened}
        label={deafened ? 'Включить звук' : 'Выключить звук'}
        onPress={toggleDeafen}
        device={<DeviceMenu kind="audiooutput" label="Выбрать устройство вывода" />}
      >
        {deafened ? <HeadphonesSlashIcon /> : <HeadphonesIcon />}
      </ToggleWithDevice>
      <SettingsMenu />
    </div>
  );
}

/** Mic / headphones toggle with its device chevron, tinted red while muted — the Discord pairing. */
function ToggleWithDevice(props: { active: boolean; label: string; onPress: () => void; device: ReactNode; children: ReactNode }) {
  return (
    <div className={`flex items-center rounded-full ${props.active ? 'bg-danger/15 text-danger' : ''}`}>
      <Tooltip delay={300} closeDelay={0}>
        <Tooltip.Trigger>
          <Button
            isIconOnly
            variant="ghost"
            aria-label={props.label}
            onPress={props.onPress}
            className={`h-9 w-9 min-w-9 rounded-l-full rounded-r-none p-0 [&_svg]:size-5 ${
              props.active ? '[--button-fg:var(--danger)] [--button-bg-hover:color-mix(in_oklab,var(--danger)_20%,transparent)]' : '[--button-fg:var(--muted)]'
            }`}
          >
            {props.children}
          </Button>
        </Tooltip.Trigger>
        <Tooltip.Content>{props.label}</Tooltip.Content>
      </Tooltip>
      {props.device}
    </div>
  );
}

