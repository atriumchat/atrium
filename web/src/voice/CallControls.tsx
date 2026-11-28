import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Button, Tooltip } from '@heroui/react';
import {
  ComputerDesktopIcon,
  EllipsisHorizontalIcon,
  PhoneXMarkIcon,
  UserPlusIcon,
  VideoCameraIcon,
  VideoCameraSlashIcon,
} from '@heroicons/react/24/solid';
import { useT } from '../i18n';
import { useStore } from '../store';
import type { Channel } from '../types';
import { InviteToRoom } from '../shell/ChannelMenu';
import { DeviceMenu } from '../shell/SettingsMenu';
import { SettingsDialog } from '../shell/SettingsDialog';
import { ChevronDownIcon, GearIcon, HeadphonesIcon, HeadphonesSlashIcon, MicIcon, MicSlashIcon, ScreenIcon, ScreenOffIcon, SpeakerIcon, StopIcon } from '../ui/icons';
import { Menu, MenuItem, MenuSeparator } from '../ui/Menu';
import type { DeviceKind } from './devices';
import { SoundboardButton } from './SoundPad';
import { useCallView } from './callView';
import { stopMySounds } from './soundboard';
import { canShareScreen, leaveVoice, screenAudioOn, setScreenAudio, switchScreenSource, toggleCamera, toggleDeafen, toggleMute, toggleScreenShare } from './voice';

export function CallBarButton({ label, onPress, children, pressed, alert, end }: {
  label: string;
  onPress: () => void;
  children: ReactNode;
  pressed?: boolean;
  alert?: boolean;
  end?: boolean;
}) {
  const tone = alert
    ? '[--button-bg:color-mix(in_srgb,var(--danger)_15%,var(--default))] [--button-bg-hover:color-mix(in_srgb,var(--danger)_24%,var(--default))] [--button-fg:var(--danger)]'
    : pressed && !end ? '[--button-bg:var(--surface-tertiary)] [--button-bg-hover:var(--default-hover)]' : '';

  return (
    <Tooltip delay={250} closeDelay={0}>
      <Button isIconOnly variant={end ? 'danger' : 'tertiary'} aria-label={label} aria-pressed={pressed} onPress={onPress} className={`call-control ${tone}`}>
        {children}
      </Button>
      <Tooltip.Content placement="top">{label}</Tooltip.Content>
    </Tooltip>
  );
}

function DeviceControl({ kind, label, menuLabel, onPress, active, off, menuDisabled, children }: {
  kind: DeviceKind;
  label: string;
  menuLabel: string;
  onPress: () => void;
  active: boolean;
  off?: boolean;
  menuDisabled?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex shrink-0 items-center gap-0.5">
      <CallBarButton label={label} pressed={active} alert={off} onPress={onPress}>{children}</CallBarButton>
      <DeviceMenu
        kind={kind}
        label={menuLabel}
        disabled={menuDisabled}
        className={`grid size-7 shrink-0 place-items-center rounded-full outline-none transition-colors hover:bg-white/[0.08] aria-expanded:bg-white/[0.08] @max-[23rem]:size-6 data-[focus-visible=true]:ring-2 data-[focus-visible=true]:ring-inset data-[focus-visible=true]:ring-focus ${off ? 'text-danger/70' : 'text-muted hover:text-foreground'}`}
      />
    </div>
  );
}

/** While you share: the stop button and, glued to it, the menu with what else can be done with the share. */
function ScreenShareControl() {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [, refresh] = useState(0);
  const audio = useStore((s) => screenAudioOn(s.room));
  return (
    <div className="flex shrink-0 items-center gap-0.5">
      <CallBarButton pressed label={t('voice.screen.stop')} onPress={toggleScreenShare}>
        <ScreenOffIcon />
      </CallBarButton>
      <Menu
        label={t('voice.screen.menu')}
        placement="top end"
        isOpen={open}
        onOpenChange={setOpen}
        triggerClassName="grid size-7 shrink-0 place-items-center rounded-full text-foreground/80 outline-none transition-colors hover:bg-white/[0.08] hover:text-foreground aria-expanded:bg-white/[0.08] data-[focus-visible=true]:ring-2 data-[focus-visible=true]:ring-inset data-[focus-visible=true]:ring-focus"
        trigger={<ChevronDownIcon className="chevron-flip size-3.5" aria-hidden="true" />}
        onAction={(key) => {
          if (key === 'stop') void toggleScreenShare();
          if (key === 'change') void switchScreenSource();
          if (key === 'audio') void setScreenAudio(!audio).then(() => refresh((n) => n + 1));
        }}
      >
        <MenuItem id="change" label={t('voice.screen.change')} icon={<ScreenIcon />} />
        {audio !== null && <MenuItem id="audio" label={t('voice.screen.audio')} icon={<SpeakerIcon />} checkbox={audio} />}
        <MenuSeparator />
        <MenuItem id="stop" label={t('voice.screen.stop')} icon={<ScreenOffIcon />} danger />
      </Menu>
    </div>
  );
}

