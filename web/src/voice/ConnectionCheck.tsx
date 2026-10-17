import { useEffect, useRef, useState } from 'react';
import { Room } from 'livekit-client';
import { api } from '../api';
import { PATH_LABEL, readStats, type CallPath } from './stats';
import { CheckIcon, XIcon } from '../ui/icons';

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
      new Promise((_, reject) => (timer = window.setTimeout(() => reject(new Error('не дождались ответа за 15 секунд')), 15_000))),
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

export function ConnectionCheck({ onDone }: { onDone?: (ok: boolean) => void }) {
  const [normal, setNormal] = useState<Result>({ state: 'wait' });
  const [relay, setRelay] = useState<Result>({ state: 'wait' });
  const [run, setRun] = useState(0);
  const done = useRef(onDone);
  done.current = onDone;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setNormal({ state: 'run' });
      setRelay({ state: 'wait' });
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
  }, [run]);

  const finished = normal.state !== 'run' && normal.state !== 'wait' && relay.state !== 'run' && relay.state !== 'wait';
  return (
    <div className="flex flex-col gap-2">
      <Row title="Звонок" hint="как браузер найдёт сам" result={normal} />
      <Row title="Антилаг" hint="только через сервер, на порту 443" result={relay} />
      {finished && (
        <p className="px-1 pt-1 text-[13px] leading-snug text-muted">
          {normal.state === 'ok' && relay.state === 'ok'
            ? 'Связь в порядке, антилаг тоже работает.'
            : normal.state === 'ok'
              ? 'Звонки идут, но антилаг не работает: в слабых сетях связь может пропадать. Нужна проверка TURN на сервере.'
              : relay.state === 'ok'
                ? 'Напрямую не проходит, но с антилагом звонки пойдут.'
                : 'Звонки не проходят: LiveKit не запущен или закрыты порты 443 TCP/UDP.'}{' '}
          <button onClick={() => setRun((n) => n + 1)} className="text-foreground hover:underline">
            Проверить ещё раз
          </button>
        </p>
      )}
    </div>
  );
}

function Row({ title, hint, result }: { title: string; hint: string; result: Result }) {
  return (
    <div className="flex items-center gap-3 rounded-[22px] bg-surface-tertiary px-4 py-3">
      <span
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
          result.state === 'ok' ? 'bg-success text-[#00210c]' : result.state === 'fail' ? 'bg-danger text-white' : 'bg-white/10 text-muted'
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
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-medium">{title}</span>
        <span className="block text-[13px] leading-snug text-muted">
          {result.state === 'ok'
            ? [result.path && PATH_LABEL[result.path], result.rtt !== undefined && `задержка ${result.rtt} мс`, `подключились за ${((result.ms ?? 0) / 1000).toFixed(1)} с`]
                .filter(Boolean)
                .join(' · ')
            : result.state === 'fail'
              ? `Не прошло: ${result.error}`
              : hint}
        </span>
      </span>
    </div>
  );
}
