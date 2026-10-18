import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { Room } from 'livekit-client';
import { useStore } from '../store';
import { t } from '../i18n';

/**
 * What the call is going through right now, from the browser's WebRTC stats on LiveKit's two connections
 * (one sends, one receives): the path, round trip, loss, jitter and bitrate.
 */

export type CallPath = 'direct' | 'udp' | 'tcp' | 'relay-udp' | 'relay-tcp' | 'relay-tls';

const PATH_KEY = {
  direct: 'voice.path.direct',
  udp: 'voice.path.udp',
  tcp: 'voice.path.tcp',
  'relay-udp': 'voice.path.relayUdp',
  'relay-tcp': 'voice.path.relayTcp',
  'relay-tls': 'voice.path.relayTls',
} as const;

/** The path in words, in the current language. */
export const pathLabel = (path: CallPath) => t(PATH_KEY[path]);

export type CallStats = {
  path?: CallPath;
  /** Round trip to the server, ms. */
  rtt?: number;
  /** Share of audio packets lost on the way to us / from us, percent. */
  lossIn?: number;
  lossOut?: number;
  /** Incoming audio jitter, ms. */
  jitter?: number;
  kbpsIn?: number;
  kbpsOut?: number;
  quality: 'good' | 'fair' | 'bad' | 'unknown';
};

export type Stat = RTCStats & Record<string, unknown>;
type Transport = { getStats(): Promise<RTCStatsReport> | undefined };

export function transports(room: Room) {
  const pcs = (room.engine as unknown as { pcManager?: { publisher?: Transport; subscriber?: Transport } }).pcManager;
  return { pub: pcs?.publisher, sub: pcs?.subscriber };
}

export async function collect(t?: Transport) {
  const report = await t?.getStats();
  const list: Stat[] = [];
  report?.forEach((r) => list.push(r as Stat));
  return list;
}

export function pathOf(list: Stat[]): { path?: CallPath; rtt?: number } {
  const byId = new Map(list.map((s) => [s.id, s]));
  const pair = list.find((s) => s.type === 'candidate-pair' && s.state === 'succeeded' && (s.nominated || s.selected));
  const local = pair ? byId.get(pair.localCandidateId as string) : undefined;
  const rtt = typeof pair?.currentRoundTripTime === 'number' ? Math.round((pair.currentRoundTripTime as number) * 1000) : undefined;
  if (!local) return { rtt };
  if (local.candidateType === 'relay') {
    const relay = (local.relayProtocol as string) ?? 'udp';
    return { rtt, path: relay === 'tls' ? 'relay-tls' : relay === 'tcp' ? 'relay-tcp' : 'relay-udp' };
  }
  return { rtt, path: local.candidateType === 'host' ? 'direct' : local.protocol === 'tcp' ? 'tcp' : 'udp' };
}

/** Counters from the previous sample, to turn totals into rates. */
export type StatsMemory = { at: number; bytesIn: number; bytesOut: number; lostIn: number; gotIn: number };

