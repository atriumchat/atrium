import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Label, ListBox, Select } from '@heroui/react';
import { ChevronDownIcon } from '@heroicons/react/24/solid';
import { filled, rulerTicks, scale } from '@atrium/ui-common';
import { useT, type Key } from '../i18n';
import { useStore } from '../store';
import { Primary, Row, Secondary } from '../ui/settings';
import { getPreferredDevice, listDevices, setPreferredDevice, type AudioDeviceKind } from './devices';
import { MicTestFailure, runMicTest, supportsMicTest, supportsOutputSelection, type MicTestError } from './micTest';

const ERROR: Record<MicTestError, Key> = {
  unsupported: 'voice.micTest.unsupported',
  denied: 'voice.micTest.denied',
  missing: 'voice.micTest.missing',
  capture: 'voice.micTest.captureError',
  output: 'voice.micTest.outputError',
  play: 'voice.micTest.playError',
};

type DeviceLists = Record<AudioDeviceKind, MediaDeviceInfo[]>;
type Phase = 'idle' | 'requesting' | 'running';

type MediaDevicesWithOutput = MediaDevices & { selectAudioOutput?: () => Promise<MediaDeviceInfo> };

export function VoiceDevices() {
  const { t } = useT();
  const callActive = useStore((s) => s.voiceStatus !== 'idle');
  const [input, setInput] = useState(() => getPreferredDevice('audioinput') ?? 'default');
  const [output, setOutput] = useState(() => getPreferredDevice('audiooutput') ?? 'default');
  const [devices, setDevices] = useState<DeviceLists>({ audioinput: [], audiooutput: [] });
  const [phase, setPhase] = useState<Phase>('idle');
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<MicTestError | null>(null);
  const [choosingOutput, setChoosingOutput] = useState(false);
  const operation = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  const enumeration = useRef(0);
  const media = navigator.mediaDevices as MediaDevicesWithOutput | undefined;
  const canSelectOutput = supportsOutputSelection();
  const canTest = supportsMicTest();

  const refreshDevices = useCallback(async () => {
    const request = ++enumeration.current;
    const [microphones, speakers] = await Promise.all([listDevices('audioinput', false), listDevices('audiooutput', false)]);
    if (mounted.current && request === enumeration.current) setDevices({ audioinput: microphones, audiooutput: speakers });
  }, []);

  const cancel = useCallback(() => {
    operation.current?.abort();
    operation.current = null;
    setLevel(0);
    setError(null);
    setPhase('idle');
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refreshDevices();
    media?.addEventListener('devicechange', refreshDevices);
    // Stop synchronously when the app starts joining a call, before the call can acquire its microphone.
    const unsubscribe = useStore.subscribe((s, prev) => {
      if (s.voiceStatus !== 'idle' && prev.voiceStatus === 'idle') cancel();
    });
    const onPageHide = () => cancel();
    window.addEventListener('pagehide', onPageHide);
    return () => {
      mounted.current = false;
      operation.current?.abort();
      window.removeEventListener('pagehide', onPageHide);
      media?.removeEventListener('devicechange', refreshDevices);
      unsubscribe();
    };
  }, [cancel, media, refreshDevices]);

  const pick = (kind: AudioDeviceKind, id: string) => {
    cancel();
    if (kind === 'audioinput') setInput(id);
    else setOutput(id);
    void setPreferredDevice(kind, id);
  };

  const chooseOutput = async () => {
    if (!media?.selectAudioOutput) return;
    cancel();
    setChoosingOutput(true);
    try {
      const picked = await media.selectAudioOutput();
      if (mounted.current) {
        setDevices((current) => ({ ...current, audiooutput: [...current.audiooutput.filter((device) => device.deviceId !== picked.deviceId), picked] }));
        pick('audiooutput', picked.deviceId);
      }
    } catch {
      if (mounted.current) setError('output');
    } finally {
      if (mounted.current) setChoosingOutput(false);
    }
  };

  const start = async () => {
    if (useStore.getState().voiceStatus !== 'idle' || operation.current) return;
    const controller = new AbortController();
    operation.current = controller;
    setError(null);
    setPhase('requesting');
    try {
      await runMicTest({
        inputId: input,
        outputId: canSelectOutput ? output : 'default',
        signal: controller.signal,
        onStarted: () => {
          setPhase('running');
          void refreshDevices();
        },
        onLevel: setLevel,
      });
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(err instanceof MicTestFailure ? err.reason : 'capture');
      setLevel(0);
      setPhase('idle');
    } finally {
      if (operation.current === controller) operation.current = null;
    }
  };

  const button: Record<Phase, Key> = {
    idle: 'voice.micTest.start',
    requesting: 'voice.settings.cancel',
    running: 'voice.micTest.stop',
  };
  const messages: Record<Phase, Key> = {
    idle: 'voice.micTest.hint',
    requesting: 'voice.micTest.requesting',
    running: 'voice.micTest.running',
  };
  const status = error ? ERROR[error] : callActive ? 'voice.micTest.activeCall' : canTest ? messages[phase] : ERROR.unsupported;

  return (
    <>
      <DeviceRow
        title={t('voice.devices.input')}
        current={input}
        devices={devices.audioinput}
        onChange={(id) => pick('audioinput', id)}
      />
      <DeviceRow
        title={t('voice.devices.output')}
        current={canSelectOutput ? output : 'default'}
        devices={devices.audiooutput}
        onChange={(id) => pick('audiooutput', id)}
        disabled={!canSelectOutput || choosingOutput}
        hint={canSelectOutput ? undefined : t('voice.devices.systemOutput')}
      />
      {canSelectOutput && media?.selectAudioOutput && (
        <Row title={t('voice.devices.grant')}>
          <Secondary onPress={chooseOutput} isPending={choosingOutput}>{t('voice.devices.choose')}</Secondary>
        </Row>
      )}
      <div className="border-b border-white/[0.07] py-3 max-md:px-4">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <span className="min-w-24 flex-1 text-[14px] font-medium max-md:text-[16px]">{t('voice.micTest.title')}</span>
          <Primary onPress={phase === 'idle' ? start : cancel} isDisabled={callActive || !canTest || choosingOutput}>
            {t(button[phase])}
          </Primary>
        </div>
        <LevelRuler level={level} label={t('voice.micTest.title')} />
        <p role="status" className={`mt-1 text-[13px] ${error ? 'text-danger' : 'text-muted'}`}>{t(status)}</p>
      </div>
    </>
  );
}

