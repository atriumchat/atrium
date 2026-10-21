import { useEffect, useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import Animated, { runOnJS, useAnimatedStyle, useFrameCallback, useSharedValue } from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';
import { useT } from '../i18n';
import { Text } from '../text';
import { color, colors } from '../theme';

/**
 * Something to do while the server installs, after Chrome's offline dinosaur: a white dinosaur runs along the ground,
 * server racks come at it, a tap makes it jump. Behind it a pixel Moscow goes by slower (the Ostankino tower, the
 * Kremlin, St Basil's, the university). It all runs on the UI thread (useFrameCallback); only the score and the end of
 * a run come back to React.
 */

const PX = 2.5; // one pixel of the sprites, in points
const HEIGHT = 150;
const GROUND = 128; // where the feet are
const DINO_X = 44;
const GRAVITY = 2600;
const JUMP = -760;

// The sprites, a row of pixels per string.
const BODY = [
  '..........XXXXXXXX',
  '.........XX.XXXXXXX',
  '.........XXXXXXXXXX',
  '.........XXXXXXXXXX',
  '.........XXXXX.....',
  '.........XXXXXXXX..',
  'X.......XXXXX......',
  'X......XXXXXX......',
  'XX...XXXXXXXXXX....',
  'XXX.XXXXXXXXX.X....',
  'XXXXXXXXXXXXX......',
  'XXXXXXXXXXXXX......',
  '.XXXXXXXXXXX.......',
  '..XXXXXXXXXX.......',
  '...XXXXXXXX........',
  '....XXXXXXX........',
];
const LEGS_A = ['....XXX..XX........', '....XX....X........', '....X.....XX.......'];
const LEGS_B = ['....XX..XXX........', '....X....XX........', '....XX.............'];
const RACK_SHORT = [
  'XXXXXXXXXXXX',
  'X..........X',
  'X.XXXXX.X..X',
  'X..........X',
  'X.XXXXX.X..X',
  'X..........X',
  'X.XXXXX.X..X',
  'X..........X',
  'XXXXXXXXXXXX',
  '.X........X.',
];
const RACK_TALL = [
  'XXXXXXXXXXXX',
  'X..........X',
  'X.XXXXX.X..X',
  'X..........X',
  'X.XXXXX.X..X',
  'X..........X',
  'X.XXXXX.X..X',
  'X..........X',
  'X.XXXXX.X..X',
  'X..........X',
  'X.XXXXX.X..X',
  'X..........X',
  'X.XXXXX.X..X',
  'X..........X',
  'XXXXXXXXXXXX',
  '.X........X.',
];
const RACKS = [RACK_SHORT, RACK_TALL];

/** A sprite as one SVG path: a rectangle for every run of pixels in a row. */
function sprite(rows: string[], top = 0) {
  let d = '';
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; ) {
      if (row[x] !== 'X') {
        x++;
        continue;
      }
      let w = 0;
      while (row[x + w] === 'X') w++;
      d += `M${x} ${y + top}h${w}v1h${-w}z`;
      x += w;
    }
  });
  return d;
}

/** Pixel Moscow, one tile 200 pixels wide and 44 high, standing on its bottom edge: [x, width, height] blocks. */
function moscow() {
  const blocks: [number, number, number][] = [
    // houses
    [0, 14, 10], [14, 10, 14], [24, 8, 8],
    // the Ostankino tower: the needle, its bulb, the base
    [36, 2, 44], [35, 4, 30], [34, 6, 6], [33, 8, 3],
    [44, 12, 9], [56, 6, 12],
    // the Kremlin wall and the Spasskaya tower with its spire
    [62, 40, 8], [62, 2, 10], [66, 2, 10], [70, 2, 10], [94, 2, 10], [98, 2, 10],
    [78, 8, 20], [79, 6, 24], [80, 4, 28], [81, 2, 33], [81, 2, 35],
    // St Basil's: drums and onion domes
    [104, 26, 12], [106, 4, 18], [105, 6, 20], [106, 4, 22], [107, 2, 24],
    [114, 6, 22], [113, 8, 25], [114, 6, 27], [116, 2, 31],
    [124, 4, 17], [123, 6, 19], [124, 4, 21], [125, 2, 23],
    [132, 10, 7],
    // the university: wings, the stepped tower, the spire
    [144, 30, 12], [150, 18, 20], [153, 12, 26], [156, 6, 32], [158, 2, 40],
    [176, 10, 9], [186, 14, 13],
  ];
  return blocks.map(([x, w, h]) => `M${x} ${44 - h}h${w}v${h}h${-w}z`).join('');
}
const CITY = moscow();

