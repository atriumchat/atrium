import { useEffect, useRef, useState } from 'react';
import { Room } from 'livekit-client';
import { api } from '../api';
import { pathLabel, readStats, type CallPath } from './stats';
import { CheckIcon, XIcon } from '../ui/icons';
import { Row } from '../ui/settings';
import { t, useT } from '../i18n';

/**
 * Do calls get through from here? Three tries against the server's LiveKit, each in a room of one:
 * the normal way (whatever path the browser finds), then forced through the relay — that's the
 * TURN-over-TLS-on-443 path that has to work when everything else is blocked.
 */

type Result = { state: 'wait' | 'run' | 'ok' | 'fail'; ms?: number; rtt?: number; path?: CallPath; error?: string };

/** Which way the call actually went, from the selected ICE candidate pair. */
async function describe(room: Room): Promise<{ path?: CallPath; rtt?: number }> {
  const { stats } = await readStats(room, null);
  return { path: stats.path, rtt: stats.rtt };
}

/** One try at a call in a room of one: normally, or forced through the relay on 443. */
export async function attempt(relayOnly: boolean): Promise<Result> {
  const { token, url } = await api.checkToken();
  const room = new Room();
  const started = performance.now();
  let timer = 0;
  try {
    await Promise.race([
      room.connect(url, token, { autoSubscribe: false, rtcConfig: relayOnly ? { iceTransportPolicy: 'relay' } : undefined }),
      new Promise((_, reject) => (timer = window.setTimeout(() => reject(new Error(t('voice.check.timeout'))), 15_000))),
    ]);
    const ms = Math.round(performance.now() - started);
    // A moment for the stats to settle on the chosen path.
    await new Promise((r) => setTimeout(r, 600));
    return { state: 'ok', ms, ...(await describe(room)) };
  } catch (e) {
    return { state: 'fail', error: e instanceof Error ? e.message : String(e) };
  } finally {
    clearTimeout(timer);
    await room.disconnect();
  }
}

/** The two tries, one after the other, as rows of the settings. Mount it again (a new `key`) to try again. */
export function ConnectionCheck({ onDone }: { onDone?: (ok: boolean) => void }) {
  const { t } = useT();
  const [normal, setNormal] = useState<Result>({ state: 'wait' });
  const [relay, setRelay] = useState<Result>({ state: 'wait' });
  const done = useRef(onDone);
  done.current = onDone;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setNormal({ state: 'run' });
      const a = await attempt(false);
      if (cancelled) return;
      setNormal(a);
      setRelay({ state: 'run' });
      const b = await attempt(true);
      if (cancelled) return;
      setRelay(b);
      done.current?.(a.state === 'ok' || b.state === 'ok');
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      <Try title={t('voice.call.title')} hint={t('voice.check.normalHint')} result={normal} />
      <Try title={t('voice.antiLag')} hint={t('voice.check.relayHint')} result={relay} />
    </>
  );
}

const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

function Try({ title, hint, result }: { title: string; hint: string; result: Result }) {
  const { t } = useT();
  return (
    <Row
      icon={
        <span
          className={`flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full ${
            result.state === 'ok' ? 'bg-success text-[#00210c]' : result.state === 'fail' ? 'bg-danger text-white' : 'bg-default text-muted'
          }`}
        >
          {result.state === 'ok' ? (
            <CheckIcon size={16} strokeWidth={3} />
          ) : result.state === 'fail' ? (
            <XIcon size={16} strokeWidth={3} />
          ) : result.state === 'run' ? (
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
          ) : (
            <span className="h-1.5 w-1.5 rounded-full bg-white/40" />
          )}
        </span>
      }
      title={title}
      value={
        result.state === 'ok'
          ? capital([result.path && pathLabel(result.path), result.rtt !== undefined && t('voice.ms', { value: result.rtt }), t('voice.check.took', { seconds: ((result.ms ?? 0) / 1000).toFixed(1) })].filter(Boolean).join(' · '))
          : result.state === 'fail'
            ? t('voice.check.failed', { error: result.error ?? '' })
            : hint
      }
    />
  );
}
