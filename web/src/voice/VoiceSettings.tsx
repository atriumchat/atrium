import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { setVoicePrefs } from './voice';
import { keyLabel, type NoiseMode } from '../prefs';
import { desktop } from '../desktop';
import { BypassSwitch } from './Bypass';
import { ConnectionCheck } from './ConnectionCheck';
import { ChoiceRow, Row, RowFrame, Rows, Secondary } from '../ui/settings';
import { useT } from '../i18n';

/** The "Voice" page of the settings, for this device: noise suppression, push-to-talk, the bypass, a check. */
export function VoiceSettings() {
  const { t } = useT();
  const prefs = useStore((s) => s.voicePrefs);
  const isMobile = useStore((s) => s.isMobile);

  return (
    <Rows title={t('voice.settings.title')} className="mt-6">
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
      <RowFrame>
        <BypassSwitch />
      </RowFrame>
      <CheckRow />
    </Rows>
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
      <NoiseRow />
      <RowFrame>
        <BypassSwitch />
      </RowFrame>
      <CheckRow />
    </Rows>
  );
}

function NoiseRow() {
  const { t } = useT();
  const noise = useStore((s) => s.voicePrefs.noise);
  return (
    <ChoiceRow<NoiseMode>
      title={t('voice.noise.title')}
      value={noise}
      onChange={(value) => setVoicePrefs({ noise: value })}
      options={[
        ['off', t('voice.noise.off'), t('voice.noise.offHint')],
        ['browser', t('voice.noise.browser'), t('voice.noise.browserHint')],
        ['rnnoise', t('voice.noise.rnnoise'), t('voice.noise.rnnoiseHint')],
      ]}
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