export function CallControls({ className = '', channel, viewActions, fullscreen = false }: {
  className?: string;
  channel?: Channel;
  viewActions?: ReactNode;
  fullscreen?: boolean;
}) {
  const { t } = useT();
  const micOff = useStore((s) => s.muted || s.deafened);
  const deafened = useStore((s) => s.deafened);
  const cameraOn = useStore((s) => s.cameraOn);
  const cameraPending = useStore((s) => s.cameraPending);
  const screenSharing = useStore((s) => s.screenSharing);
  const myPlaying = useStore((s) => s.myPlaying);
  const mySounds = useStore((s) => s.mySounds);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const { showSelf, showNoVideo, set: setView } = useCallView();
  const [compact, setCompact] = useState(false);
  const toolbar = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const element = toolbar.current;
    if (!element) return;
    let previous: boolean | undefined;
    const update = (width: number) => {
      const next = width < 560;
      if (next === previous) return;
      if (previous !== undefined) setMoreOpen(false);
      previous = next;
      setCompact(next);
    };
    const style = getComputedStyle(element);
    update(element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight));
    const observer = new ResizeObserver(([entry]) => update(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const detachedActions = fullscreen ? undefined : viewActions;
  const screenLabel = t(screenSharing ? 'voice.screen.stop' : 'voice.screen.start');
  const playingName = myPlaying ? mySounds.find((x) => x.id === myPlaying.soundId)?.name ?? '' : '';
  const openInvite = () => {
    setMoreOpen(false);
    setInviteOpen(true);
  };

  return (
    <div ref={toolbar} role="group" aria-label={t('voice.controls.title')} className={`@container shrink-0 px-(--app-pane-inset) py-3 ${className}`}>
      <div className={`grid grid-cols-2 items-center gap-x-2 gap-y-1 @min-[35rem]:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] ${detachedActions ? '@min-[25rem]:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]' : ''}`}>
        {!fullscreen && !compact && <div className="col-start-1 row-start-1 flex items-center">
          {channel && <CallBarButton label={t('shell.menu.inviteToRoom')} onPress={openInvite}><UserPlusIcon /></CallBarButton>}
        </div>}
        <div className={`col-span-2 col-start-1 flex min-w-0 items-center justify-center gap-2 @max-[23rem]:gap-1 @min-[35rem]:col-span-1 @min-[35rem]:col-start-2 @min-[35rem]:row-start-1 ${detachedActions ? 'row-start-2 @min-[25rem]:col-span-1 @min-[25rem]:col-start-2 @min-[25rem]:row-start-1' : 'row-start-1'}`}>
          <div data-call-dock className="no-scrollbar min-w-0 overflow-x-auto rounded-full bg-island ring-1 ring-inset ring-separator">
            <div className="flex w-max items-center gap-1.5 p-1.5 @max-[23rem]:gap-1 @max-[23rem]:p-1">
              <div role="group" aria-label={t('voice.controls.devices')} className="flex shrink-0 items-center gap-1.5 @max-[23rem]:gap-1">
                <DeviceControl kind="audioinput" label={t(micOff ? 'voice.mic.unmute' : 'voice.mic.mute')} menuLabel={t('shell.call.pickMic')} active={micOff} off={micOff} onPress={toggleMute}>
                  {micOff ? <MicSlashIcon /> : <MicIcon />}
                </DeviceControl>
                {fullscreen && !compact && (
                  <CallBarButton label={t(deafened ? 'voice.deafen.off' : 'voice.deafen.on')} pressed={deafened} alert={deafened} onPress={toggleDeafen}>
                    {deafened ? <HeadphonesSlashIcon /> : <HeadphonesIcon />}
                  </CallBarButton>
                )}
                <DeviceControl kind="videoinput" label={t(cameraOn ? 'voice.camera.off' : 'voice.camera.on')} menuLabel={t('voice.camera.choose')} active={cameraOn} menuDisabled={cameraPending} onPress={toggleCamera}>
                  {cameraOn ? <VideoCameraIcon /> : <VideoCameraSlashIcon />}
                </DeviceControl>
              </div>
              <div role="group" aria-label={t('voice.controls.actions')} className="flex shrink-0 items-center gap-1.5 @max-[23rem]:gap-1">
                {myPlaying && !compact && (
                  <CallBarButton label={t('voice.soundboard.stopForCall', { name: playingName })} onPress={() => void stopMySounds()}>
                    <StopIcon />
                  </CallBarButton>
                )}
                {!compact && canShareScreen && (screenSharing ? <ScreenShareControl /> : (
                  <CallBarButton label={screenLabel} onPress={toggleScreenShare}>
                    <ComputerDesktopIcon />
                  </CallBarButton>
                ))}
                <SoundboardButton look="control" stopsPlayback={compact} />
                <Menu
                  label={t('voice.controls.more')}
                  placement="top end"
                  isOpen={moreOpen}
                  onOpenChange={setMoreOpen}
                  onAction={(key) => {
                    if (key === 'deafen') void toggleDeafen();
                    if (key === 'screen') void toggleScreenShare();
                    if (key === 'change') void switchScreenSource();
                    if (key === 'invite') setInviteOpen(true);
                    if (key === 'self') setView({ showSelf: !showSelf });
                    if (key === 'noVideo') setView({ showNoVideo: !showNoVideo });
                    if (key === 'settings') setSettingsOpen(true);
                  }}
                  button={
                    <Tooltip delay={250} closeDelay={0}>
                      <Button
                        isIconOnly
                        variant="tertiary"
                        aria-label={t('voice.controls.more')}
                        className="call-control aria-expanded:[--button-bg:var(--surface-tertiary)]"
                      >
                        <EllipsisHorizontalIcon aria-hidden="true" />
                      </Button>
                      <Tooltip.Content placement="top">{t('voice.controls.more')}</Tooltip.Content>
                    </Tooltip>
                  }
                >
                  <MenuItem id="deafen" label={t(deafened ? 'voice.deafen.off' : 'voice.deafen.on')} icon={deafened ? <HeadphonesSlashIcon /> : <HeadphonesIcon />} />
                  {compact && canShareScreen && <MenuItem id="screen" label={screenLabel} icon={screenSharing ? <ScreenOffIcon /> : <ScreenIcon />} />}
                  {screenSharing && <MenuItem id="change" label={t('voice.screen.change')} icon={<ScreenIcon />} />}
                  {compact && channel && <MenuItem id="invite" label={t('shell.menu.inviteToRoom')} icon={<UserPlusIcon />} />}
                  <MenuSeparator />
                  <MenuItem id="self" label={t('voice.view.self')} icon={<VideoCameraIcon />} checkbox={showSelf} />
                  <MenuItem id="noVideo" label={t('voice.view.noVideo')} icon={<VideoCameraSlashIcon />} checkbox={showNoVideo} />
                  <MenuSeparator />
                  <MenuItem id="settings" label={t('voice.controls.settings')} icon={<GearIcon />} />
                </Menu>
                {fullscreen && viewActions}
                <CallBarButton label={t('voice.leave')} onPress={() => void leaveVoice()} end><PhoneXMarkIcon /></CallBarButton>
              </div>
            </div>
          </div>
        </div>
        {detachedActions && (
          <div className="col-span-2 col-start-1 row-start-1 flex min-h-9 items-center justify-end @min-[25rem]:col-span-1 @min-[25rem]:col-start-3">
            {detachedActions}
          </div>
        )}
      </div>
      {inviteOpen && channel && <InviteToRoom channel={channel} onClose={() => setInviteOpen(false)} />}
      {settingsOpen && <SettingsDialog start="voice" onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}
