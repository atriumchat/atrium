import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Label, Slider, Switch } from '@heroui/react';
import { watchMic } from './micLevel';
import { useStore } from '../store';
import { setInputVolume, setVoicePrefs } from './voice';
import { DEFAULT_PREFS, keyLabel, type NoiseMode, type VoicePrefs } from '../prefs';
import { getOutputVolume, setOutputVolume } from './devices';
import { setSoundboard } from './soundboard';
import { desktop } from '../desktop';
import { BypassSwitch } from './Bypass';
import { ConnectionCheck } from './ConnectionCheck';
import { VoiceDevices } from './VoiceDevices';
import { ChoiceRow, Row, RowFrame, Rows, Secondary } from '../ui/settings';
import { useT } from '../i18n';
import { STRONG_ENABLED } from './suppressor';

/** The "Voice" page of the settings, for this device: noise suppression, push-to-talk, the bypass, a check. */
export function VoiceSettings() {
  const { t } = useT();
  const prefs = useStore((s) => s.voicePrefs);
  const isMobile = useStore((s) => s.isMobile);

  const custom = (
    <>
      <SensitivityRow />
      <NoiseRow />
      {/* In the browser the key only works while Atrium's window is open; the desktop app hears it from anywhere. */}
      <ChoiceRow<'voice' | 'ptt'>
        title={t('voice.settings.mic')}
        value={prefs.ptt ? 'ptt' : 'voice'}
        onChange={(mode) => setVoicePrefs({ ptt: mode === 'ptt' })}
        options={[
          // Every choice says something under the row, so switching doesn't make the page jump.
          ['voice', t('voice.settings.micAlways'), t('voice.settings.micAlwaysHint')],
          [
            'ptt',
            t('voice.settings.ptt'),
            // On the computer the key itself sits under the row, so no row of its own drops in when it's chosen.
            isMobile || !prefs.ptt ? (
              desktop?.ptt ? t('voice.settings.pttBackground') : t('voice.settings.pttWindow')
            ) : (
              <KeyHint value={prefs.pttKey} onChange={(pttKey) => setVoicePrefs({ pttKey })} />
            ),
          ],
        ]}
      />
      {isMobile && prefs.ptt && <KeyRow value={prefs.pttKey} onChange={(pttKey) => setVoicePrefs({ pttKey })} />}
    </>
  );

  return (
    <Rows title={t('voice.settings.title')} className="mt-6">
      <VoiceDevices />
      <SpeakerVolume />
      <ProfileRows>{custom}</ProfileRows>
      <PageHeading>{t('voice.soundboard.label')}</PageHeading>
      <SoundboardVolume />
      <PageHeading>{t('voice.settings.advanced')}</PageHeading>
      <RowFrame>
        <BypassSwitch />
      </RowFrame>
      <CheckRow />
      <ResetRow />
    </Rows>
  );
}

function PageHeading({ children }: { children: ReactNode }) {
  return <h3 className="pb-2 pt-8 text-[22px] font-light tracking-[-0.3px] max-md:hidden">{children}</h3>;
}

/** The two volumes of the call, side by side: how much your microphone is amplified, and how loud everything you hear is. */
function SpeakerVolume() {
  const { t } = useT();
  const [volume, setVolume] = useState(getOutputVolume);
  const input = useStore((s) => s.voicePrefs.inputVolume ?? 1);
  return (
    <div className="grid grid-cols-1 gap-4 border-b border-white/[0.07] py-4 max-md:px-4 md:grid-cols-2 md:gap-6">
      <Slider
        aria-label={t('voice.menu.inputVolume')}
        value={input}
        onChange={(v) => void setInputVolume(Array.isArray(v) ? v[0] : v)}
        minValue={0}
        maxValue={2}
        step={0.01}
        formatOptions={{ style: 'percent' }}
        className="thin-slider w-full"
      >
        <div className="flex items-baseline justify-between">
          <Label className="text-[15px] font-medium">{t('voice.menu.inputVolume')}</Label>
          <Slider.Output className="text-[13px] text-muted" />
        </div>
        <Slider.Track>
          <Slider.Fill />
          <Slider.Thumb />
        </Slider.Track>
      </Slider>
      <Slider
        aria-label={t('voice.menu.outputVolume')}
        value={volume}
        onChange={(v) => {
          const next = Array.isArray(v) ? v[0] : v;
          setVolume(next);
          setOutputVolume(next);
        }}
        minValue={0}
        maxValue={2}
        step={0.01}
        formatOptions={{ style: 'percent' }}
        className="thin-slider w-full"
      >
        <div className="flex items-baseline justify-between">
          <Label className="text-[15px] font-medium">{t('voice.menu.outputVolume')}</Label>
          <Slider.Output className="text-[13px] text-muted" />
        </div>
        <Slider.Track>
          <Slider.Fill />
          <Slider.Thumb />
        </Slider.Track>
      </Slider>
    </div>
  );
}

