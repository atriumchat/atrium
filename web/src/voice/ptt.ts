import { useStore } from '../store';
import { desktop } from '../desktop';
import { applyMic } from './voice';

/** Push-to-talk: the key (or mouse button) that keys the mic, in the page and, in the desktop app, system-wide. */

const set = useStore.setState;
const get = useStore.getState;

const TYPING_KEY = /^(Key\w|Digit\d|Space|Backquote|Minus|Equal|Bracket\w+|Backslash|Semicolon|Quote|Comma|Period|Slash)$/;

function editing(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  return !!el && (el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT');
}

function setPtt(down: boolean) {
  if (get().pttDown === down) return;
  set({ pttDown: down });
  void applyMic();
}

// What the desktop app's key hook listens for. Undefined until the first sync, which also stops a hook left
// running by the page before a reload.
let watchedKey: string | null | undefined;

/** The desktop hook is system-wide, so it's on only while in a call with push-to-talk on. */
function syncPttWatch() {
  const { voicePrefs, voiceStatus } = get();
  const key = voicePrefs.ptt && voiceStatus === 'connected' ? voicePrefs.pttKey : null;
  if (key === watchedKey) return;
  watchedKey = key;
  desktop?.ptt?.watch(key);
}

function onPttEvent(code: string, down: boolean, target: EventTarget | null) {
  const { voicePrefs, voiceStatus } = get();
  if (!voicePrefs.ptt || voiceStatus !== 'connected' || code !== voicePrefs.pttKey) return;
  // Typing a message shouldn't key the mic; keys that don't type anything (F13, mouse buttons) always work.
  if (down && TYPING_KEY.test(code) && editing(target)) return;
  setPtt(down);
}

if (typeof window !== 'undefined') {
  window.addEventListener('keydown', (e) => !e.repeat && onPttEvent(e.code, true, e.target));
  window.addEventListener('keyup', (e) => onPttEvent(e.code, false, e.target));
  const mouse = (e: MouseEvent) => (e.button === 3 ? 'Mouse4' : e.button === 4 ? 'Mouse5' : '');
  window.addEventListener('mousedown', (e) => mouse(e) && onPttEvent(mouse(e), true, null));
  window.addEventListener('mouseup', (e) => mouse(e) && onPttEvent(mouse(e), false, null));
  // Let go of the key outside the window: it never sends keyup here.
  window.addEventListener('blur', () => !desktop?.ptt && setPtt(false));
  // The desktop app hears the key anywhere, even with the window in the background.
  desktop?.ptt?.onChange((down) => onPttEvent(get().voicePrefs.pttKey, down, document.hasFocus() ? document.activeElement : null));
  if (desktop?.ptt) {
    syncPttWatch();
    useStore.subscribe(syncPttWatch);
  }
}
