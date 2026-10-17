import { useEffect, useState, type ReactNode } from 'react';
import { useStore } from '../store';
import { setVoicePrefs } from './voice';
import { keyLabel, type NoiseMode } from '../prefs';
import { desktop } from '../desktop';
import { BypassSwitch } from './Bypass';
import { ConnectionCheck } from './ConnectionCheck';

/** The "Голос" page of the settings, for this device: noise suppression, push-to-talk, the bypass, a check. */
export function VoiceSettings() {
  const prefs = useStore((s) => s.voicePrefs);
  const [checking, setChecking] = useState(false);

  return (
    <>
            <Section title="Шумоподавление" hint={NOISE_HINT[prefs.noise]}>
              <Segmented<NoiseMode>
                value={prefs.noise}
                onChange={(noise) => setVoicePrefs({ noise })}
                options={[
                  ['off', 'Выкл'],
                  ['browser', 'Обычное'],
                  ['rnnoise', 'Сильное'],
                ]}
              />
            </Section>

            <Section
              title="Микрофон"
              hint={
                prefs.ptt
                  ? desktop?.ptt
                    ? 'Микрофон работает, пока клавиша зажата, даже когда Gomex в фоне'
                    : 'Микрофон работает, пока клавиша зажата и окно Gomex открыто. В приложении для компьютера — и в фоне'
                  : 'Микрофон включён постоянно'
              }
            >
              <Segmented<'voice' | 'ptt'>
                value={prefs.ptt ? 'ptt' : 'voice'}
                onChange={(mode) => setVoicePrefs({ ptt: mode === 'ptt' })}
                options={[
                  ['voice', 'Всегда включён'],
                  ['ptt', 'По клавише'],
                ]}
              />
              {prefs.ptt && <KeyPicker value={prefs.pttKey} onChange={(pttKey) => setVoicePrefs({ pttKey })} />}
            </Section>

            <section className="mt-6">
              <BypassSwitch />
            </section>

            <section className="mt-6">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-[15px] font-medium">Проверка связи</h3>
                {!checking && (
                  <button onClick={() => setChecking(true)} className="h-9 rounded-full bg-white/10 px-4 text-[14px] hover:bg-white/15">
                    Проверить
                  </button>
                )}
              </div>
              {checking && (
                <div className="mt-3">
                  <ConnectionCheck />
                </div>
              )}
            </section>
    </>
  );
}

const NOISE_HINT: Record<NoiseMode, string> = {
  off: 'Звук как есть. Для хорошего микрофона в тихой комнате.',
  browser: 'Встроенное в браузер: убирает ровный шум вроде вентилятора.',
  rnnoise: 'Нейросеть RNNoise: глушит клавиатуру, улицу, детей. Чуть больше нагрузка на процессор.',
};

function Section({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  return (
    <section className="mt-6">
      <h3 className="text-[15px] font-medium">{title}</h3>
      <p className="mb-3 mt-0.5 text-[13px] leading-snug text-muted">{hint}</p>
      <div className="flex flex-col gap-2">{children}</div>
    </section>
  );
}

function Segmented<T extends string>(props: { value: T; onChange: (v: T) => void; options: [T, string][]; disabled?: boolean }) {
  return (
    <div className={`flex gap-1 rounded-full bg-surface-tertiary p-1 ${props.disabled ? 'opacity-50' : ''}`}>
      {props.options.map(([id, label]) => (
        <button
          key={id}
          disabled={props.disabled}
          onClick={() => props.onChange(id)}
          aria-pressed={props.value === id}
          className={`h-9 flex-1 rounded-full text-[14px] transition-colors ${props.value === id ? 'bg-white font-medium text-black' : 'text-muted enabled:hover:text-foreground'}`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/** "Press a key": takes the next key or side mouse button. Escape cancels. */
function KeyPicker({ value, onChange }: { value: string; onChange: (code: string) => void }) {
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
    <div className="flex items-center gap-3 rounded-full bg-surface-tertiary py-1.5 pl-4 pr-1.5">
      <span className="flex-1 text-[14px] text-muted">
        Клавиша: <span className="font-mono text-foreground">{listening ? '…' : keyLabel(value)}</span>
      </span>
      <button
        onClick={() => setListening((v) => !v)}
        className={`h-9 rounded-full px-4 text-[14px] ${listening ? 'bg-white text-black' : 'bg-white/10 hover:bg-white/15'}`}
      >
        {listening ? 'Ожидание клавиши или кнопки мыши…' : 'Сменить'}
      </button>
    </div>
  );
}