function SoundboardVolume() {
  const { t } = useT();
  const volume = useStore((s) => s.soundboard.volume);
  return (
    <div className="flex flex-col gap-2 border-b border-white/[0.07] py-4 max-md:px-4">
      <Slider
        aria-label={t('voice.soundboard.volume')}
        value={volume}
        onChange={(v) => setSoundboard({ volume: Array.isArray(v) ? v[0] : v })}
        minValue={0}
        maxValue={1}
        step={0.01}
        formatOptions={{ style: 'percent' }}
        className="thin-slider w-full"
      >
        <div className="flex items-baseline justify-between">
          <Label className="text-[15px] font-medium">{t('voice.soundboard.volume')}</Label>
          <Slider.Output className="text-[13px] text-muted" />
        </div>
        <Slider.Track>
          <Slider.Fill />
          <Slider.Thumb />
        </Slider.Track>
      </Slider>
    </div>
  );
}

type Profile = 'isolation' | 'studio' | 'custom';

const profileOf = (p: VoicePrefs): Profile =>
  p.noise === 'rnnoise' && p.autoSensitivity ? 'isolation' : p.noise === 'off' && !p.autoSensitivity && p.sensitivity <= -100 && !p.ptt ? 'studio' : 'custom';

/**
 * Discord's "Input profile": voice isolation (strong suppression, automatic sensitivity), studio (nothing touches the
 * microphone) and custom, which shows the knobs: sensitivity, noise suppression and how the microphone opens.
 */
