import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { setVoicePrefs } from './voice';
import { keyLabel, type NoiseMode } from '../prefs';
import { desktop } from '../desktop';
import { BypassSwitch } from './Bypass';
import { ConnectionCheck } from './ConnectionCheck';
import { Row, RowFrame, Rows, Secondary } from '../ui/settings';

/** The "Голос" page of the settings, for this device: noise suppression, push-to-talk, the bypass, a check. */
export function VoiceSettings() {
  const prefs = useStore((s) => s.voicePrefs);

  return (
    <Rows className="mt-6">
      <Row title="Шумоподавление" value={NOISE[prefs.noise]} wrap>
        <Segmented<NoiseMode>
          value={prefs.noise}
          onChange={(noise) => setVoicePrefs({ noise })}
          options={[
            ['off', 'Выкл'],
            ['browser', 'Обычное'],
            ['rnnoise', 'Сильное'],
          ]}
        />
      </Row>
      {/* In the browser the key only works while Gomex's window is open; the desktop app hears it from anywhere. */}
      <Row title="Микрофон" value={prefs.ptt ? (desktop?.ptt ? 'Работает и в фоне' : 'Пока окно открыто') : undefined} wrap>
        <Segmented<'voice' | 'ptt'>
          value={prefs.ptt ? 'ptt' : 'voice'}
          onChange={(mode) => setVoicePrefs({ ptt: mode === 'ptt' })}
          options={[
            ['voice', 'Всегда включён'],
            ['ptt', 'По клавише'],
          ]}
        />
      </Row>
      {prefs.ptt && <KeyRow value={prefs.pttKey} onChange={(pttKey) => setVoicePrefs({ pttKey })} />}
      <RowFrame>
        <BypassSwitch />
      </RowFrame>
      <CheckRow />
    </Rows>
  );
}

const NOISE: Record<NoiseMode, string> = {
  off: 'Звук как есть',
  browser: 'Убирает ровный шум',
  rnnoise: 'Убирает клавиатуру и улицу',
};

function Segmented<T extends string>(props: { value: T; onChange: (v: T) => void; options: [T, string][] }) {
  return (
    <div className="flex shrink-0 gap-0.5 rounded-full border border-white/[0.07] bg-white/[0.03] p-[3px] max-md:w-full">
      {props.options.map(([id, label]) => (
        <button
          key={id}
          onClick={() => props.onChange(id)}
          aria-pressed={props.value === id}
          className={`h-7 rounded-full px-3 text-[13px] transition-colors max-md:h-9 max-md:flex-1 max-md:text-[14px] ${
            props.value === id ? 'bg-white/[0.12] font-medium text-foreground' : 'text-muted hover:text-foreground'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/** The push-to-talk key: "Сменить" takes the next key or side mouse button. Escape cancels. */
function KeyRow({ value, onChange }: { value: string; onChange: (code: string) => void }) {
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

  return (
    <Row
      title="Клавиша"
      value={
        listening ? (
          'Клавиша или кнопка мыши…'
        ) : (
          // A key cap, so a short label like ` still reads as a key.
          <kbd className="inline-block min-w-5 rounded-[6px] border border-white/[0.12] px-1.5 text-center font-mono text-[12px] leading-[18px] text-foreground">{keyLabel(value)}</kbd>
        )
      }
    >
      <Secondary onPress={() => setListening((v) => !v)}>{listening ? 'Отмена' : 'Сменить'}</Secondary>
    </Row>
  );
}

/** Calls tried from here on demand: the two tries show up as rows of their own under this one. */
function CheckRow() {
  const [run, setRun] = useState(0);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <Row title="Проверка связи">
        <Secondary
          isPending={busy}
          onPress={() => {
            setRun((n) => n + 1);
            setBusy(true);
          }}
        >
          {run ? 'Ещё раз' : 'Проверить'}
        </Secondary>
      </Row>
      {run > 0 && <ConnectionCheck key={run} onDone={() => setBusy(false)} />}
    </>
  );
}
