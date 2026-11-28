import { useRef, useState } from 'react';
import { EyeIcon } from '@heroicons/react/24/solid';
import { useT } from '../i18n';
import { getPreferredDevice, listDevices, setPreferredDevice, type DeviceKind } from '../voice/devices';
import { ChevronDownIcon, GearIcon, MicIcon, SpeakerIcon, VideoIcon } from '../ui/icons';
import { Menu, MenuItem, MenuSeparator, SubMenu } from '../ui/Menu';
import { SettingsDialog } from './SettingsDialog';
import { CameraPreview } from '../voice/CameraPreview';
import { MicMenu } from '../voice/MicMenu';

/** Gear in the user panel: opens the settings. */
export function SettingsMenu() {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label={t('settings.title')}
        className="flex h-9 w-9 items-center justify-center rounded-full text-muted outline-none transition-colors hover:bg-default hover:text-foreground focus-visible:ring-2 focus-visible:ring-focus"
      >
        <GearIcon size={20} />
      </button>
      {open && <SettingsDialog onClose={() => setOpen(false)} />}
    </>
  );
}

/** The chevron next to a call control opens its menu: for the microphone Discord's whole one, for the rest a device list. */
export function DeviceMenu(props: { kind: DeviceKind; label: string; className?: string; disabled?: boolean }) {
  return props.kind === 'audioinput' ? <MicMenu label={props.label} className={props.className} disabled={props.disabled} /> : <DeviceListMenu {...props} />;
}

function DeviceListMenu({ kind, label, className, disabled }: { kind: DeviceKind; label: string; className?: string; disabled?: boolean }) {
  const { t } = useT();
  const [devices, setDevices] = useState<MediaDeviceInfo[] | null>(null);
  const [current, setCurrent] = useState(() => getPreferredDevice(kind) ?? 'default');
  const [preview, setPreview] = useState(false);
  const [settings, setSettings] = useState(false);

  const enumeration = useRef(0);
  const camera = kind === 'videoinput';
  const options = devices?.filter((d) => d.deviceId && (!camera || d.deviceId !== 'default'));
  const title = t(camera ? 'voice.devices.camera' : kind === 'audioinput' ? 'voice.devices.mic' : 'voice.devices.output');
  const currentName =
    current === 'default' && (camera || !devices?.some((d) => d.deviceId === 'default'))
      ? t(kind === 'audiooutput' ? 'voice.devices.systemOutput' : 'voice.devices.system')
      : devices?.find((d) => d.deviceId === current)?.label || t('settings.device.unnamed');
  return (
    <>
    <Menu
      label={label}
      placement="top"
      wide
      onOpenChange={(open) => {
        if (!open) return;
        const request = ++enumeration.current;
        setCurrent(getPreferredDevice(kind) ?? 'default');
        void listDevices(kind, !camera).then((list) => {
          if (request === enumeration.current) setDevices(list);
        });
      }}
      triggerProps={{ render: (props) => <button {...props} title={label} />, isDisabled: disabled }}
      triggerClassName={
        className ??
        'flex h-9 w-5 items-center justify-center rounded-r-[10px] text-muted outline-none transition-colors hover:bg-default hover:text-foreground data-[focus-visible=true]:ring-2 data-[focus-visible=true]:ring-focus'
      }
      trigger={<ChevronDownIcon className="chevron-flip size-3.5" strokeWidth={2.5} aria-hidden="true" />}
      onAction={(key) => {
        if (key === '__preview') setPreview(true);
        if (key === '__settings') setSettings(true);
      }}
    >
      <SubMenu
        id="__device"
        label={title}
        description={currentName}
        icon={camera ? <VideoIcon /> : kind === 'audioinput' ? <MicIcon /> : <SpeakerIcon />}
        wide
        choice={{
          selected: current,
          onSelect: (id) => {
            setCurrent(id);
            void setPreferredDevice(kind, id);
          },
        }}
      >
        {[
          camera && <MenuItem key="default" id="default" label={t('voice.devices.system')} radio />,
          !options?.length ? (
            <MenuItem key="none" id="none" label={devices === null ? t('settings.device.loading') : t(camera && devices.length > 0 ? 'voice.camera.deviceHint' : 'settings.device.empty')} disabled />
          ) : (
            options.map((d) => <MenuItem key={d.deviceId} id={d.deviceId} label={d.label || t('settings.device.unnamed')} radio />)
          ),
        ]}
      </SubMenu>
      {kind !== 'audiooutput' && <MenuSeparator />}
      {camera && <MenuItem id="__preview" label={t('voice.camera.preview')} icon={<EyeIcon />} />}
      {kind !== 'audiooutput' && <MenuItem id="__settings" label={t(camera ? 'voice.camera.settings' : 'voice.controls.settings')} icon={<GearIcon />} />}
    </Menu>
    {preview && <CameraPreview onClose={() => setPreview(false)} />}
    {settings && <SettingsDialog start="voice" onClose={() => setSettings(false)} />}
    </>
  );
}
