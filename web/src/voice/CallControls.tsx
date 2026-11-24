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
import { HeadphonesIcon, HeadphonesSlashIcon, MicIcon, MicSlashIcon } from '../ui/icons';
import type { DeviceKind } from './devices';
import { SoundboardButton } from './SoundPad';
import { canShareScreen, leaveVoice, screenSource, switchScreenSource, toggleCamera, toggleDeafen, toggleMute, toggleScreenShare } from './voice';

const item = 'call-control @max-[23rem]:w-8 @max-[23rem]:min-w-8 [&_svg]:size-5';
const neutral = '[--button-bg:transparent] [--button-bg-hover:var(--default)] hover:bg-default aria-expanded:bg-default';

export function CallBarButton({ label, onPress, children, pressed, alert, end }: {
  label: string;
  onPress: () => void;
  children: ReactNode;
  pressed?: boolean;
  alert?: boolean;
  end?: boolean;
}) {
  const tone = end
    ? 'size-(--app-call-dock-height)! min-w-(--app-call-dock-height)! rounded-panel! bg-danger text-danger-foreground [--button-fg:var(--danger-foreground)] [--button-bg:var(--danger)] [--button-bg-hover:var(--danger)] hover:brightness-110'
    : alert
      ? 'bg-danger/15 text-danger-foreground [--button-fg:var(--danger-foreground)] [--button-bg:transparent] [--button-bg-hover:color-mix(in_srgb,var(--danger)_22%,transparent)]'
      : pressed ? 'bg-white/15 [--button-bg:transparent] hover:bg-white/20' : neutral;

  return (
    <Tooltip delay={250} closeDelay={0}>
      <Button isIconOnly variant="tertiary" aria-label={label} aria-pressed={pressed} onPress={onPress} className={`${item} ${tone}`}>
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
    <div className="flex shrink-0 items-center">
      <CallBarButton label={label} pressed={active} alert={off} onPress={onPress}>{children}</CallBarButton>
      <DeviceMenu
        kind={kind}
        label={menuLabel}
        disabled={menuDisabled}
        className="grid h-9 w-6 shrink-0 place-items-center @max-[23rem]:w-5 rounded-fine text-muted outline-none transition-colors hover:bg-default hover:text-foreground aria-expanded:bg-default data-[focus-visible=true]:ring-2 data-[focus-visible=true]:ring-inset data-[focus-visible=true]:ring-focus"
      />
    </div>
  );
}

