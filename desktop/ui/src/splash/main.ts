import './splash.css';

/**
 * The first start's splash, in its own transparent window (desktop/main.js, showSplash): only the app's icon on the
 * desktop, the tile coming in, its ring of ticks lighting up round it; under it a pad swells out of silence to its peak
 * as the ring closes and dies away as the icon fades, then the welcome window takes its place. The sound is made here
 * (Web Audio), no file.
 */

const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
// The ring's lighting (splash.css) starts at 0.5s and takes 1.25s: the pad peaks as it closes, as the tile floods.
const RING_DONE = reduce ? 0 : 1750;
const HOLD = reduce ? 0 : 900;
const FADE = reduce ? 0 : 500;

/**
 * The sound's context and its room (a short tail of decaying noise, mixed in under the dry sound), made while the
 * splash still waits hidden: built as it starts, they stall its first frames.
 */
const sound = reduce ? null : prepare();
function prepare() {
  try {
    const audio = new AudioContext();
    const length = Math.floor(audio.sampleRate * 2.8);
    const tail = audio.createBuffer(2, length, audio.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = tail.getChannelData(ch);
      for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 3);
    }
    const room = audio.createConvolver();
    room.buffer = tail;
    return { audio, room };
  } catch {
    // No audio: the splash goes on without its sound.
    return null;
  }
}

/**
 * A warm chord (F major 9, low F under it), from nothing to a peak at `peak` seconds, then gone over `release`. As it
 * fades the 7th and 9th leave first and it settles on plain F major: the window comes in on that. Returns how long
 * from now until it is actually heard (the scheduling margin plus the output's own delay: speakers, headphones), so
 * the picture can start with it.
 */
function pad(peak: number, release: number): number {
  if (!sound) return 0;
  const { audio, room } = sound;
  try {
    const t0 = audio.currentTime + 0.05;
    const top = t0 + peak;
    const end = top + release;

    const master = audio.createGain();
    master.gain.setValueAtTime(0.0001, t0);
    master.gain.linearRampToValueAtTime(0.16, top);
    master.gain.setTargetAtTime(0.0001, top + 0.15, release / 4);
    master.connect(audio.destination);

    const wet = audio.createGain();
    wet.gain.value = 0.45;
    room.connect(wet).connect(master);

    // The filter opens towards the peak and closes again as it fades: the swell is in the brightness as well.
    const filter = audio.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 0.7;
    filter.frequency.setValueAtTime(260, t0);
    filter.frequency.exponentialRampToValueAtTime(2600, top);
    filter.frequency.exponentialRampToValueAtTime(380, end);
    filter.connect(master);
    filter.connect(room);

    // F2 · F3 A3 C4 E4 G4: each note two saws a few cents apart, panned a little apart, for width. E and G (the 7th and
    // 9th) slip out just after the peak, so what dies away is F major.
    const notes = [87.31, 174.61, 220.0, 261.63, 329.63, 392.0];
    notes.forEach((freq, n) => {
      for (const cents of [-7, 7]) {
        const osc = audio.createOscillator();
        osc.type = n === 0 ? 'triangle' : 'sawtooth';
        osc.frequency.value = freq;
        osc.detune.value = cents;
        const voice = audio.createGain();
        voice.gain.value = n === 0 ? 0.5 : 0.22;
        if (n >= 4) {
          voice.gain.setValueAtTime(0.22, top + 0.1);
          voice.gain.linearRampToValueAtTime(0, top + 0.9);
        }
        const pan = audio.createStereoPanner();
        pan.pan.value = (cents > 0 ? 1 : -1) * (0.15 + n * 0.08);
        osc.connect(voice).connect(pan).connect(filter);
        osc.start(t0);
        osc.stop(end + 0.5);
      }
    });
    setTimeout(() => void audio.close(), (end - audio.currentTime + 3) * 1000);
    return t0 - audio.currentTime + (audio.outputLatency || audio.baseLatency || 0);
  } catch {
    // No audio: the splash goes on without its sound.
    return 0;
  }
}

const bridge = (window as unknown as { atriumSplash?: { done(): void } }).atriumSplash;

/**
 * Plays it all once the window shows (it's placed over the welcome's icon first, hidden): the pad, and the ring and
 * the fade on the sound's clock, so the picture starts the moment the chord is heard.
 */
async function play() {
  await sound?.audio.resume().catch(() => undefined);
  const heardIn = pad(RING_DONE / 1000, (HOLD + FADE) / 1000 + 1.2) * 1000;
  setTimeout(() => document.body.classList.add('go'), heardIn);
  // The window fades in round the icon as the splash fades out (main.js, showSplash): "done" goes with the fade.
  setTimeout(() => {
    document.body.classList.add('out');
    bridge?.done();
  }, heardIn + RING_DONE + HOLD);
}
if (document.visibilityState === 'visible') void play();
else document.addEventListener('visibilitychange', function shown() {
  if (document.visibilityState !== 'visible') return;
  document.removeEventListener('visibilitychange', shown);
  void play();
});
