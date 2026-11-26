import { useEffect, useRef, type KeyboardEvent, type PointerEvent, type RefObject } from "react";
import { useT } from "../i18n";
import { PlayIcon, StopIcon } from "../ui/icons";
import { RoundButton } from "../ui/ui";
import { MIN_SOUND_SEGMENT_MS, type previewSound } from "./soundboard";

export const MAX_SEGMENT = 240_000;
type Segment = [number, number];
type Grip = "start" | "end" | "move";

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, max));

function move([start, end]: Segment, grip: Grip, delta: number, duration: number): Segment {
  const min = Math.min(MIN_SOUND_SEGMENT_MS, duration);
  if (grip === "start") return [clamp(start + delta, Math.max(0, end - MAX_SEGMENT), end - min), end];
  if (grip === "end") return [start, clamp(end + delta, start + min, Math.min(duration, start + MAX_SEGMENT))];
  const shift = clamp(delta, -start, duration - end);
  return [start + shift, end + shift];
}

function clock(ms: number, precise = false) {
  const tenths = Math.round(ms / 100);
  const s = precise ? Math.floor(tenths / 10) : Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}${precise ? `.${tenths % 10}` : ""}`;
}

export function SoundTrim({ duration, peaks, coveredMs, segment, playing, preview, disabled, onChange, onReplay, onToggle, onStop }: {
  duration: number;
  peaks: number[];
  coveredMs: number;
  segment: Segment;
  playing: boolean;
  preview: RefObject<ReturnType<typeof previewSound> | null>;
  disabled: boolean;
  onChange: (next: Segment) => void;
  onReplay: (next: Segment) => void;
  onToggle: () => void;
  onStop: () => void;
}) {
  const { t } = useT();
  const viewport = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const playhead = useRef<HTMLSpanElement>(null);
  const frame = useRef(0);
  const drag = useRef<{
    id: number; grip: Grip; segment: Segment; x: number; startX: number; scroll: number; next: Segment;
  } | null>(null);
  const [from, to] = segment;
  const left = from / duration * 100;
  const right = to / duration * 100;
  const canScroll = duration > MAX_SEGMENT;
  const peakMax = Math.max(0.01, ...peaks);

  useEffect(() => () => cancelAnimationFrame(frame.current), []);
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const draw = () => {
      const position = preview.current?.positionMs();
      const line = playhead.current;
      if (line) line.style.visibility = position == null ? "hidden" : "visible";
      if (line && position != null) {
        line.style.left = `${clamp(position / duration * 100, left, right)}%`;
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [playing, preview, duration, left, right]);

  function updateDrag() {
    const state = drag.current;
    const box = viewport.current;
    const lane = track.current;
    if (!state || !box || !lane) return;
    const rect = box.getBoundingClientRect();
    const edge = 28;
    const overLeft = Math.max(0, rect.left + edge - state.x);
    const overRight = Math.max(0, state.x - rect.right + edge);
    const speed = clamp((overRight - overLeft) / 3, -15, 15);
    if (canScroll && speed) box.scrollLeft += speed;
    const delta = (state.x - state.startX + box.scrollLeft - state.scroll) * duration / lane.clientWidth;
    const next = move(state.segment, state.grip, Math.round(delta / 10) * 10, duration);
    if (next[0] !== state.next[0] || next[1] !== state.next[1]) {
      state.next = next;
      onChange(next);
    }
  }

  function begin(event: PointerEvent<HTMLElement>, grip: Grip) {
    if (disabled || drag.current || event.button !== 0 || !viewport.current) return;
    event.preventDefault();
    event.stopPropagation();
    onStop();
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { id: event.pointerId, grip, segment, next: segment, x: event.clientX, startX: event.clientX, scroll: viewport.current.scrollLeft };
    const tick = () => {
      updateDrag();
      if (drag.current) frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
  }

  function finish(event: PointerEvent<HTMLElement>, replay: boolean) {
    const state = drag.current;
    if (!state || state.id !== event.pointerId) return;
    if (replay) {
      state.x = event.clientX;
      updateDrag();
    }
    drag.current = null;
    cancelAnimationFrame(frame.current);
    if (replay) onReplay(state.next);
  }

  function keys(event: KeyboardEvent<HTMLElement>, grip: Grip) {
    if (disabled) return;
    const step = event.shiftKey ? 1000 : 100;
    if (event.key === " ") {
      event.preventDefault();
      onToggle();
    } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      const next = move(segment, grip, event.key === "ArrowLeft" ? -step : step, duration);
      onChange(next);
      if (playing) onReplay(next);
      const box = viewport.current;
      const lane = track.current;
      if (box && lane) {
        const x = lane.clientWidth * (grip === "start" ? next[0] : next[1]) / duration;
        if (x < box.scrollLeft || x > box.scrollLeft + box.clientWidth) box.scrollLeft = x - box.clientWidth / 2;
      }
    }
  }

  function pointerProps(grip: Grip) {
    return {
      onPointerDown: (event: PointerEvent<HTMLElement>) => begin(event, grip),
      onPointerMove: (event: PointerEvent<HTMLElement>) => {
        if (drag.current?.id === event.pointerId) drag.current.x = event.clientX;
      },
      onPointerUp: (event: PointerEvent<HTMLElement>) => finish(event, true),
      onPointerCancel: (event: PointerEvent<HTMLElement>) => finish(event, false),
      onLostPointerCapture: (event: PointerEvent<HTMLElement>) => finish(event, false),
      onKeyDown: (event: KeyboardEvent<HTMLElement>) => keys(event, grip),
    };
  }

  const wave = (bright: boolean) => (
    <svg
      aria-hidden="true"
      viewBox="0 0 1000 64"
      preserveAspectRatio="none"
      className={`pointer-events-none absolute inset-0 h-full w-full ${bright ? "text-white/80" : "text-white/25"}`}
      style={bright ? { clipPath: `inset(0 ${100 - right}% 0 ${left}%)` } : undefined}
    >
      {peaks.map((peak, i) => {
        const step = 1000 * coveredMs / duration / peaks.length;
        const h = Math.max(2, 56 * peak / peakMax);
        return <rect key={i} x={step * i} y={(64 - h) / 2} width={step * 0.58} height={h} rx="1" fill="currentColor" />;
      })}
    </svg>
  );

  return (
    <div className="flex flex-col gap-2">
      <span className="text-[14px] font-medium">{t("voice.soundboard.segment")}</span>
      <div className="flex items-start gap-2">
        <RoundButton
          label={t(playing ? "voice.soundboard.stop" : "voice.soundboard.preview")}
          onPress={onToggle}
          isDisabled={disabled}
          className="my-3"
        >
          {playing ? <StopIcon /> : <PlayIcon />}
        </RoundButton>
        <div className="min-w-0 flex-1">
          <div ref={viewport} className="no-scrollbar overflow-x-auto rounded-row bg-[#18181b]">
            <div ref={track} className="relative h-16" style={{ width: `${Math.max(1, duration / MAX_SEGMENT) * 100}%` }}>
              {wave(false)}
              {wave(true)}
              <div
                aria-label={t("voice.soundboard.moveSegment")}
                aria-valuetext={`${clock(from, true)} – ${clock(to, true)}`}
                aria-valuemin={0}
                aria-valuemax={duration - (to - from)}
                aria-valuenow={from}
                role="slider"
                tabIndex={disabled ? -1 : 0}
                aria-disabled={disabled}
                className="absolute inset-y-0 z-10 min-w-px touch-none cursor-grab rounded-[8px] border border-white/65 bg-white/[0.05] outline-none focus-visible:border-white active:cursor-grabbing"
                style={{ left: `${left}%`, width: `${right - left}%` }}
                {...pointerProps("move")}
              />
              {(["start", "end"] as const).map((grip) => {
                const start = grip === "start";
                const at = start ? left : right;
                return (
                  <div
                    key={grip}
                    role="slider"
                    tabIndex={disabled ? -1 : 0}
                    aria-disabled={disabled}
                    aria-label={t(start ? "voice.soundboard.segmentStart" : "voice.soundboard.segmentEnd")}
                    aria-valuemin={start ? Math.max(0, to - MAX_SEGMENT) : from + Math.min(MIN_SOUND_SEGMENT_MS, duration)}
                    aria-valuemax={start ? to - Math.min(MIN_SOUND_SEGMENT_MS, duration) : Math.min(duration, from + MAX_SEGMENT)}
                    aria-valuenow={start ? from : to}
                    aria-valuetext={clock(start ? from : to, true)}
                    className="absolute inset-y-1 z-20 flex w-4 touch-none cursor-ew-resize items-center justify-center rounded-[6px] outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white"
                    style={{ left: `clamp(0px, calc(${at}% ${start ? "- 4px" : "- 12px"}), calc(100% - 16px))` }}
                    {...pointerProps(grip)}
                  >
                    <span className="h-5 w-1 rounded-full bg-[#ededef]" aria-hidden="true" />
                  </div>
                );
              })}
              {playing && (
                <span ref={playhead} aria-hidden="true" className="pointer-events-none invisible absolute inset-y-1 z-30 w-0.5 rounded-full bg-white" />
              )}
            </div>
          </div>
          <div className="mt-2 flex items-center justify-between gap-1 text-[11px] tabular-nums text-muted">
            <span>{clock(from, true)}</span>
            <span className="whitespace-nowrap">{clock(from)} – {clock(to)} · {t("voice.soundboard.segmentLength", { n: Math.round((to - from) / 100) / 10 })}</span>
            <span>{clock(to, true)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
