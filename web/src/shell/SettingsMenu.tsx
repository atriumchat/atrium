import { useRef, useState } from 'react';
import { ChevronDownIcon } from '@heroicons/react/24/solid';
import { Dropdown, Label } from '@heroui/react';
import { useT } from '../i18n';
import { getPreferredDevice, listDevices, setPreferredDevice, type DeviceKind } from '../voice/devices';
import { CheckIcon, GearIcon } from '../ui/icons';
import { SettingsDialog } from './SettingsDialog';
import { RoundButton } from '../ui/ui';

/** Gear in the user panel: opens the settings. */
export function SettingsMenu() {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  return (
    <>
      <RoundButton size="sm" tone="ghost" label={t('settings.title')} onPress={() => setOpen(true)} className="text-muted hover:text-foreground">
        <GearIcon />
      </RoundButton>
      {open && <SettingsDialog onClose={() => setOpen(false)} />}
    </>
  );
}

/** The chevron next to a call control opens its device menu. */
export function DeviceMenu({ kind, label, className, disabled }: { kind: DeviceKind; label: string; className?: string; disabled?: boolean }) {
  const { t } = useT();
  const [devices, setDevices] = useState<MediaDeviceInfo[] | null>(null);
  const [current, setCurrent] = useState(() => getPreferredDevice(kind) ?? 'default');

  const enumeration = useRef(0);
  const camera = kind === 'videoinput';
  const options = devices?.filter((d) => d.deviceId && (!camera || d.deviceId !== 'default'));
  return (
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
          'flex size-5 items-center justify-center rounded-full text-muted outline-none transition-colors hover:bg-default hover:text-foreground data-[focus-visible=true]:ring-2 data-[focus-visible=true]:ring-focus'
        }
      >
        <ChevronDownIcon className="size-3.5" strokeWidth={2.5} aria-hidden="true" />
      </Dropdown.Trigger>
      <Dropdown.Popover placement="top" className="min-w-64 max-w-80">
        <Dropdown.Menu
          aria-label={label}
          onAction={(key) => {
            const id = String(key);
            void setPreferredDevice(kind, id);
          }}
        >
          {camera && (
            <Dropdown.Item id="default" textValue={t('voice.devices.system')}>
              <Label>{t('voice.devices.system')}</Label>
              {current === 'default' && <CheckIcon size={16} className="ml-auto shrink-0 text-accent" />}
            </Dropdown.Item>
          )}
          {!options?.length ? (
            <Dropdown.Item id="none" textValue={t('settings.device.none')} isDisabled>
              <Label>{devices === null ? t('settings.device.loading') : t(camera && devices.length > 0 ? 'voice.camera.deviceHint' : 'settings.device.empty')}</Label>
            </Dropdown.Item>
          ) : (
            options.map((d) => (
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
