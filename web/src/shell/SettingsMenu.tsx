import { useState } from 'react';
import { Dropdown, Label } from '@heroui/react';
import { useT } from '../i18n';
import { getPreferredDevice, listDevices, setPreferredDevice, type AudioDeviceKind } from '../voice/devices';
import { CheckIcon, ChevronDownIcon, GearIcon } from '../ui/icons';
import { SettingsDialog } from './SettingsDialog';

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

/** The chevron glued to the mic / headphones button: pick the input or output device. `className` restyles it. */
export function DeviceMenu({ kind, label, className }: { kind: AudioDeviceKind; label: string; className?: string }) {
  const { t } = useT();
  const [devices, setDevices] = useState<MediaDeviceInfo[] | null>(null);
  const [current, setCurrent] = useState(() => getPreferredDevice(kind) ?? 'default');

  return (
    <Dropdown onOpenChange={(open) => open && listDevices(kind).then(setDevices)}>
      <Dropdown.Trigger
        aria-label={label}
        className={
          className ??
          'flex h-9 w-5 items-center justify-center rounded-r-[10px] text-muted outline-none transition-colors hover:bg-default hover:text-foreground data-[focus-visible=true]:ring-2 data-[focus-visible=true]:ring-focus'
        }
      >
        <ChevronDownIcon size={14} strokeWidth={2.5} />
      </Dropdown.Trigger>
      <Dropdown.Popover placement="top" className="min-w-64 max-w-80">
        <Dropdown.Menu
          aria-label={label}
          onAction={(key) => {
            const id = String(key);
            setCurrent(id);
            setPreferredDevice(kind, id);
          }}
        >
          {devices === null || devices.length === 0 ? (
            <Dropdown.Item id="none" textValue={t('settings.device.none')} isDisabled>
              <Label>{devices === null ? t('settings.device.loading') : t('settings.device.empty')}</Label>
            </Dropdown.Item>
          ) : (
            devices.map((d) => (
              <Dropdown.Item key={d.deviceId} id={d.deviceId} textValue={d.label || t('settings.device.unnamedShort')}>
                <Label className="truncate">{d.label || t('settings.device.unnamed')}</Label>
                {d.deviceId === current && <CheckIcon size={16} className="ml-auto shrink-0 text-accent" />}
              </Dropdown.Item>
            ))
          )}
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  );
}