/**
 * The ground under the line: specks and pebbles in one tile 200 pixels wide (2 points a pixel), denser near the top,
 * the same every time (a fixed sequence, not Math.random).
 */
function dirt(depth: number) {
  let d = '';
  let seed = 7;
  const next = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
  for (let i = 0; i < 90; i++) {
    const x = Math.floor(next() * 200);
    const y = 2 + Math.floor(Math.pow(next(), 1.8) * depth);
    const w = 1 + Math.floor(next() * 3);
    d += `M${x} ${y}h${w}v1h${-w}z`;
  }
  return d;
}
const DIRT_W = 200 * 2;
const CITY_W = 200 * 2; // the tile in points (2 points a pixel: further away, so finer)

/**
 * `below`: room under the ground, down to the screen's edge (the home bar). `last`: the server is ready, so the run
 * going on is the last one: it's said over the game, and a crash offers `onLeave` instead of another run.
 * `onPlaying` hears when a run starts and ends.
 */
export function DinoRun({ below = 0, last = false, onPlaying, onLeave }: { below?: number; last?: boolean; onPlaying?: (playing: boolean) => void; onLeave?: () => void }) {
  const { t } = useT();
  const [width, setWidth] = useState(0);
  const [state, setState] = useState<'ready' | 'run' | 'over'>('ready');
  const [score, setScore] = useState(0);

  const y = useSharedValue(0); // height above the ground, up is negative
  const vy = useSharedValue(0);
  const speed = useSharedValue(260);
  const city = useSharedValue(0);
  const ground = useSharedValue(0);
  const step = useSharedValue(0); // the legs' frame
  const running = useSharedValue(false);
  const crashed = useSharedValue(false); // everything stands still until the next run
  const meters = useSharedValue(0);
  const shown = useSharedValue(0);
  // Three racks at most on the screen: where each is, which one it is, and how far until the next comes.
  const rackX = [useSharedValue(-100), useSharedValue(-100), useSharedValue(-100)];
  const rackKind = [useSharedValue(0), useSharedValue(1), useSharedValue(0)];
  const gap = useSharedValue(0);
  const field = useSharedValue(0);

  useEffect(() => {
    field.value = width;
  }, [width, field]);

  const frame = useFrameCallback((info) => {
    'worklet';
    const dt = Math.min(0.05, (info.timeSincePreviousFrame ?? 16) / 1000);
    if (crashed.value) return;
    // The world goes by and the legs run before the first tap too; only a crash stops them.
    city.value = (city.value - speed.value * 0.25 * dt) % CITY_W;
    ground.value = (ground.value - speed.value * dt) % DIRT_W;
    step.value = (step.value + dt * 10) % 2;
    if (!running.value) return;
    speed.value = Math.min(560, speed.value + 7 * dt);
    meters.value += speed.value * dt * 0.05;
    // The jump.
    vy.value += GRAVITY * dt;
    y.value = Math.min(0, y.value + vy.value * dt);
    if (y.value === 0) vy.value = 0;
    // The racks come on, and a new one when the last is far enough in.
    gap.value -= speed.value * dt;
    for (let i = 0; i < 3; i++) {
      const r = rackX[i]!;
      if (r.value > -60) r.value -= speed.value * dt;
      else if (gap.value <= 0) {
        r.value = field.value + 10;
        rackKind[i]!.value = Math.random() < 0.65 ? 0 : 1;
        gap.value = speed.value * (0.75 + Math.random() * 0.9);
      }
      // Hit: the dinosaur's box, a little inside its pixels, against the rack's.
      const tall = rackKind[i]!.value === 1;
      const rackTop = GROUND - (tall ? 16 : 10) * PX;
      const dinoLeft = DINO_X + 4 * PX;
      const dinoRight = DINO_X + 15 * PX;
      const dinoBottom = GROUND + y.value - 2;
      if (r.value < dinoRight && r.value + 12 * PX > dinoLeft && dinoBottom > rackTop + 3) {
        running.value = false;
        crashed.value = true;
        runOnJS(setState)('over');
      }
    }
    const whole = Math.floor(meters.value);
    if (whole !== shown.value) {
      shown.value = whole;
      runOnJS(setScore)(whole);
    }
  }, true);

  useEffect(() => () => frame.setActive(false), [frame]);
  useEffect(() => onPlaying?.(state === 'run'), [state]);

  function tap() {
    if (state === 'over' && last) return onLeave?.();
    if (state !== 'run') {
      // A new run: everything back to the start.
      for (const r of rackX) r.value = -100;
      gap.value = 200;
      speed.value = 260;
      meters.value = 0;
      shown.value = 0;
      setScore(0);
      y.value = 0;
      vy.value = JUMP;
      crashed.value = false;
      running.value = true;
      setState('run');
      return;
    }
    if (y.value === 0) vy.value = JUMP;
  }

  const dinoStyle = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }] }));
  const legsA = useAnimatedStyle(() => ({ opacity: crashed.value || y.value < 0 || step.value < 1 ? 1 : 0 }));
  const legsB = useAnimatedStyle(() => ({ opacity: !crashed.value && y.value === 0 && step.value >= 1 ? 1 : 0 }));
  const cityStyle = useAnimatedStyle(() => ({ transform: [{ translateX: city.value }] }));
  const groundStyle = useAnimatedStyle(() => ({ transform: [{ translateX: ground.value }] }));
  const rackStyles = rackX.map((r) => useAnimatedStyle(() => ({ transform: [{ translateX: r.value }] }))); // eslint-disable-line react-hooks/rules-of-hooks
  const kindTall = rackKind.map((k) => useAnimatedStyle(() => ({ opacity: k.value === 1 ? 1 : 0 }))); // eslint-disable-line react-hooks/rules-of-hooks
  const kindShort = rackKind.map((k) => useAnimatedStyle(() => ({ opacity: k.value === 0 ? 1 : 0 }))); // eslint-disable-line react-hooks/rules-of-hooks

  const dirtDepth = Math.ceil((HEIGHT - GROUND + below) / 2);
  const paths = useMemo(
    () => ({ body: sprite(BODY), a: sprite(LEGS_A, BODY.length), b: sprite(LEGS_B, BODY.length), racks: RACKS.map((rows) => sprite(rows)), dirt: dirt(dirtDepth) }),
    [dirtDepth],
  );
  const dinoH = (BODY.length + LEGS_A.length) * PX;

  return (
    <Pressable accessibilityRole="button" accessibilityLabel={t('own.game.jump')} onPress={tap} onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={{ height: HEIGHT + below }}>
      {/* Moscow, far behind, twice so it never runs out */}
      <Animated.View style={[{ position: 'absolute', left: 0, top: GROUND - 88, flexDirection: 'row' }, cityStyle]}>
        {[0, 1, 2].map((i) => (
          <Svg key={i} width={CITY_W} height={88} viewBox="0 0 200 44">
            <Path d={CITY} fill={color.gameCity} />
          </Svg>
        ))}
      </Animated.View>
      {/* The ground: black down to the screen's edge (over the edge's ticks, so the line stands on something), its specks going by */}
      <View style={{ position: 'absolute', left: 0, right: 0, top: GROUND, bottom: 0, backgroundColor: color.page.phone, overflow: 'hidden' }}>
        <Animated.View style={[{ position: 'absolute', left: 0, top: 0, flexDirection: 'row' }, groundStyle]}>
          {[0, 1, 2].map((i) => (
            <Svg key={i} width={DIRT_W} height={dirtDepth * 2 + 4} viewBox={`0 0 200 ${dirtDepth + 2}`}>
              <Path d={paths.dirt} fill={color.gameDirt} />
            </Svg>
          ))}
        </Animated.View>
      </View>
      <View style={{ position: 'absolute', left: 0, right: 0, top: GROUND, height: 1, backgroundColor: color.gameGround }} />
      {rackX.map((_, i) => (
        <Animated.View key={i} style={[{ position: 'absolute', left: 0, top: 0 }, rackStyles[i]]}>
          <Animated.View style={[{ position: 'absolute', top: GROUND - RACK_SHORT.length * PX }, kindShort[i]]}>
            <Svg width={12 * PX} height={RACK_SHORT.length * PX} viewBox={`0 0 12 ${RACK_SHORT.length}`}><Path d={paths.racks[0]} fill={color.text.phone} /></Svg>
          </Animated.View>
          <Animated.View style={[{ position: 'absolute', top: GROUND - RACK_TALL.length * PX }, kindTall[i]]}>
            <Svg width={12 * PX} height={RACK_TALL.length * PX} viewBox={`0 0 12 ${RACK_TALL.length}`}><Path d={paths.racks[1]} fill={color.text.phone} /></Svg>
          </Animated.View>
        </Animated.View>
      ))}
      <Animated.View style={[{ position: 'absolute', left: DINO_X, top: GROUND - dinoH }, dinoStyle]}>
        <Svg width={19 * PX} height={dinoH} viewBox={`0 0 19 ${BODY.length + LEGS_A.length}`}>
          <Path d={paths.body} fill={color.text.phone} />
        </Svg>
        <Animated.View style={[{ position: 'absolute', left: 0, top: 0 }, legsA]}>
          <Svg width={19 * PX} height={dinoH} viewBox={`0 0 19 ${BODY.length + LEGS_A.length}`}><Path d={paths.a} fill={color.text.phone} /></Svg>
        </Animated.View>
        <Animated.View style={[{ position: 'absolute', left: 0, top: 0 }, legsB]}>
          <Svg width={19 * PX} height={dinoH} viewBox={`0 0 19 ${BODY.length + LEGS_A.length}`}><Path d={paths.b} fill={color.text.phone} /></Svg>
        </Animated.View>
      </Animated.View>
      <Text style={{ position: 'absolute', right: 40, top: 0, fontSize: 15, color: colors.muted, fontVariant: ['tabular-nums'] }}>{score > 0 ? String(score).padStart(4, '0') : ''}</Text>
      {state === 'over' && last ? (
        // The run is over and the server is waiting: on to it, as a button, not another run.
        <View style={{ position: 'absolute', left: 0, right: 0, top: 22, alignItems: 'center' }}>
          <View style={{ height: 40, borderRadius: 20, paddingHorizontal: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: color.button }}>
            <Text style={{ fontSize: 16, fontWeight: '500', color: color.buttonInk }}>{t('own.game.next')}</Text>
          </View>
        </View>
      ) : state === 'run' && last ? (
        <Text style={{ position: 'absolute', left: 0, right: 0, top: 36, textAlign: 'center', fontSize: 15, color: color.text.phone }}>{t('own.game.last')}</Text>
      ) : state !== 'run' ? (
        <Text style={{ position: 'absolute', left: 0, right: 0, top: 36, textAlign: 'center', fontSize: 15, color: colors.muted }}>{state === 'over' ? t('own.game.again') : t('own.game.start')}</Text>
      ) : null}
    </Pressable>
  );
}
