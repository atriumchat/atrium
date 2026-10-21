import { useEffect, useId, useMemo, useRef, useState, type ReactNode, type Ref } from 'react';
import { PixelRatio, View } from 'react-native';
import Svg, { Circle, ClipPath, Defs, Image as SvgImage, Text as SvgText } from 'react-native-svg';
import { mediaSource } from '../api';
import { useStore } from '../store';
import { GomexMark } from '../components/Logo';
import { HomeFilledIcon, HomeIcon } from '../icons';
import type { User } from '../protocol';

/** An icon for the native tab bar: a PNG at the screen's scale, `size` points across. */
export type TabIcon = { uri: string; width: number; height: number; scale: number };
export type TabIconName = 'home' | 'homeOn' | 'server' | 'serverOn' | 'you';

const SIZE = 26;

/**
 * The native tab bar takes images, not views. So our own glyphs and your avatar are drawn here, out of sight, as
 * <Svg> and handed over as PNGs: the bar keeps Gomex's icons and your face, and the system draws the rest.
 */
export function TabIconShots({ onShot }: { onShot: (name: TabIconName, icon: TabIcon) => void }) {
  const me = useStore((s) => s.data?.me);
  const serverIcon = useStore((s) => s.data?.serverIcon);
  const take = (name: TabIconName) => (icon: TabIcon) => onShot(name, icon);
  return (
    <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ position: 'absolute', left: -1000, top: 0, flexDirection: 'row' }}>
      <Shot onShot={take('home')}>{(ref) => <HomeIcon ref={ref} size={SIZE} color="#fff" />}</Shot>
      <Shot onShot={take('homeOn')}>{(ref) => <HomeFilledIcon ref={ref} size={SIZE} color="#fff" />}</Shot>
      {serverIcon ? (
        <Shot key={`server:${serverIcon}`} wait onShot={take('server')}>{(ref, loaded) => <Picture ref={ref} path={serverIcon} onLoad={loaded} />}</Shot>
      ) : (
        <>
          <Shot key="server" onShot={take('server')}>{(ref) => <GomexMark ref={ref} size={SIZE} color="#fff" />}</Shot>
          <Shot key="serverOn" onShot={take('serverOn')}>{(ref) => <GomexMark ref={ref} size={SIZE} color="#fff" filled />}</Shot>
        </>
      )}
      <Shot key={`you:${me?.avatarUrl ?? ''}:${me?.color ?? ''}:${me?.name ?? ''}`} wait={!!me?.avatarUrl} onShot={take('you')}>
        {(ref, loaded) => (me?.avatarUrl ? <Picture ref={ref} path={me.avatarUrl} onLoad={loaded} /> : <Letter ref={ref} user={me} />)}
      </Shot>
    </View>
  );
}

/** Renders one <Svg> and, once it is drawn (and its picture loaded, with `wait`), takes it as a PNG. */
function Shot({ wait = false, onShot, children }: { wait?: boolean; onShot: (icon: TabIcon) => void; children: (ref: Ref<Svg>, loaded: () => void) => ReactNode }) {
  const ref = useRef<Svg>(null);
  const [ready, setReady] = useState(!wait);
  // Taken once per drawing (a new drawing comes with a new key), not on every render of the parent.
  const latest = useRef(onShot);
  latest.current = onShot;
  useEffect(() => {
    if (!ready) return;
    // A frame later: the native view has to exist before it can be drawn into an image.
    const frame = requestAnimationFrame(() => {
      ref.current?.toDataURL((base64) => {
        if (base64) latest.current({ uri: `data:image/png;base64,${base64}`, width: SIZE, height: SIZE, scale: PixelRatio.get() });
      }, { width: SIZE, height: SIZE });
    });
    return () => cancelAnimationFrame(frame);
  }, [ready]);
  return children(ref, () => setReady(true));
}

/** A picture from the server (your avatar, the server's icon), cut to a circle. */
function Picture({ path, onLoad, ref }: { path: string; onLoad: () => void; ref: Ref<Svg> }) {
  const clip = `c${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const source = useMemo(() => mediaSource(path), [path]);
  // Nothing to load (no media cookie yet): give up waiting rather than leave the tab without an icon.
  useEffect(() => { if (!source) onLoad(); }, [source, onLoad]);
  return (
    <Svg ref={ref} width={SIZE} height={SIZE}>
      <Defs><ClipPath id={clip}><Circle cx={SIZE / 2} cy={SIZE / 2} r={SIZE / 2} /></ClipPath></Defs>
      <Circle cx={SIZE / 2} cy={SIZE / 2} r={SIZE / 2} fill="#27272a" />
      {source ? <SvgImage href={source} width={SIZE} height={SIZE} preserveAspectRatio="xMidYMid slice" clipPath={`url(#${clip})`} onLoad={onLoad} /> : null}
    </Svg>
  );
}

/** No photo: the first letter on the person's colour, as Avatar draws it. */
function Letter({ user, ref }: { user: User | undefined; ref: Ref<Svg> }) {
  const letter = (user?.name ?? '?').trim().charAt(0).toUpperCase() || '?';
  return (
    <Svg ref={ref} width={SIZE} height={SIZE}>
      <Circle cx={SIZE / 2} cy={SIZE / 2} r={SIZE / 2} fill={user?.color ?? '#fff'} />
      <SvgText x={SIZE / 2} y={SIZE / 2} fill="#fff" fontSize={SIZE * 0.42} fontWeight="500" textAnchor="middle" alignmentBaseline="central">{letter}</SvgText>
    </Svg>
  );
}