export async function readStats(room: Room, prev: StatsMemory | null): Promise<{ stats: CallStats; memory: StatsMemory }> {
  const { pub, sub } = transports(room);
  const [pubList, subList] = await Promise.all([collect(pub), collect(sub)]);
  const { path, rtt } = pathOf(subList.length ? subList : pubList);
  const sum = (list: Stat[], type: string, field: string) =>
    list.filter((s) => s.type === type && s.kind === 'audio').reduce((n, s) => n + (Number(s[field]) || 0), 0);

  const now = performance.now();
  const memory: StatsMemory = {
    at: now,
    bytesIn: sum(subList, 'inbound-rtp', 'bytesReceived'),
    bytesOut: sum(pubList, 'outbound-rtp', 'bytesSent'),
    lostIn: sum(subList, 'inbound-rtp', 'packetsLost'),
    gotIn: sum(subList, 'inbound-rtp', 'packetsReceived'),
  };
  const stats: CallStats = { path, rtt, quality: 'unknown' };
  if (prev) {
    const seconds = (now - prev.at) / 1000;
    stats.kbpsIn = Math.round(((memory.bytesIn - prev.bytesIn) * 8) / 1000 / seconds);
    stats.kbpsOut = Math.round(((memory.bytesOut - prev.bytesOut) * 8) / 1000 / seconds);
    const lost = memory.lostIn - prev.lostIn;
    const got = memory.gotIn - prev.gotIn;
    if (lost + got > 0) stats.lossIn = Math.round((lost / (lost + got)) * 1000) / 10;
  }
  const remote = pubList.filter((s) => s.type === 'remote-inbound-rtp' && s.kind === 'audio');
  if (remote.length) stats.lossOut = Math.round(Math.max(...remote.map((s) => Number(s.fractionLost) || 0)) * 1000) / 10;
  const jitters = subList.filter((s) => s.type === 'inbound-rtp' && s.kind === 'audio').map((s) => Number(s.jitter) || 0);
  if (jitters.length) stats.jitter = Math.round(Math.max(...jitters) * 1000);

  const loss = Math.max(stats.lossIn ?? 0, stats.lossOut ?? 0);
  if (rtt !== undefined) stats.quality = rtt < 150 && loss < 2 ? 'good' : rtt < 300 && loss < 6 ? 'fair' : 'bad';
  return { stats, memory };
}

/*
 * One poller for the whole page, however many places show the stats: getStats() walks both connections, which
 * isn't free on a weak device. It runs only while someone is subscribed, a call is connected and the page is
 * visible; a hidden window doesn't need fresh numbers.
 */
const listeners = new Set<() => void>();
let current: CallStats | null = null;
/** The call being polled right now, and the one `current` was measured on. */
let polled: Room | null = null;
let measured: Room | null = null;
let memory: StatsMemory | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
// Bumped on every stop, so a getStats() still in flight when the call changes is thrown away.
let generation = 0;

function publish(stats: CallStats | null) {
  current = stats;
  listeners.forEach((l) => l());
}

function syncPoller() {
  const { room, voiceStatus } = useStore.getState();
  const live = room && voiceStatus === 'connected' ? room : null;
  // Numbers from a call that's over (or another one) mustn't stay on screen.
  if (current && measured !== live) publish(null);
  const want = live && listeners.size > 0 && !document.hidden ? live : null;
  if (want === polled) return;
  if (timer) clearInterval(timer);
  timer = null;
  generation++;
  // Totals from before a pause would turn into a rate averaged over the whole gap.
  memory = null;
  polled = want;
  if (!want) return;
  const mine = generation;
  const tick = async () => {
    try {
      const r = await readStats(want, memory);
      if (mine !== generation) return;
      memory = r.memory;
      measured = want;
      publish(r.stats);
    } catch {
      // Stats are best-effort; the next tick tries again.
    }
  };
  void tick();
  timer = setInterval(tick, 2000);
}

if (typeof document !== 'undefined') {
  useStore.subscribe((s, prev) => {
    if (s.room !== prev.room || s.voiceStatus !== prev.voiceStatus) syncPoller();
  });
  document.addEventListener('visibilitychange', syncPoller);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  syncPoller();
  return () => {
    listeners.delete(listener);
    syncPoller();
  };
}

const noSubscribe = () => () => {};
const snapshot = () => current;

/** The call's stats, refreshed every two seconds while connected. `enabled` false: nothing is polled for this caller. */
export function useCallStats(enabled = true): CallStats | null {
  const stats = useSyncExternalStore(enabled ? subscribe : noSubscribe, snapshot);
  return enabled ? stats : null;
}

/** True once the call has been bad for three samples in a row (about six seconds), so one hiccup doesn't nag. */
export function useBadConnection(stats: CallStats | null): boolean {
  const streak = useRef(0);
  const [bad, setBad] = useState(false);
  useEffect(() => {
    streak.current = stats?.quality === 'bad' ? streak.current + 1 : 0;
    setBad(streak.current >= 3);
  }, [stats]);
  return bad;
}
