import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Button, Popover, Tooltip } from '@heroui/react';
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
import { HeadphonesIcon, HeadphonesSlashIcon, MicIcon, MicSlashIcon, StopIcon } from '../ui/icons';
import type { DeviceKind } from './devices';
import { SoundboardButton } from './SoundPad';
import { stopMySounds } from './soundboard';
import { canShareScreen, leaveVoice, screenSource, switchScreenSource, toggleCamera, toggleDeafen, toggleMute, toggleScreenShare } from './voice';

const item = 'call-control [&_svg]:size-[18px]';

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
      <Button isIconOnly variant={end ? 'danger' : 'tertiary'} aria-label={label} aria-pressed={pressed} onPress={onPress} className={`${item} ${tone}`}>
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
        className="grid size-6 shrink-0 place-items-center rounded-full text-muted outline-none transition-colors hover:bg-default hover:text-foreground aria-expanded:bg-default @max-[23rem]:size-5 data-[focus-visible=true]:ring-2 data-[focus-visible=true]:ring-inset data-[focus-visible=true]:ring-focus"
      />
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
  const source = useStore((s) => s.screenSharing ? screenSource(s.room) : '');
  const myPlaying = useStore((s) => s.myPlaying);
  const mySounds = useStore((s) => s.mySounds);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
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
      {screenSharing && !fullscreen && (
        <div className="mb-1 flex min-w-0 items-center justify-center gap-2 text-xs">
          <span className="truncate text-muted" title={source}>{t('voice.screen.source', { name: source })}</span>
          <Button variant="ghost" size="sm" onPress={switchScreenSource} className="h-7 shrink-0 rounded-full px-3 text-xs">
            {t('voice.screen.change')}
          </Button>
        </div>
      )}
      <div className={`grid grid-cols-2 items-center gap-x-2 gap-y-1 @min-[35rem]:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] ${detachedActions ? '@min-[25rem]:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]' : ''}`}>
        {!fullscreen && !compact && <div className="col-start-1 row-start-1 flex h-9 items-center">
          {channel && <CallBarButton label={t('shell.menu.inviteToRoom')} onPress={openInvite}><UserPlusIcon /></CallBarButton>}
        </div>}
        <div className={`col-span-2 col-start-1 flex min-w-0 items-center justify-center gap-2 @max-[23rem]:gap-1 @min-[35rem]:col-span-1 @min-[35rem]:col-start-2 @min-[35rem]:row-start-1 ${detachedActions ? 'row-start-2 @min-[25rem]:col-span-1 @min-[25rem]:col-start-2 @min-[25rem]:row-start-1' : 'row-start-1'}`}>
          <div className="no-scrollbar min-w-0 overflow-x-auto rounded-full bg-island ring-1 ring-inset ring-separator">
            <div className="flex w-max items-center gap-1.5 p-1.5">
              <div role="group" aria-label={t('voice.controls.devices')} className="flex shrink-0 items-center gap-1.5">
                <DeviceControl kind="audioinput" label={t(micOff ? 'voice.mic.unmute' : 'voice.mic.mute')} menuLabel={t('shell.call.pickMic')} active={micOff} off={micOff} onPress={toggleMute}>
                  {micOff ? <MicSlashIcon /> : <MicIcon />}
                </DeviceControl>
                {fullscreen && (
                  <CallBarButton label={t(deafened ? 'voice.deafen.off' : 'voice.deafen.on')} pressed={deafened} alert={deafened} onPress={toggleDeafen}>
                    {deafened ? <HeadphonesSlashIcon /> : <HeadphonesIcon />}
                  </CallBarButton>
                )}
                <DeviceControl kind="videoinput" label={t(cameraOn ? 'voice.camera.off' : 'voice.camera.on')} menuLabel={t('voice.camera.choose')} active={cameraOn} menuDisabled={cameraPending} onPress={toggleCamera}>
                  {cameraOn ? <VideoCameraIcon /> : <VideoCameraSlashIcon />}
                </DeviceControl>
              </div>
              <div role="group" aria-label={t('voice.controls.actions')} className="flex shrink-0 items-center gap-1.5">
                {myPlaying && (
                  <CallBarButton label={t('voice.soundboard.stopForCall', { name: playingName })} onPress={() => void stopMySounds()}>
                    <StopIcon />
                  </CallBarButton>
                )}
                {(!compact || fullscreen) && canShareScreen && (
                  <CallBarButton label={screenLabel} pressed={screenSharing} onPress={toggleScreenShare}>
                    <ComputerDesktopIcon />
                  </CallBarButton>
                )}
                <SoundboardButton look="control" />
                <Popover isOpen={moreOpen} onOpenChange={setMoreOpen}>
                  <Tooltip delay={250} closeDelay={0}>
                    <Button
                      isIconOnly
                      variant="tertiary"
                      aria-label={t('voice.controls.more')}
                      className={`${item} aria-expanded:[--button-bg:var(--surface-tertiary)]`}
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
                      {compact && !fullscreen && canShareScreen && (
                        <Button variant="ghost" className="w-full justify-start rounded-full px-3" onPress={() => {
                          setMoreOpen(false);
                          void toggleScreenShare();
                        }}>
                          <ComputerDesktopIcon className="size-5" aria-hidden="true" />
                          {screenLabel}
                        </Button>
                      )}
                      {compact && channel && (
                        <Button variant="ghost" className="w-full justify-start rounded-full px-3" onPress={openInvite}>
                          <UserPlusIcon className="size-5" aria-hidden="true" />
                          {t('shell.menu.inviteToRoom')}
                        </Button>
                      )}
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