function ProfileRows({ children }: { children: ReactNode }) {
  const { t } = useT();
  const [profile, setProfile] = useState(() => profileOf(useStore.getState().voicePrefs));
  const options: [Profile, string, string][] = [
    ['isolation', t('voice.profile.isolation'), t('voice.profile.isolationHint')],
    ['studio', t('voice.profile.studio'), t('voice.profile.studioHint')],
    ['custom', t('voice.profile.custom'), t('voice.profile.customHint')],
  ];
  const choose = (next: Profile) => {
    setProfile(next);
    const { noise } = useStore.getState().voicePrefs;
    if (next === 'isolation') void setVoicePrefs({ noise: 'rnnoise', autoSensitivity: true, ptt: false });
    else if (next === 'studio') void setVoicePrefs({ noise: 'off', autoSensitivity: false, sensitivity: -100, inputVolume: 1, ptt: false });
    else void setVoicePrefs({ noise: noise === 'off' || noise === 'rnnoise' ? 'browser' : noise, autoSensitivity: false });
  };
  return (
    <>
      <PageHeading>{t('voice.profile.title')}</PageHeading>
      <div role="radiogroup" aria-label={t('voice.profile.title')} className="flex flex-col gap-1 border-b border-white/[0.07] pb-4 max-md:px-4">
        {options.map(([id, name, hint]) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={profile === id}
            onClick={() => choose(id)}
            className="flex items-start gap-3 rounded-row py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-focus"
          >
            <span className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border ${profile === id ? 'border-foreground' : 'border-white/25'}`}>
              {profile === id && <span className="size-2.5 rounded-full bg-foreground" />}
            </span>
            <span className="min-w-0">
              <span className="block text-[15px]">{name}</span>
              <span className="block text-[13px] text-muted">{hint}</span>
            </span>
          </button>
        ))}
      </div>
      {profile === 'custom' && children}
    </>
  );
}

function ResetRow() {
  const { t } = useT();
  return (
    <Row title={t('voice.settings.reset')}>
      <Secondary
        onPress={() => {
          void setVoicePrefs({ ...DEFAULT_PREFS });
          setOutputVolume(1);
        }}
        className="text-danger"
      >
        {t('voice.settings.resetAction')}
      </Secondary>
    </Row>
  );
}

/**
 * The phone's "Calls" group on the "You" tab: what's touched when friends hear noise or the call stutters. No
 * push-to-talk there: without a keyboard it's a computer's setting.
 */
export function CallsGroup({ className = '' }: { className?: string }) {
  const { t } = useT();
  return (
    <Rows title={t('voice.settings.calls')} className={className}>
      <VoiceDevices />
      <NoiseRow />
      <SensitivityRow />
      <RowFrame>
        <BypassSwitch />
      </RowFrame>
      <CheckRow />
    </Rows>
  );
}

/**
 * How loud you have to be to be heard in the call, as in Discord: one bar that is both the meter and the control. Left
 * of the threshold dim, right of it brighter, your voice filling it live; the handle sets the threshold, a bubble over
 * it says how many dB. The switch lets the app follow the room's noise itself, and then there is only the meter.
 */
function SensitivityRow() {
  const { t } = useT();
  const auto = useStore((s) => s.voicePrefs.autoSensitivity);
  const threshold = useStore((s) => s.voicePrefs.sensitivity);
  const [db, setDb] = useState(-100);
  const [dragging, setDragging] = useState(false);
  const bar = useRef<HTMLDivElement>(null);
  useEffect(() => watchMic(setDb), []);
  const level = Math.max(0, Math.min(100, db + 100));
  const at = Math.max(0, Math.min(100, threshold + 100));

  const move = (clientX: number) => {
    const box = bar.current?.getBoundingClientRect();
    if (!box) return;
    const value = Math.round(Math.max(0, Math.min(1, (clientX - box.left) / box.width)) * 100) - 100;
    if (value !== threshold) void setVoicePrefs({ sensitivity: value });
  };

  return (
    <RowFrame>
      <div className="flex w-full flex-col gap-4">
        <Switch className="w-full" isSelected={auto} onChange={(value) => void setVoicePrefs({ autoSensitivity: value })}>
          <Switch.Content className="flex w-full items-center justify-between gap-3">
            <Label className="text-[14px] font-medium max-md:text-[16px] max-md:font-normal">{t('voice.sens.title')}</Label>
            <Switch.Control className="shrink-0 [--switch-control-bg:rgb(255_255_255/0.16)]">
              <Switch.Thumb />
            </Switch.Control>
          </Switch.Content>
        </Switch>
        <div
          ref={bar}
          role={auto ? undefined : 'slider'}
          tabIndex={auto ? undefined : 0}
          aria-label={t('voice.sens.title')}
          aria-valuemin={-100}
          aria-valuemax={0}
          aria-valuenow={threshold}
          aria-valuetext={t('voice.sens.db', { n: threshold })}
          className={`relative h-2 w-full touch-none rounded-full outline-none focus-visible:ring-2 focus-visible:ring-focus ${auto ? '' : 'cursor-pointer'}`}
          onPointerDown={(event) => {
            if (auto) return;
            event.currentTarget.setPointerCapture(event.pointerId);
            setDragging(true);
            move(event.clientX);
          }}
          onPointerMove={(event) => dragging && move(event.clientX)}
          onPointerUp={() => setDragging(false)}
          onPointerCancel={() => setDragging(false)}
          onKeyDown={(event) => {
            const step = event.shiftKey ? 5 : 1;
            if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') void setVoicePrefs({ sensitivity: Math.max(-100, threshold - step) });
            else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') void setVoicePrefs({ sensitivity: Math.min(0, threshold + step) });
            else return;
            event.preventDefault();
          }}
        >
          <div className="absolute inset-0 overflow-hidden rounded-full bg-white/10">
            {!auto && <div className="absolute inset-y-0 right-0 bg-white/20" style={{ left: `${at}%` }} />}
            <div className="absolute inset-y-0 left-0 bg-white/50" style={{ width: `${auto ? 0 : Math.min(level, at)}%` }} />
            <div
              className="absolute inset-y-0 bg-foreground"
              style={auto ? { left: 0, width: `${level}%` } : { left: `${at}%`, width: `${Math.max(0, level - at)}%` }}
            />
          </div>
          {!auto && (
            <span className="absolute top-1/2 size-5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground shadow-md" style={{ left: `${at}%` }}>
              {dragging && (
                <span className="pointer-events-none absolute bottom-full left-1/2 mb-2 -translate-x-1/2 whitespace-nowrap rounded-row bg-surface-tertiary px-2.5 py-1 text-[13px] font-medium">
                  {t('voice.sens.db', { n: threshold })}
                </span>
              )}
            </span>
          )}
        </div>
      </div>
    </RowFrame>
  );
}

function NoiseRow() {
  const { t } = useT();
  const noise = useStore((s) => s.voicePrefs.noise);
  const failed = useStore((s) => s.noiseState === 'fallback');
  const options: [NoiseMode, string, ReactNode?][] = [
    ['off', t('voice.noise.off'), t('voice.noise.offHint')],
    ['browser', t('voice.noise.browser'), t('voice.noise.browserHint')],
    ...(STRONG_ENABLED
      ? [[
          'rnnoise',
          t('voice.noise.rnnoise'),
          failed && noise === 'rnnoise' ? <span className="text-danger">{t('voice.noise.failed')}</span> : t('voice.noise.rnnoiseHint'),
        ] as [NoiseMode, string, ReactNode]]
      : []),
  ];
  return (
    <ChoiceRow<NoiseMode>
      title={t('voice.noise.title')}
      value={noise === 'rnnoise' && !STRONG_ENABLED ? 'browser' : noise}
      onChange={(value) => setVoicePrefs({ noise: value })}
      options={options}
    />
  );
}

/** Waits for the next key or side mouse button while `listening`; Escape cancels. */
function useKeyCatch(onChange: (code: string) => void) {
  const [listening, setListening] = useState(false);

  useEffect(() => {
    if (!listening) return;
    const key = (e: KeyboardEvent) => {
      e.preventDefault();
      setListening(false);
      if (e.code !== 'Escape') onChange(e.code);
    };
    const mouse = (e: MouseEvent) => {
      if (e.button !== 3 && e.button !== 4) return;
      e.preventDefault();
      setListening(false);
      onChange(e.button === 3 ? 'Mouse4' : 'Mouse5');
    };
    window.addEventListener('keydown', key, true);
    window.addEventListener('mousedown', mouse, true);
    return () => {
      window.removeEventListener('keydown', key, true);
      window.removeEventListener('mousedown', mouse, true);
    };
  }, [listening, onChange]);
  return [listening, setListening] as const;
}

// A key cap, so a short label like ` still reads as a key.
const KEY_CAP = 'inline-block min-w-5 rounded-[6px] border border-white/[0.12] px-1.5 text-center font-mono text-[12px] leading-[18px] text-foreground';

/** The key under the "Microphone" row on the computer: the cap, then "Change" (and where it works, in the browser). */
function KeyHint({ value, onChange }: { value: string; onChange: (code: string) => void }) {
  const { t } = useT();
  const [listening, setListening] = useKeyCatch(onChange);
  if (listening) {
    return (
      <span>
        {t('voice.settings.keyPrompt')}{' '}
        <button type="button" onClick={() => setListening(false)} className="text-foreground hover:underline">
          {t('voice.settings.cancel')}
        </button>
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1.5">
      <kbd className={KEY_CAP}>{keyLabel(value)}</kbd>
      <span>·</span>
      <button type="button" onClick={() => setListening(true)} className="text-foreground hover:underline">
        {t('voice.settings.change')}
      </button>
      {!desktop?.ptt && <span>{t('voice.settings.pttWindowInline')}</span>}
    </span>
  );
}

/** The push-to-talk key as a row of its own, on the phone. */
function KeyRow({ value, onChange }: { value: string; onChange: (code: string) => void }) {
  const { t } = useT();
  const [listening, setListening] = useKeyCatch(onChange);
  return (
    <Row
      title={t('voice.settings.key')}
      value={
        listening ? (
          t('voice.settings.keyPrompt')
        ) : (
          <kbd className={KEY_CAP}>{keyLabel(value)}</kbd>
        )
      }
    >
      <Secondary onPress={() => setListening((v) => !v)}>{listening ? t('voice.settings.cancel') : t('voice.settings.change')}</Secondary>
    </Row>
  );
}

/** Calls tried from here on demand: the two tries show up as rows of their own under this one. */
function CheckRow() {
  const { t } = useT();
  const [run, setRun] = useState(0);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <Row title={t('voice.settings.check')}>
        <Secondary
          isPending={busy}
          onPress={() => {
            setRun((n) => n + 1);
            setBusy(true);
          }}
        >
          {run ? t('voice.settings.checkAgain') : t('voice.settings.checkRun')}
        </Secondary>
      </Row>
      {run > 0 && <ConnectionCheck key={run} onDone={() => setBusy(false)} />}
    </>
  );
}
