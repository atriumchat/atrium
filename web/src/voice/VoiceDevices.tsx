import { useCallback, useEffect, useRef, useState } from 'react';
import { Label, ListBox, Select } from '@heroui/react';
import { ChevronDownIcon } from '@heroicons/react/24/solid';
import { useT, type Key } from '../i18n';
import { useStore } from '../store';
import { Primary, Row, Secondary, fieldLabel } from '../ui/settings';
import { getPreferredDevice, listDevices, setPreferredDevice, type AudioDeviceKind } from './devices';
import { MicTestFailure, runMicTest, supportsMicTest, supportsOutputSelection, type MicTestError } from './micTest';

const ERROR: Record<MicTestError, Key> = {
  unsupported: 'voice.micTest.unsupported',
  denied: 'voice.micTest.denied',
  missing: 'voice.micTest.missing',
  capture: 'voice.micTest.captureError',
  output: 'voice.micTest.outputError',
  play: 'voice.micTest.playError',
  noise: 'voice.micTest.noiseError',
};

type DeviceLists = Record<AudioDeviceKind, MediaDeviceInfo[]>;
type Phase = 'idle' | 'requesting' | 'running';

type MediaDevicesWithOutput = MediaDevices & { selectAudioOutput?: () => Promise<MediaDeviceInfo> };

export function VoiceDevices() {
  const { t } = useT();
  const callActive = useStore((s) => s.voiceStatus !== 'idle');
  const noise = useStore((s) => s.voicePrefs.noise);
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
      operation.current = null;
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
        noise,
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

  // Switching the noise mode while the test runs restarts it, so the difference is heard, not remembered.
  const startRef = useRef(start);
  useEffect(() => {
    startRef.current = start;
  });
  const noiseRef = useRef(noise);
  useEffect(() => {
    if (noiseRef.current === noise) return;
    noiseRef.current = noise;
    const restart = Boolean(operation.current);
    cancel();
    if (!restart) return;
    void startRef.current();
  }, [noise, cancel]);

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
  const status = callActive ? 'voice.micTest.activeCall' : error ? ERROR[error] : canTest ? messages[phase] : ERROR.unsupported;

  return (
    <>
      <div className="grid grid-cols-1 gap-3 border-b border-white/[0.07] py-3 max-md:px-4 md:grid-cols-2 md:gap-4">
        <DeviceSelect
          title={t('voice.devices.input')}
          current={input}
          devices={devices.audioinput}
          onChange={(id) => pick('audioinput', id)}
        />
        <DeviceSelect
          title={t('voice.devices.output')}
          current={canSelectOutput ? output : 'default'}
          devices={devices.audiooutput}
          onChange={(id) => pick('audiooutput', id)}
          disabled={!canSelectOutput || choosingOutput}
          hint={canSelectOutput ? undefined : t('voice.devices.systemOutput')}
        />
      </div>
      {canSelectOutput && media?.selectAudioOutput && (
        <Row title={t('voice.devices.grant')}>
          <Secondary onPress={chooseOutput} isPending={choosingOutput}>{t('voice.devices.choose')}</Secondary>
        </Row>
      )}
      <div className="flex flex-col gap-2 border-b border-white/[0.07] py-4 max-md:px-4">
        <h3 className="text-[15px] font-medium">{t('voice.micTest.title')}</h3>
        <div className="flex items-center gap-3">
          <Primary onPress={phase === 'idle' ? start : cancel} isDisabled={callActive || !canTest || choosingOutput}
            className="min-w-28 shrink-0 whitespace-nowrap max-md:h-10! max-md:w-auto! max-md:text-[14px]! md:rounded-full!">
            {t(button[phase])}
          </Primary>
          <LevelRuler level={level} label={t('voice.micTest.title')} />
        </div>
        <p role="status" className={`text-[13px] ${error && !callActive ? 'text-danger' : 'text-muted'}`}>{t(status)}</p>
      </div>
    </>
  );
}

const METER_SEGMENTS = 40;

function LevelRuler({ level, label }: { level: number; label: string }) {
  const active = Math.round(level / 100 * METER_SEGMENTS);
  return (
    <div role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={level}
      className="grid min-w-0 flex-1 grid-cols-[repeat(40,minmax(0,1fr))] gap-px md:gap-0.5">
      {Array.from({ length: METER_SEGMENTS }, (_, i) => (
        <span key={i} aria-hidden="true" className={`h-4 rounded-full ${i < active ? 'bg-[#ededef]' : 'bg-white/[0.11]'}`} />
      ))}
    </div>
  );
}

function DeviceSelect({ title, current, devices, hint, disabled, onChange }: {
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
    <div className="min-w-0">
      <span className={fieldLabel}>{title}</span>
      <Select
        aria-label={title}
        className="w-full min-w-0"
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
      {hint && <p className="mt-1 text-[13px] text-muted">{hint}</p>}
    </div>
  );
}
