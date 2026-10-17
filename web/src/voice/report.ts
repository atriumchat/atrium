import type { Room } from 'livekit-client';
import { Track } from 'livekit-client';
import { api } from '../api';
import { collect, pathOf, transports, type Stat } from './stats';

/**
 * The call's quality for the server's log, so a bad call can be looked at afterwards: every minute and once on
 * leaving, loss, jitter, round trip, the path and whether screen audio is going out. Numbers only: no audio, no addresses.
 */

type Counters = { lost: number; got: number };
export type QualityReporter = { stop(): Promise<void>; drop(): void };

const EVERY_MS = 60_000;

const round = (n: number) => Math.round(n * 10) / 10;

/** The path in the log's words: "udp", "tcp", "relay/turn-udp", "relay/turn-tcp" or "relay/turn-tls". */
function transportOf(list: Stat[]) {
  const { path, rtt } = pathOf(list);
  const name = path === 'relay-tls' ? 'relay/turn-tls' : path === 'relay-tcp' ? 'relay/turn-tcp' : path === 'relay-udp' ? 'relay/turn-udp' : path === 'tcp' ? 'tcp' : path ? 'udp' : '';
  return { transport: name, rtt };
}

/** Starts reporting on a connected call; `stop()` sends the last report. */
export function startQualityReports(room: Room, channelId: string): QualityReporter {
  // Loss is counted since the previous report, per incoming track, so a clean minute after a bad one reads clean.
  const before = new Map<string, Counters>();

  async function send(when: 'tick' | 'leave') {
    const { pub, sub } = transports(room);
    const [pubList, subList] = await Promise.all([collect(pub), collect(sub)]);
    const inbound = subList.filter((s) => s.type === 'inbound-rtp' && s.kind === 'audio');
    const losses: number[] = [];
    for (const s of inbound) {
      const now = { lost: Number(s.packetsLost) || 0, got: Number(s.packetsReceived) || 0 };
      const prev = before.get(s.id) ?? { lost: 0, got: 0 };
      before.set(s.id, now);
      const lost = Math.max(now.lost - prev.lost, 0);
      const got = Math.max(now.got - prev.got, 0);
      if (lost + got > 0) losses.push((lost / (lost + got)) * 100);
    }
    const jitters = inbound.map((s) => (Number(s.jitter) || 0) * 1000);
    const remote = pubList.filter((s) => s.type === 'remote-inbound-rtp' && s.kind === 'audio');
    const avg = (xs: number[]) => (xs.length ? round(xs.reduce((a, b) => a + b, 0) / xs.length) : undefined);
    const worst = (xs: number[]) => (xs.length ? round(Math.max(...xs)) : undefined);
    // Audio from the screen is its own outgoing track, next to the mic.
    const screenAudio = room.localParticipant.getTrackPublication(Track.Source.ScreenShareAudio) !== undefined;
    const { transport, rtt } = transportOf(subList.length ? subList : pubList);
    await api.callQuality({
      channelId,
      when,
      transport,
      lossIn: avg(losses),
      lossInWorst: worst(losses),
      jitter: avg(jitters),
      jitterWorst: worst(jitters),
      rtt,
      lossOut: remote.length ? round(Math.max(...remote.map((s) => Number(s.fractionLost) || 0)) * 100) : undefined,
      screenAudio,
    });
  }

  const quiet = (when: 'tick' | 'leave'): Promise<void> => send(when).catch(() => {
    // A report is a courtesy to the log: a failed one is not worth a message to anyone.
  });
  const timer = setInterval(() => void quiet('tick'), EVERY_MS);
  return {
    /** The last report; call it while the room is still connected. */
    stop() {
      clearInterval(timer);
      return quiet('leave');
    },
    /** The call is already gone: nothing left to measure. */
    drop() {
      clearInterval(timer);
    },
  };
}
