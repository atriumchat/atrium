import { useRef, useState } from 'react';
import { ChevronDownIcon, Cog6ToothIcon, EyeIcon } from '@heroicons/react/24/solid';
import { Description, Dropdown, Label, Separator } from '@heroui/react';
import { useT } from '../i18n';
import { getPreferredDevice, listDevices, setPreferredDevice, type DeviceKind } from '../voice/devices';
import { GearIcon } from '../ui/icons';
import { SettingsDialog } from './SettingsDialog';
import { CameraPreview } from '../voice/CameraPreview';
import { MicMenu } from '../voice/MicMenu';
import { Radio } from '../ui/Radio';

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
    <Dropdown onOpenChange={(open) => {
      if (!open) return;
      const request = ++enumeration.current;
      setCurrent(getPreferredDevice(kind) ?? 'default');
      void listDevices(kind, !camera).then((list) => {
        if (request === enumeration.current) setDevices(list);
      });
    }}>
      <Dropdown.Trigger
        aria-label={label}
        render={(props) => <button {...props} title={label} />}
        isDisabled={disabled}
        className={
          className ??
          'flex h-9 w-5 items-center justify-center rounded-r-[10px] text-muted outline-none transition-colors hover:bg-default hover:text-foreground data-[focus-visible=true]:ring-2 data-[focus-visible=true]:ring-focus'
        }
      >
        <ChevronDownIcon className="chevron-flip size-3.5" strokeWidth={2.5} aria-hidden="true" />
      </Dropdown.Trigger>
      <Dropdown.Popover placement="top" className="min-w-64 max-w-80">
        <Dropdown.Menu
          aria-label={label}
          onAction={(key) => {
            if (key === '__preview') setPreview(true);
            if (key === '__settings') setSettings(true);
          }}
        >
          <Dropdown.SubmenuTrigger>
            <Dropdown.Item id="__device" textValue={title}>
              <div className="flex min-w-0 flex-1 flex-col">
                <Label>{title}</Label>
                <Description className="truncate">{currentName}</Description>
              </div>
              <Dropdown.SubmenuIndicator />
            </Dropdown.Item>
            <Dropdown.Popover className="min-w-64 max-w-80">
              <Dropdown.Menu
                aria-label={title}
                selectionMode="single"
                disallowEmptySelection
                selectedKeys={[current]}
                onSelectionChange={(keys) => {
                  const id = [...keys][0];
                  if (id === undefined) return;
                  setCurrent(String(id));
                  void setPreferredDevice(kind, String(id));
                }}
              >
                {camera && (
                  <Dropdown.Item id="default" textValue={t('voice.devices.system')}>
                    {({ isSelected }) => (
                      <>
                        <Label>{t('voice.devices.system')}</Label>
                        <Radio on={isSelected} />
                      </>
                    )}
                  </Dropdown.Item>
                )}
                {!options?.length ? (
                  <Dropdown.Item id="none" textValue={t('settings.device.none')} isDisabled>
                    <Label>{devices === null ? t('settings.device.loading') : t(camera && devices.length > 0 ? 'voice.camera.deviceHint' : 'settings.device.empty')}</Label>
                  </Dropdown.Item>
                ) : (
                  options.map((d) => (
                    <Dropdown.Item key={d.deviceId} id={d.deviceId} textValue={d.label || t('settings.device.unnamedShort')}>
                      {({ isSelected }) => (
                        <>
                          <Label className="truncate">{d.label || t('settings.device.unnamed')}</Label>
                          <Radio on={isSelected} />
                        </>
                      )}
                    </Dropdown.Item>
                  ))
                )}
              </Dropdown.Menu>
            </Dropdown.Popover>
          </Dropdown.SubmenuTrigger>
          {kind !== 'audiooutput' && <Separator />}
          {camera && (
            <Dropdown.Item id="__preview" textValue={t('voice.camera.preview')}>
              <EyeIcon className="size-5 text-muted" aria-hidden="true" />
              <Label>{t('voice.camera.preview')}</Label>
            </Dropdown.Item>
          )}
          {kind !== 'audiooutput' && (
            <Dropdown.Item id="__settings" textValue={t(camera ? 'voice.camera.settings' : 'voice.controls.settings')}>
              <Cog6ToothIcon className="size-5 text-muted" aria-hidden="true" />
              <Label>{t(camera ? 'voice.camera.settings' : 'voice.controls.settings')}</Label>
            </Dropdown.Item>
          )}
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
    {preview && <CameraPreview onClose={() => setPreview(false)} />}
    {settings && <SettingsDialog start="voice" onClose={() => setSettings(false)} />}
    </>
  );
}