function LevelRuler({ level, label }: { level: number; label: string }) {
  const ruler = useRef<SVGSVGElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = ruler.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const ticks = useMemo(() => rulerTicks(Math.max(0, width - scale.stroke * 2)), [width]);
  const active = filled(level / 100, ticks.length);
  return (
    <div className="my-2 rounded-row border border-white/[0.07] bg-white/[0.03] px-3 py-2.5" role="meter"
      aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={level}>
      <svg ref={ruler} width="100%" height={scale.rulerHeight} className="block" aria-hidden="true"
        strokeWidth={scale.stroke} strokeLinecap="round">
        {ticks.map((tick, i) => (
          <line key={i} {...tick} y1={tick.y1 + scale.stroke / 2} y2={tick.y2 - scale.stroke / 2}
            stroke={i < active ? 'var(--gx-tick-on)' : 'var(--gx-tick)'} />
        ))}
      </svg>
    </div>
  );
}

function DeviceRow({ title, current, devices, hint, disabled, onChange }: {
  title: string;
  current: string;
  devices: MediaDeviceInfo[];
  hint?: string;
  disabled?: boolean;
  onChange: (deviceId: string) => void;
}) {
  const { t } = useT();
  const options = [
    { id: 'default', label: t('voice.devices.system') },
    ...devices.filter((device) => device.deviceId && device.deviceId !== 'default').map((device, index) => ({
      id: device.deviceId,
      label: device.label || t('voice.devices.number', { number: index + 1 }),
    })),
  ];
  if (!options.some((option) => option.id === current)) {
    options.push({ id: current, label: t('voice.devices.unavailable') });
  }

  return (
    <Row title={title} value={hint}>
      <Select
        aria-label={title}
        className="w-[52%] min-w-0 max-w-72 shrink-0"
        isDisabled={disabled}
        value={current}
        variant="secondary"
        onChange={(key) => {
          if (typeof key === 'string' && key !== current) onChange(key);
        }}
      >
        <Select.Trigger className="flex h-10 w-full min-w-0 items-center gap-2 rounded-row border border-white/[0.07] px-(--app-radius-row)">
          <Select.Value className="min-w-0 truncate" />
          <ChevronDownIcon className="size-4 shrink-0 text-muted" aria-hidden="true" />
        </Select.Trigger>
        <Select.Popover className="max-w-[min(24rem,90vw)]">
          <ListBox items={options} className="gap-0.5 p-2">
            {({ id, label }) => (
              <ListBox.Item id={id} textValue={label} className="min-h-9 rounded-surface px-3 py-2">
                <Label className="min-w-0 flex-1 wrap-anywhere">{label}</Label>
                <ListBox.ItemIndicator />
              </ListBox.Item>
            )}
          </ListBox>
        </Select.Popover>
      </Select>
    </Row>
  );
}
