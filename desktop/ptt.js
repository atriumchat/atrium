// Push-to-talk anywhere: a system-wide key hook (uiohook-napi, MIT) so the mic key works while you're in a game.
// The page says which key to watch (a KeyboardEvent.code, or "Mouse4"/"Mouse5"); we tell it when it goes
// down and up. Nothing else about the keyboard ever leaves this file.
const { systemPreferences } = require('electron');

let hook = null;
try {
  hook = require('uiohook-napi');
} catch {
  // Not built for this platform: push-to-talk works only while the window has focus.
}

const MODIFIERS = {
  ControlLeft: 'Ctrl',
  ControlRight: 'CtrlRight',
  AltLeft: 'Alt',
  AltRight: 'AltRight',
  ShiftLeft: 'Shift',
  ShiftRight: 'ShiftRight',
  MetaLeft: 'Meta',
  MetaRight: 'MetaRight',
};

/** uiohook's keycode for a KeyboardEvent.code, or undefined if it has none. */
function keycodeFor(code) {
  const keys = hook.UiohookKey;
  const name = MODIFIERS[code] ?? code.replace(/^Key/, '').replace(/^Digit/, '');
  return keys[name];
}

let target = null; // { keycode } or { button }
let down = false;
let listening = false;
let started = false;
let send = () => {};

function set(next) {
  if (next === down) return;
  down = next;
  send(down);
}

// The hook runs only while a key is watched (the page asks for one only during a call), so no global
// keyboard hook is alive the rest of the time.
function start() {
  if (started || !hook) return;
  const { uIOhook } = hook;
  if (!listening) {
    listening = true;
    uIOhook.on('keydown', (e) => target?.keycode === e.keycode && set(true));
    uIOhook.on('keyup', (e) => target?.keycode === e.keycode && set(false));
    uIOhook.on('mousedown', (e) => target?.button === e.button && set(true));
    uIOhook.on('mouseup', (e) => target?.button === e.button && set(false));
  }
  uIOhook.start();
  started = true;
}

function stop() {
  if (started) hook.uIOhook.stop();
  started = false;
}

module.exports = {
  available: () => !!hook,

  /** Who hears the key going down and up (the window's page). */
  onChange(callback) {
    send = callback;
  },

  /** Watch this key (KeyboardEvent.code or "Mouse4"/"Mouse5"), or stop with null. */
  watch(code) {
    set(false);
    target = null;
    if (hook && code) {
      // macOS only lets an app see keys pressed in other apps with Accessibility access; this asks once.
      if (process.platform !== 'darwin' || systemPreferences.isTrustedAccessibilityClient(true)) {
        target = code === 'Mouse4' ? { button: 4 } : code === 'Mouse5' ? { button: 5 } : { keycode: keycodeFor(code) };
        if (target.keycode === undefined && target.button === undefined) target = null;
      }
    }
    if (target) start();
    else stop();
  },

  stop,
};
