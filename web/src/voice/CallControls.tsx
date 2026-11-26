import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Button, Dropdown, Label, Popover, Tooltip } from '@heroui/react';
import {
  Cog6ToothIcon,
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
import { CheckIcon, ChevronDownIcon, HeadphonesIcon, HeadphonesSlashIcon, MicIcon, MicSlashIcon, ScreenOffIcon, StopIcon } from '../ui/icons';
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

/** A row of the "More" menu that switches something on or off; the check says which. */
function ViewToggle({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Button variant="ghost" aria-pressed={on} className="w-full justify-between rounded-full px-3" onPress={onPress}>
      {label}
      <span className="grid size-5 place-items-center">{on && <CheckIcon size={18} />}</span>
    </Button>
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
      <Dropdown isOpen={open} onOpenChange={setOpen}>
        <Dropdown.Trigger
          aria-label={t('voice.screen.menu')}
          className="grid size-7 shrink-0 place-items-center rounded-full text-foreground/80 outline-none transition-colors hover:bg-white/[0.08] hover:text-foreground aria-expanded:bg-white/[0.08] data-[focus-visible=true]:ring-2 data-[focus-visible=true]:ring-inset data-[focus-visible=true]:ring-focus"
        >
          <ChevronDownIcon className="chevron-flip size-3.5" aria-hidden="true" />
        </Dropdown.Trigger>
        <Dropdown.Popover placement="top end" className="min-w-60">
          <Dropdown.Menu
            aria-label={t('voice.screen.menu')}
            onAction={(key) => {
              if (key === 'stop') void toggleScreenShare();
              if (key === 'change') void switchScreenSource();
              if (key === 'audio') void setScreenAudio(!audio).then(() => refresh((n) => n + 1));
            }}
          >
            <Dropdown.Item id="stop" textValue={t('voice.screen.stop')} variant="danger">
              <Label>{t('voice.screen.stop')}</Label>
              <ScreenOffIcon className="ml-auto size-5 text-danger" />
            </Dropdown.Item>
            <Dropdown.Item id="change" textValue={t('voice.screen.change')}>
              <Label>{t('voice.screen.change')}</Label>
              <ComputerDesktopIcon className="ml-auto size-5 text-muted" aria-hidden="true" />
            </Dropdown.Item>
            {audio !== null && (
              <Dropdown.Item id="audio" textValue={t('voice.screen.audio')}>
                <Label>{t('voice.screen.audio')}</Label>
                <span className="ml-auto grid size-5 place-items-center">{audio && <CheckIcon size={18} />}</span>
              </Dropdown.Item>
            )}
          </Dropdown.Menu>
        </Dropdown.Popover>
      </Dropdown>
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

  const outputControl = (
    <DeviceControl kind="audiooutput" label={t(deafened ? 'voice.deafen.off' : 'voice.deafen.on')} menuLabel={t('shell.call.pickOutput')} active={deafened} off={deafened} onPress={toggleDeafen}>
      {deafened ? <HeadphonesSlashIcon /> : <HeadphonesIcon />}
    </DeviceControl>
  );
  const detachedActions = fullscreen ? undefined : viewActions;
  const screenLabel = t(screenSharing ? 'voice.screen.stop' : 'voice.screen.start');
  const playingName = myPlaying ? mySounds.find((x) => x.id === myPlaying.soundId)?.name ?? '' : '';
  const openVoiceSettings = () => {
    setMoreOpen(false);
    setSettingsOpen(true);
  };
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
                <Popover isOpen={moreOpen} onOpenChange={setMoreOpen}>
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
                  <Popover.Content placement="top end" className="w-64 max-w-[calc(100vw-16px)]">
                    <Popover.Dialog aria-label={t('voice.controls.more')} className="max-h-[calc(100dvh-24px)] overflow-auto p-2">
                      <div className="flex items-center justify-between gap-2 px-2 text-sm">
                        <span>{t('voice.controls.sound')}</span>
                        {outputControl}
                      </div>
                      {compact && canShareScreen && (
                        <Button variant="ghost" className="w-full justify-start rounded-full px-3" onPress={() => {
                          setMoreOpen(false);
                          void toggleScreenShare();
                        }}>
                          {screenSharing ? <ScreenOffIcon className="size-5" /> : <ComputerDesktopIcon className="size-5" aria-hidden="true" />}
                          {screenLabel}
                        </Button>
                      )}
                      {screenSharing && (
                        <Button variant="ghost" className="w-full justify-start rounded-full px-3" onPress={() => {
                          setMoreOpen(false);
                          void switchScreenSource();
                        }}>
                          <ComputerDesktopIcon className="size-5" aria-hidden="true" />
                          {t('voice.screen.change')}
                        </Button>
                      )}
                      {compact && channel && (
                        <Button variant="ghost" className="w-full justify-start rounded-full px-3" onPress={openInvite}>
                          <UserPlusIcon className="size-5" aria-hidden="true" />
                          {t('shell.menu.inviteToRoom')}
                        </Button>
                      )}
                      <div role="separator" className="mx-2 my-1 h-px bg-separator" />
                      <ViewToggle label={t('voice.view.self')} on={showSelf} onPress={() => setView({ showSelf: !showSelf })} />
                      <ViewToggle label={t('voice.view.noVideo')} on={showNoVideo} onPress={() => setView({ showNoVideo: !showNoVideo })} />
                      <div role="separator" className="mx-2 my-1 h-px bg-separator" />
                      <Button variant="ghost" className="w-full justify-start rounded-full px-3" onPress={openVoiceSettings}>
                        <Cog6ToothIcon className="size-5" aria-hidden="true" />
                        {t('voice.controls.settings')}
                      </Button>
                    </Popover.Dialog>
                  </Popover.Content>
                </Popover>
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
