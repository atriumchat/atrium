/** Per-device voice settings, kept in localStorage. */

export type NoiseMode = 'off' | 'browser' | 'rnnoise';

export type VoicePrefs = {
  noise: NoiseMode;
  /** Push-to-talk: the mic is live only while the key (a KeyboardEvent.code, or "Mouse4" / "Mouse5") is held. */
  ptt: boolean;
  pttKey: string;
  /** Calls only through the relay on 443. */
  relayOnly: boolean;
};

const KEY = 'gomex_voice_prefs';
export const DEFAULT_PREFS: VoicePrefs = { noise: 'browser', ptt: false, pttKey: 'Backquote', relayOnly: false };

export function loadPrefs(): VoicePrefs {
  try {
    return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function savePrefs(prefs: VoicePrefs) {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    // Not remembered; still applied for this session.
  }
}

/** How a key reads in the settings: "`", "V", "F13", "Мышь 4". */
export function keyLabel(code: string) {
  if (code === 'Mouse4') return 'Мышь 4';
  if (code === 'Mouse5') return 'Мышь 5';
  if (code === 'Backquote') return '`';
  if (code === 'Space') return 'Пробел';
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `Num ${code.slice(6)}`;
  return code.replace(/(Left|Right)$/, ' $1').replace('Control', 'Ctrl');
}
