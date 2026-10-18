import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { setVoicePrefs } from './voice';
import { keyLabel, type NoiseMode } from '../prefs';
import { desktop } from '../desktop';
import { BypassSwitch } from './Bypass';
import { ConnectionCheck } from './ConnectionCheck';
import { ChoiceRow, Row, RowFrame, Rows, Secondary } from '../ui/settings';

/** The "Голос" page of the settings, for this device: noise suppression, push-to-talk, the bypass, a check. */
export function VoiceSettings() {
  const prefs = useStore((s) => s.voicePrefs);
  const isMobile = useStore((s) => s.isMobile);

  return (
    <Rows title="Голос" className="mt-6">
      <ChoiceRow<NoiseMode>
        title="Шумоподавление"
        value={prefs.noise}
        onChange={(noise) => setVoicePrefs({ noise })}
        options={[
          ['off', 'Выкл', 'Звук как есть'],
          ['browser', 'Обычное', 'Убирает ровный шум'],
          ['rnnoise', 'Сильное', 'Убирает клавиатуру и улицу'],
        ]}
      />
      {/* In the browser the key only works while Gomex's window is open; the desktop app hears it from anywhere. */}
      <ChoiceRow<'voice' | 'ptt'>
        title="Микрофон"
        value={prefs.ptt ? 'ptt' : 'voice'}
        onChange={(mode) => setVoicePrefs({ ptt: mode === 'ptt' })}
        options={[
          // Every choice says something under the row, so switching doesn't make the page jump.
          ['voice', 'Всегда включён', 'Слышно всё время'],
          [
            'ptt',
            'По клавише',
            // On the computer the key itself sits under the row, so no row of its own drops in when it's chosen.
            isMobile || !prefs.ptt ? (
              desktop?.ptt ? 'Работает и в фоне' : 'Пока окно открыто'
            ) : (
              <KeyHint value={prefs.pttKey} onChange={(pttKey) => setVoicePrefs({ pttKey })} />
            ),
          ],
        ]}
      />
      {isMobile && prefs.ptt && <KeyRow value={prefs.pttKey} onChange={(pttKey) => setVoicePrefs({ pttKey })} />}
      <RowFrame>
        <BypassSwitch />
      </RowFrame>
      <CheckRow />
    </Rows>
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

/** The key under the "Микрофон" row on the computer: the cap, then «Сменить» (and where it works, in the browser). */
function KeyHint({ value, onChange }: { value: string; onChange: (code: string) => void }) {
  const [listening, setListening] = useKeyCatch(onChange);
  if (listening) {
    return (
      <span>
        Клавиша или кнопка мыши…{' '}
        <button type="button" onClick={() => setListening(false)} className="text-foreground hover:underline">
          Отмена
        </button>
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1.5">
      <kbd className={KEY_CAP}>{keyLabel(value)}</kbd>
      <span>·</span>
      <button type="button" onClick={() => setListening(true)} className="text-foreground hover:underline">
        Сменить
      </button>
      {!desktop?.ptt && <span>· пока окно открыто</span>}
    </span>
  );
}

/** The push-to-talk key as a row of its own, on the phone. */
function KeyRow({ value, onChange }: { value: string; onChange: (code: string) => void }) {
  const [listening, setListening] = useKeyCatch(onChange);
  return (
    <Row
      title="Клавиша"
      value={
        listening ? (
          'Клавиша или кнопка мыши…'
        ) : (
          <kbd className={KEY_CAP}>{keyLabel(value)}</kbd>
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