export function CallControls({ className = '', channel, viewActions }: {
  className?: string;
  channel?: Channel;
  viewActions?: ReactNode;
}) {
  const { t } = useT();
  const micOff = useStore((s) => s.muted || s.deafened);
  const deafened = useStore((s) => s.deafened);
  const cameraOn = useStore((s) => s.cameraOn);
  const cameraPending = useStore((s) => s.cameraPending);
  const screenSharing = useStore((s) => s.screenSharing);
  const source = useStore((s) => s.screenSharing ? screenSource(s.room) : '');
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
  const screenLabel = t(screenSharing ? 'voice.screen.stop' : 'voice.screen.start');
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
      {screenSharing && (
        <div className="mb-1 flex min-w-0 items-center justify-center gap-2 text-xs">
          <span className="truncate text-muted" title={source}>{t('voice.screen.source', { name: source })}</span>
          <button type="button" onClick={switchScreenSource} className="shrink-0 rounded-row px-2 py-1 text-foreground hover:bg-default focus-visible:ring-2 focus-visible:ring-focus">
            {t('voice.screen.change')}
          </button>
        </div>
      )}
      <div className={`grid grid-cols-2 items-center gap-x-2 gap-y-1 @min-[35rem]:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] ${viewActions ? '@min-[25rem]:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]' : ''}`}>
        {!compact && <div className="col-start-1 row-start-1 flex h-9 items-center">
          {channel && <CallBarButton label={t('shell.menu.inviteToRoom')} onPress={openInvite}><UserPlusIcon /></CallBarButton>}
        </div>}
        <div className={`col-span-2 col-start-1 flex min-w-0 items-center justify-center gap-2 @max-[23rem]:gap-1 @min-[35rem]:col-span-1 @min-[35rem]:col-start-2 @min-[35rem]:row-start-1 ${viewActions ? 'row-start-2 @min-[25rem]:col-span-1 @min-[25rem]:col-start-2 @min-[25rem]:row-start-1' : 'row-start-1'}`}>
          <div className="no-scrollbar min-w-0 overflow-x-auto rounded-panel bg-island ring-1 ring-inset ring-separator">
            <div className="flex min-h-(--app-call-dock-height) w-max items-center gap-2 p-1">
              <div role="group" aria-label={t('voice.controls.devices')} className="flex shrink-0 items-center gap-0.5">
                <DeviceControl kind="audioinput" label={t(micOff ? 'voice.mic.unmute' : 'voice.mic.mute')} menuLabel={t('shell.call.pickMic')} active={micOff} off={micOff} onPress={toggleMute}>
                  {micOff ? <MicSlashIcon /> : <MicIcon />}
                </DeviceControl>
                <DeviceControl kind="videoinput" label={t(cameraOn ? 'voice.camera.off' : 'voice.camera.on')} menuLabel={t('voice.camera.choose')} active={cameraOn} menuDisabled={cameraPending} onPress={toggleCamera}>
                  {cameraOn ? <VideoCameraIcon /> : <VideoCameraSlashIcon />}
                </DeviceControl>
              </div>
              <div role="group" aria-label={t('voice.controls.actions')} className="flex shrink-0 items-center gap-0.5 border-l border-separator pl-2">
                {!compact && canShareScreen && (
                  <CallBarButton label={screenLabel} pressed={screenSharing} onPress={toggleScreenShare}>
                    <ComputerDesktopIcon />
                  </CallBarButton>
                )}
                <Popover isOpen={moreOpen} onOpenChange={setMoreOpen}>
                  <Popover.Trigger<'button'>
                    render={(props) => <button {...props} />}
                    type="button"
                    aria-label={t('voice.controls.more')}
                    title={t('voice.controls.more')}
                    className={`${item} ${neutral}`}
                  >
                    <EllipsisHorizontalIcon aria-hidden="true" />
                  </Popover.Trigger>
                  <Popover.Content placement="top end" className="w-64 max-w-[calc(100vw-16px)]">
                    <Popover.Dialog aria-label={t('voice.controls.more')} className="max-h-[calc(100dvh-24px)] overflow-auto p-2">
                      <div className="flex items-center justify-between gap-2 px-2 text-sm">
                        <span>{t('voice.controls.sound')}</span>
                        {outputControl}
                      </div>
                      {compact && canShareScreen && (
                        <Button variant="ghost" className="w-full justify-start rounded-row px-2" onPress={() => {
                          setMoreOpen(false);
                          void toggleScreenShare();
                        }}>
                          <ComputerDesktopIcon className="size-5" aria-hidden="true" />
                          {screenLabel}
                        </Button>
                      )}
                      <div className="flex items-center justify-between gap-2 px-2 text-sm">
                        <span>{t('voice.soundboard.label')}</span>
                        <SoundboardButton look="control" />
                      </div>
                      {compact && channel && (
                        <Button variant="ghost" className="w-full justify-start rounded-row px-2" onPress={openInvite}>
                          <UserPlusIcon className="size-5" aria-hidden="true" />
                          {t('shell.menu.inviteToRoom')}
                        </Button>
                      )}
                      <Button variant="ghost" className="w-full justify-start rounded-row px-2" onPress={openVoiceSettings}>
                        <Cog6ToothIcon className="size-5" aria-hidden="true" />
                        {t('voice.controls.settings')}
                      </Button>
                    </Popover.Dialog>
                  </Popover.Content>
                </Popover>
              </div>
            </div>
          </div>
          <CallBarButton label={t('voice.leave')} onPress={() => void leaveVoice()} end><PhoneXMarkIcon /></CallBarButton>
        </div>
        {viewActions && (
          <div className="col-span-2 col-start-1 row-start-1 flex min-h-9 items-center justify-end @min-[25rem]:col-span-1 @min-[25rem]:col-start-3">
            {viewActions}
          </div>
        )}
      </div>
      {inviteOpen && channel && <InviteToRoom channel={channel} onClose={() => setInviteOpen(false)} />}
      {settingsOpen && <SettingsDialog start="voice" onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}
