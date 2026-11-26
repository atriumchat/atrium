import { useRef, type ReactNode, type RefObject } from 'react';
import { Button, Label, Popover, Switch, Tooltip } from '@heroui/react';
import { useT } from '../i18n';
import { dmTitle, isDmId, openDm, selectChannel, useStore } from '../store';
import { leaveVoice, screenSource, setVoicePrefs, toggleCamera, toggleDeafen, toggleMute, toggleScreenShare } from '../voice/voice';
import { Avatar } from '../ui/Avatar';
import { useCallStats } from '../voice/stats';
import { BypassHint, CallQuality } from '../voice/Bypass';
import { DeviceMenu, SettingsMenu } from './SettingsMenu';
import { MeCard, statusLabel } from './MeCard';
import { RoundButton } from '../ui/ui';
import { SoundboardButton } from '../voice/SoundPad';
import {
  HeadphonesIcon,
  HeadphonesSlashIcon,
  MicIcon,
  MicSlashIcon,
  PhoneDownIcon,
  ScreenIcon,
  ScreenOffIcon,
  WaveformIcon,
  VideoIcon,
  VideoSlashIcon,
} from '../ui/icons';

/** Discord-style block at the bottom of the left column: voice status (while in a call) and your own row. */
export function UserPanel() {
  // Your card opens above the whole panel, flush with its left edge, as in Discord.
  const island = useRef<HTMLDivElement>(null);
  return (
    <div className="shrink-0 px-2">
      <div ref={island} className="overflow-hidden rounded-card bg-island">
        <VoiceStatus />
        <MeRow island={island} />
      </div>
    </div>
  );
}

function VoiceStatus() {
  const { t } = useT();
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
  const source = useStore((s) => (s.screenSharing ? screenSource(s.room) : ''));
  const stats = useCallStats(!!channelId);
  if (!channelId) return null;
  const connected = status === 'connected';

  return (
    <div className="border-b-[0.5px] border-[#26262b] p-3">
      {screenSharing && (
        <div className="mb-2 flex items-center gap-2 border-b-[0.5px] border-[#26262b] pb-2 pl-1.5">
          <ScreenIcon className="shrink-0 text-muted" />
          <span className="min-w-0 flex-1 truncate text-[14px] font-medium" title={source}>{source}</span>
          <RoundButton size="sm" tone="ghost" label={t('shell.call.screenStop')} onPress={toggleScreenShare} className="hover:text-danger">
            <ScreenOffIcon />
          </RoundButton>
        </div>
      )}
      <div className="flex items-center gap-2 pl-1.5">
        <CallQuality stats={stats} connected={connected} />
        <button onClick={() => (isDmId(channelId) ? openDm(channelId) : selectChannel(channelId))} className="min-w-0 flex-1 text-left">
          <span className={`block text-[14px] font-medium ${connected ? 'text-foreground' : 'text-warning'}`}>
            {connected ? t('shell.call.connected') : t('shell.call.connecting')}
          </span>
          <span className="block truncate text-[12px] text-muted hover:underline">{where}</span>
        </button>
        <NoiseButton />
        <RoundButton size="sm" tone="ghost" label={t('shell.call.disconnect')} onPress={() => leaveVoice()} className="hover:text-danger">
          <PhoneDownIcon />
        </RoundButton>
      </div>
      <BypassHint stats={stats} />
      <div className="mt-2 grid grid-cols-3 gap-2">
        <WideButton label={cameraOn ? t('shell.call.cameraOff') : t('shell.call.cameraOn')} on={cameraOn} disabled={!connected} onPress={toggleCamera}>
          {cameraOn ? <VideoIcon /> : <VideoSlashIcon />}
        </WideButton>
        <WideButton
          label={screenSharing ? t('shell.call.screenStop') : t('shell.call.screenStart')}
          on={screenSharing}
          disabled={!connected}
          onPress={toggleScreenShare}
        >
          {screenSharing ? <ScreenOffIcon /> : <ScreenIcon />}
        </WideButton>
        <SoundboardButton look="panel" stopsPlayback disabled={!connected} />
      </div>
    </div>
  );
}

/** The bars next to the hang-up: one switch for noise suppression, so it can be turned on or off without the settings. */
function NoiseButton() {
  const { t } = useT();
  const on = useStore((s) => s.voicePrefs.noise !== 'off');
  return (
    <Popover>
      <Tooltip delay={300} closeDelay={0}>
        <Popover.Trigger aria-label={t('voice.noise.title')} className={`flex size-8 shrink-0 items-center justify-center rounded-full outline-none transition-colors hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-focus ${on ? 'text-foreground' : 'text-muted'}`}>
          <WaveformIcon size={18} />
        </Popover.Trigger>
        <Tooltip.Content>{t('voice.noise.title')}</Tooltip.Content>
      </Tooltip>
      <Popover.Content placement="top" className="w-64">
        <Popover.Dialog aria-label={t('voice.noise.title')} className="p-4 outline-none">
          <Switch className="w-full" isSelected={on} onChange={(value) => void setVoicePrefs({ noise: value ? 'rnnoise' : 'off' })}>
            <Switch.Content className="flex w-full items-center justify-between gap-3">
              <Label className="text-[14px] font-medium">{t('voice.noise.title')}</Label>
              <Switch.Control className="shrink-0 [--switch-control-bg:rgb(255_255_255/0.16)]">
                <Switch.Thumb />
              </Switch.Control>
            </Switch.Content>
          </Switch>
        </Popover.Dialog>
      </Popover.Content>
    </Popover>
  );
}

function WideButton(props: { label: string; on: boolean; disabled: boolean; onPress: () => void; children: ReactNode }) {
  return (
    <Tooltip delay={300} closeDelay={0}>
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
      <Tooltip.Content>{props.label}</Tooltip.Content>
    </Tooltip>
  );
}

function MeRow({ island }: { island: RefObject<HTMLDivElement | null> }) {
  const { t } = useT();
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
              {deafened ? t('shell.call.statusSoundOff') : muted ? t('shell.call.statusMicOff') : myStatusText || statusLabel(myStatus)}
            </div>
          </div>
        </MeCard>
      )}
      <ToggleWithDevice
        active={micOff}
        label={micOff ? t('shell.call.micOn') : t('shell.call.micOff')}
        onPress={toggleMute}
        device={<DeviceMenu kind="audioinput" label={t('shell.call.pickMic')} />}
      >
        {micOff ? <MicSlashIcon /> : <MicIcon />}
      </ToggleWithDevice>
      <ToggleWithDevice
        active={deafened}
        label={deafened ? t('shell.call.soundOn') : t('shell.call.soundOff')}
        onPress={toggleDeafen}
        device={<DeviceMenu kind="audiooutput" label={t('shell.call.pickOutput')} />}
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
        <Tooltip.Content>{props.label}</Tooltip.Content>
      </Tooltip>
      {props.device}
    </div>
  );
}

