import { useEffect, useState } from 'react';
import { ChevronDownIcon, ChevronRightIcon, Cog6ToothIcon } from '@heroicons/react/24/solid';
import { Dropdown, Label, Popover, Slider } from '@heroui/react';
import { useT } from '../i18n';
import { useStore } from '../store';
import { SettingsDialog } from '../shell/SettingsDialog';
import { CheckIcon } from '../ui/icons';
import { Radio } from '../ui/Radio';
import type { NoiseMode } from '../prefs';
import { getOutputVolume, getPreferredDevice, listDevices, setOutputVolume, setPreferredDevice, type AudioDeviceKind } from './devices';
import { micTrack } from './noise';
import { setInputVolume, setVoicePrefs, toggleDeafen } from './voice';

const SEGMENTS = 24;

/** How loud the microphone is right now, 0..1, read from the track that goes into the call; 0 when there is none. */
function useMicLevel(active: boolean) {
  const [level, setLevel] = useState(0);
  useEffect(() => {
    if (!active) return;
    const track = micTrack()?.mediaStreamTrack;
    if (!track || track.readyState !== 'live') {
      setLevel(0);
      return;
    }
    const context = new AudioContext();
    const source = context.createMediaStreamSource(new MediaStream([track]));
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    source.connect(analyser);
    const samples = new Float32Array(analyser.fftSize);
    let frame = 0;
    const tick = () => {
      analyser.getFloatTimeDomainData(samples);
      let sum = 0;
      for (const sample of samples) sum += sample * sample;
      const db = 10 * Math.log10(sum / samples.length || 1e-12);
      setLevel(Math.max(0, Math.min(1, (db + 60) / 60)));
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => {
      cancelAnimationFrame(frame);
      source.disconnect();
      void context.close();
    };
  }, [active]);
  return level;
}

/** A row that opens its own list of choices to the right: the title, what is chosen now, the arrow. */
function ChoiceRow({ title, value, children }: { title: string; value: string; children: React.ReactNode }) {
  return (
    <Dropdown>
      <Dropdown.Trigger className="flex w-full items-center gap-2 rounded-row px-3 py-2 text-left outline-none transition-colors hover:bg-default focus-visible:ring-2 focus-visible:ring-focus aria-expanded:bg-default">
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-[15px]">{title}</span>
          <span className="truncate text-[13px] text-muted">{value}</span>
        </span>
        <ChevronRightIcon className="size-4 shrink-0 text-muted" aria-hidden="true" />
      </Dropdown.Trigger>
      <Dropdown.Popover placement="right top" className="min-w-64 max-w-80">
        {children}
      </Dropdown.Popover>
    </Dropdown>
  );
}

function Choices({ label, selected, onSelect, items }: { label: string; selected: string; onSelect: (id: string) => void; items: { id: string; name: string }[] }) {
  return (
    <Dropdown.Menu
      aria-label={label}
      selectionMode="single"
      disallowEmptySelection
      selectedKeys={[selected]}
      onSelectionChange={(keys) => {
        const id = [...keys][0];
        if (id !== undefined) onSelect(String(id));
      }}
    >
      {items.map((item) => (
        <Dropdown.Item key={item.id} id={item.id} textValue={item.name}>
          {({ isSelected }) => (
            <>
              <Label className="truncate">{item.name}</Label>
              <Radio on={isSelected} />
            </>
          )}
        </Dropdown.Item>
      ))}
    </Dropdown.Menu>
  );
}

/**
 * The arrow beside the microphone opens Discord's menu: the input device, the noise profile and the output device
 * (each opens a list), the volume of everything you hear, the live level of the microphone, deafen and voice settings.
 */
export function MicMenu({ label, className, disabled }: { label: string; className?: string; disabled?: boolean }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState(false);
  const [devices, setDevices] = useState<Record<AudioDeviceKind, MediaDeviceInfo[] | null>>({ audioinput: null, audiooutput: null });
  const [chosen, setChosen] = useState<Record<AudioDeviceKind, string>>(() => ({
    audioinput: getPreferredDevice('audioinput') ?? 'default',
    audiooutput: getPreferredDevice('audiooutput') ?? 'default',
  }));
  const [output, setOutput] = useState(getOutputVolume);
  const inputVolume = useStore((s) => s.voicePrefs.inputVolume ?? 1);
  const noise = useStore((s) => s.voicePrefs.noise);
  const deafened = useStore((s) => s.deafened);
  const level = useMicLevel(open);

  useEffect(() => {
    if (!open) return;
    setChosen({ audioinput: getPreferredDevice('audioinput') ?? 'default', audiooutput: getPreferredDevice('audiooutput') ?? 'default' });
    setOutput(getOutputVolume());
    for (const kind of ['audioinput', 'audiooutput'] as const) {
      void listDevices(kind, kind === 'audioinput').then((list) => setDevices((all) => ({ ...all, [kind]: list })));
    }
  }, [open]);

  const list = (kind: AudioDeviceKind) =>
    (devices[kind] ?? []).filter((d) => d.deviceId).map((d) => ({ id: d.deviceId, name: d.label || t('settings.device.unnamed') }));
  const nameOf = (kind: AudioDeviceKind) => {
    const found = devices[kind]?.find((d) => d.deviceId === chosen[kind]);
    if (found) return found.label || t('settings.device.unnamed');
    return t(kind === 'audiooutput' ? 'voice.devices.systemOutput' : 'voice.devices.system');
  };
  const profiles: { id: NoiseMode; name: string }[] = [
    { id: 'off', name: t('voice.noise.off') },
    { id: 'browser', name: t('voice.noise.browser') },
    { id: 'rnnoise', name: t('voice.noise.rnnoise') },
  ];
  const lit = Math.round(level * SEGMENTS);

  return (
    <>
      <Popover isOpen={open} onOpenChange={setOpen}>
        <Popover.Trigger<'button'>
          render={(props) => <button {...props} type="button" title={label} disabled={disabled} />}
          aria-label={label}
          className={
            className ??
            'flex h-9 w-5 items-center justify-center rounded-r-full text-muted outline-none transition-colors hover:bg-default hover:text-foreground data-[focus-visible=true]:ring-2 data-[focus-visible=true]:ring-focus'
          }
        >
          <ChevronDownIcon className="chevron-flip size-3.5" aria-hidden="true" />
        </Popover.Trigger>
        <Popover.Content placement="top" className="w-[320px] max-w-[calc(100vw-16px)]">
          <Popover.Dialog aria-label={label} className="flex flex-col p-2 outline-none">
            <ChoiceRow title={t('voice.devices.mic')} value={nameOf('audioinput')}>
              <Choices
                label={t('voice.devices.mic')}
                selected={chosen.audioinput}
                items={list('audioinput')}
                onSelect={(id) => {
                  setChosen((c) => ({ ...c, audioinput: id }));
                  void setPreferredDevice('audioinput', id);
                }}
              />
            </ChoiceRow>
            <ChoiceRow title={t('voice.noise.title')} value={profiles.find((p) => p.id === noise)?.name ?? ''}>
              <Choices label={t('voice.noise.title')} selected={noise} items={profiles} onSelect={(id) => void setVoicePrefs({ noise: id as NoiseMode })} />
            </ChoiceRow>
            <ChoiceRow title={t('voice.devices.output')} value={nameOf('audiooutput')}>
              <Choices
                label={t('voice.devices.output')}
                selected={chosen.audiooutput}
                items={list('audiooutput')}
                onSelect={(id) => {
                  setChosen((c) => ({ ...c, audiooutput: id }));
                  void setPreferredDevice('audiooutput', id);
                }}
              />
            </ChoiceRow>
            <div role="separator" className="mx-3 my-2 h-px bg-separator" />
            <div className="px-3 py-1">
              <p className="text-[15px]">{t('voice.menu.inputVolume')}</p>
              <Slider
                aria-label={t('voice.menu.inputVolume')}
                value={inputVolume}
                onChange={(v) => void setInputVolume(Array.isArray(v) ? v[0] : v)}
                minValue={0}
                maxValue={2}
                step={0.01}
                className="thin-slider w-full"
              >
                <Slider.Track>
                  <Slider.Fill />
                  <Slider.Thumb />
                </Slider.Track>
              </Slider>
            </div>
            <div className="px-3 py-2">
              <p className="text-[15px]">{t('voice.menu.inputLevel')}</p>
              <div className="mt-2 flex h-5 items-center justify-between" aria-hidden="true">
                {Array.from({ length: SEGMENTS }, (_, i) => (
                  <span key={i} className={`h-full w-[3px] rounded-full ${i < lit ? 'bg-foreground' : 'bg-white/20'}`} />
                ))}
              </div>
            </div>
            <div className="px-3 py-1">
              <p className="text-[15px]">{t('voice.menu.outputVolume')}</p>
              <Slider
                aria-label={t('voice.menu.outputVolume')}
                value={output}
                onChange={(v) => {
                  const next = Array.isArray(v) ? v[0] : v;
                  setOutput(next);
                  setOutputVolume(next);
                }}
                minValue={0}
                maxValue={2}
                step={0.01}
                className="thin-slider w-full"
              >
                <Slider.Track>
                  <Slider.Fill />
                  <Slider.Thumb />
                </Slider.Track>
              </Slider>
            </div>
            <div role="separator" className="mx-3 my-2 h-px bg-separator" />
            <button
              type="button"
              aria-pressed={deafened}
              onClick={() => void toggleDeafen()}
              className="flex w-full items-center gap-2 rounded-row px-3 py-2.5 text-left text-[15px] outline-none transition-colors hover:bg-default focus-visible:ring-2 focus-visible:ring-focus"
            >
              <span className="min-w-0 flex-1">{t('voice.menu.deafen')}</span>
              <span className="grid size-5 shrink-0 place-items-center rounded-md border border-white/25">{deafened && <CheckIcon size={14} />}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setSettings(true);
              }}
              className="flex w-full items-center gap-3 rounded-row px-3 py-2.5 text-left text-[15px] outline-none transition-colors hover:bg-default focus-visible:ring-2 focus-visible:ring-focus"
            >
              <Cog6ToothIcon className="size-5 shrink-0 text-muted" aria-hidden="true" />
              {t('voice.controls.settings')}
            </button>
          </Popover.Dialog>
        </Popover.Content>
      </Popover>
      {settings && <SettingsDialog start="voice" onClose={() => setSettings(false)} />}
    </>
  );
}
