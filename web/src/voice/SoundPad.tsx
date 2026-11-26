import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Dropdown,
  Label,
  Popover,
  Separator,
  Slider,
  Spinner,
  Switch,
  Tooltip,
} from "@heroui/react";
import { useT } from "../i18n";
import { useStore } from "../store";
import type { Sound } from "../types";
import { ConfirmDialog, Dialog } from "../ui/Dialog";
import { EmojiPicker } from "../ui/EmojiPicker";
import {
  ChevronDownIcon,
  DotsVerticalIcon,
  HeadphonesIcon,
  PencilIcon,
  PlayIcon,
  PlusIcon,
  SearchIcon,
  SmileIcon,
  SoundboardIcon,
  SpeakerIcon,
  SpeakerSlashIcon,
  StarFilledIcon,
  StarIcon,
  StopIcon,
  TrashIcon,
} from "../ui/icons";
import { field, fieldLabel, Primary, Quiet, Secondary } from "../ui/settings";
import {
  addSound,
  inspectSoundFile,
  editSound,
  loadMySounds,
  playSound,
  previewSound,
  removeSound,
  setSoundboard,
  stopMySounds,
  stopPreview,
  toggleFavorite,
} from "./soundboard";

import { MAX_SEGMENT, SoundTrim } from "./SoundTrim";

const MAX_SOUNDS = 20;
const MAX_NAME = 32;
/** How long the mark stays by someone who played a clip; the fade in index.css (sound-played) runs as long. */
const PLAYED_FOR = 2500;
/** Clips longer than this show their length on the pill. */
const LONG_MS = 10_000;
function clock(ms: number) {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

type DialogState =
  | { kind: "add" }
  | { kind: "edit"; sound: Sound }
  | { kind: "delete"; sound: Sound }
  | null;

// Match the bottom-left panel and the controls under the call.
const BUTTON = {
  panel:
    "flex h-10 w-full items-center justify-center rounded-full bg-default text-foreground [&_svg]:size-5",
  control: "call-control @max-[23rem]:w-8 @max-[23rem]:min-w-8",
} as const;
const BUTTON_ENABLED =
  "outline-none transition-colors hover:bg-[#28282d] aria-expanded:bg-[#28282d] data-[focus-visible=true]:ring-2 data-[focus-visible=true]:ring-focus";

/**
 * The soundboard button of the call (`panel`: the one in the bottom-left panel, `control`: the one among the call
 * controls) and the popover it opens. The windows the popover leads to (add, edit, delete) live here, not inside
 * it: opening one closes the popover, and the popover's contents go with it.
 */
export function SoundboardButton({
  look,
  disabled = false,
  stopsPlayback = false,
}: {
  look: keyof typeof BUTTON;
  disabled?: boolean;
  /** The panel's button: while your own clip is sounding it is a stop, not a way into the panel. */
  stopsPlayback?: boolean;
}) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [dialog, setDialog] = useState<DialogState>(null);
  const label = t("voice.soundboard.label");
  const playingId = useStore((s) =>
    stopsPlayback ? s.myPlaying?.soundId ?? null : null,
  );
  const playingName = useStore((s) =>
    playingId ? s.mySounds.find((x) => x.id === playingId)?.name ?? "" : "",
  );

  useEffect(() => {
    if (open) return () => stopPreview();
  }, [open]);

  function show(next: NonNullable<DialogState>) {
    stopPreview();
    setOpen(false);
    setDialog(next);
  }
  /** A saved clip closes the window for good; cancel, the cross and Esc bring the panel back. */
  function hide(reopen = true) {
    setDialog(null);
    if (reopen) setOpen(true);
  }

  if (playingId && !open && !dialog) {
    const stop = t("voice.soundboard.stopForCall", { name: playingName });
    return (
      <button
        type="button"
        aria-label={stop}
        title={stop}
        onClick={() => void stopMySounds()}
        className={`${BUTTON[look]} ${BUTTON_ENABLED}`}
      >
        <StopIcon size={20} />
      </button>
    );
  }

  const face = <SoundboardIcon size={20} />;
  const trigger = disabled ? (
    <button
      type="button"
      disabled
      aria-label={label}
      title={label}
      className={`${BUTTON[look]} opacity-50`}
    >
      {face}
    </button>
  ) : (
    <Popover
      isOpen={open}
      onOpenChange={setOpen}
    >
      <Popover.Trigger<'button'>
        render={(props) => <button {...props} />}
        type="button"
        aria-label={label}
        title={label}
        className={`${BUTTON[look]} ${BUTTON_ENABLED}`}
      >
        {face}
      </Popover.Trigger>
      <Popover.Content
        placement={look === "panel" ? "top start" : "top"}
        className="w-[min(552px,calc(100vw-16px))]"
      >
        <Popover.Dialog
          aria-label={label}
          className="flex flex-col p-0 outline-none"
        >
          <Panel
            onAdd={() => show({ kind: "add" })}
            onEdit={(sound) => show({ kind: "edit", sound })}
            onDelete={(sound) => show({ kind: "delete", sound })}
          />
        </Popover.Dialog>
      </Popover.Content>
    </Popover>
  );

  return (
    <>
      {trigger}
      {dialog?.kind === "add" && (
        <SoundDialog onClose={hide} onSaved={() => hide(false)} />
      )}
      {dialog?.kind === "edit" && (
        <SoundDialog
          sound={dialog.sound}
          onClose={hide}
          onSaved={() => hide(false)}
        />
      )}
      {dialog?.kind === "delete" && (
        <ConfirmDialog
          title={t("voice.soundboard.deleteTitle", { name: dialog.sound.name })}
          text={t("voice.soundboard.deleteText")}
          confirmLabel={t("voice.soundboard.delete")}
          onConfirm={() => removeSound(dialog.sound.id)}
          onClose={hide}
        />
      )}
    </>
  );
}

type SectionId = "favorites" | "mine";

/**
 * Discord's layout in our look: search and volume on top; under them a slim rail of section icons (a click scrolls to
 * the section, the one in view is marked) and the list, each section folding under its header, sounds as three-column
 * pills.
 */
function Panel({
  onAdd,
  onEdit,
  onDelete,
}: {
  onAdd: () => void;
  onEdit: (sound: Sound) => void;
  onDelete: (sound: Sound) => void;
}) {
  const { t } = useT();
  const sounds = useStore((s) => s.mySounds);
  const favorites = useStore((s) => s.soundboard.favorites);
  const playing = useStore((s) => s.myPlaying);
  const listening = useStore((s) => s.previewing !== null);
  const [query, setQuery] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [folded, setFolded] = useState<SectionId[]>([]);
  const [current, setCurrent] = useState<SectionId>("favorites");
  const list = useRef<HTMLDivElement>(null);
  const heads = useRef<Partial<Record<SectionId, HTMLElement | null>>>({});
  const q = query.trim().toLowerCase();
  const shown = q
    ? sounds.filter((s) => s.name.toLowerCase().includes(q))
    : sounds;
  const favorite = shown.filter((s) => favorites.includes(s.id));
  const canAdd = sounds.length < MAX_SOUNDS;

  const sections: { id: SectionId; title: string }[] = [];
  if (favorite.length > 0)
    sections.push({ id: "favorites", title: t("voice.soundboard.favorites") });
  if (shown.length > 0)
    sections.push({ id: "mine", title: t("voice.soundboard.mine") });
  const active = sections.some((s) => s.id === current)
    ? current
    : sections[0]?.id;

  useEffect(() => {
    let mounted = true;
    void loadMySounds().finally(() => { if (mounted) setLoaded(true); });
    return () => { mounted = false; };
  }, []);

  function track() {
    const box = list.current;
    if (!box || sections.length === 0) return;
    const atEnd =
      box.scrollTop > 0 &&
      box.scrollTop + box.clientHeight >= box.scrollHeight - 2;
    let now = sections[0].id;
    if (atEnd) now = sections[sections.length - 1].id;
    else {
      const top = box.getBoundingClientRect().top;
      for (const s of sections) {
        const head = heads.current[s.id];
        if (head && head.getBoundingClientRect().top - top <= 12) now = s.id;
      }
    }
    setCurrent(now);
  }

  function jump(id: SectionId) {
    setFolded((f) => f.filter((x) => x !== id));
    const box = list.current;
    const head = heads.current[id];
    if (!box || !head) return;
    box.scrollTo({
      top:
        box.scrollTop +
        head.getBoundingClientRect().top -
        box.getBoundingClientRect().top,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
    });
    setCurrent(id);
  }

  function fold(id: SectionId) {
    setFolded((f) => (f.includes(id) ? f.filter((x) => x !== id) : [...f, id]));
  }

  const tile = (sound: Sound) => (
    <SoundTile
      key={sound.id}
      sound={sound}
      favorite={favorites.includes(sound.id)}
      playing={playing?.soundId === sound.id ? playing : null}
      onEdit={() => onEdit(sound)}
      onDelete={() => onDelete(sound)}
    />
  );

  return (
    <>
      <div className="flex items-center gap-2 p-3 pb-2">
        <label className="relative block min-w-0 flex-1">
          <SearchIcon
            size={16}
            className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted"
          />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("voice.soundboard.search")}
            aria-label={t("voice.soundboard.search")}
            className="block h-10 w-full rounded-row border border-white/[0.07] bg-white/[0.03] pl-10 pr-3 text-[15px] outline-none transition-colors placeholder:text-faint focus:border-white/40"
          />
        </label>
        {(playing || listening) && (
          <button
            type="button"
            aria-label={t("voice.soundboard.stop")}
            title={t("voice.soundboard.stop")}
            onClick={() => {
              stopPreview();
              void stopMySounds();
            }}
            className="flex size-10 shrink-0 items-center justify-center rounded-row text-foreground outline-none transition-colors hover:bg-white/[0.08] focus-visible:ring-2 focus-visible:ring-focus"
          >
            <StopIcon size={16} />
          </button>
        )}
        <VolumeButton />
        <button
          type="button"
          aria-label={t("voice.soundboard.add")}
          title={t("voice.soundboard.add")}
          disabled={!canAdd}
          onClick={onAdd}
          className="flex size-10 shrink-0 items-center justify-center rounded-row text-muted outline-none transition-colors hover:bg-white/[0.08] hover:text-foreground focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-40"
        >
          <PlusIcon size={18} />
        </button>
      </div>
      <div className="flex">
        {sections.length > 0 && (
          <nav
            aria-label={t("voice.soundboard.label")}
            className="flex w-12 shrink-0 flex-col items-center gap-1 border-r border-white/[0.07] py-1 pl-2 pr-1.5"
          >
            {sections.map((s) => (
              <Tooltip key={s.id} delay={300} closeDelay={0}>
                <Tooltip.Trigger<'button'>
                  render={(props) => <button {...props} />}
                  type="button"
                  aria-label={s.title}
                  aria-current={active === s.id || undefined}
                  onClick={() => jump(s.id)}
                  className={`flex size-8 items-center justify-center rounded-tight outline-none transition-colors focus-visible:ring-2 focus-visible:ring-focus ${active === s.id ? "bg-white/[0.1] text-foreground" : "text-muted hover:bg-white/[0.05] hover:text-foreground"}`}
                >
                  {s.id === "favorites" ? (
                    <StarIcon size={18} />
                  ) : (
                    <SoundboardIcon size={18} />
                  )}
                </Tooltip.Trigger>
                <Tooltip.Content placement="right">{s.title}</Tooltip.Content>
              </Tooltip>
            ))}
          </nav>
        )}
        <div
          ref={list}
          onScroll={track}
          className="flex max-h-[min(400px,calc(100dvh-160px))] min-w-0 flex-1 flex-col gap-2 overflow-y-auto py-1 pl-2 pr-3 pb-3"
        >
          {loaded && !q && sounds.length === 0 && (
            <button
              type="button"
              onClick={onAdd}
              className="flex min-h-24 items-center justify-center gap-2 rounded-surface border border-dashed border-white/15 bg-white/[0.03] px-4 text-sm outline-none transition-colors hover:border-white/35 hover:bg-white/[0.06] focus-visible:ring-2 focus-visible:ring-focus"
            >
              <PlusIcon size={20} />
              {t("voice.soundboard.addFirst")}
            </button>
          )}
          {q && shown.length === 0 && (
            <p className="py-6 text-center text-[14px] text-muted">
              {t("voice.soundboard.none")}
            </p>
          )}
          {sections.map((s) => (
            <Section
              key={s.id}
              title={s.title}
              icon={
                s.id === "favorites" ? <StarFilledIcon size={12} /> : undefined
              }
              folded={folded.includes(s.id)}
              onToggle={() => fold(s.id)}
              headRef={(el) => {
                heads.current[s.id] = el;
              }}
            >
              {s.id === "favorites" ? favorite.map(tile) : shown.map(tile)}
            </Section>
          ))}
        </div>
      </div>
    </>
  );
}

/** A header that folds its sounds away, and the three-column grid under it. */
function Section({
  title,
  icon,
  folded,
  onToggle,
  headRef,
  children,
}: {
  title: string;
  icon?: ReactNode;
  folded: boolean;
  onToggle: () => void;
  headRef: (el: HTMLElement | null) => void;
  children: ReactNode;
}) {
  return (
    <section ref={headRef}>
      <button
        type="button"
        aria-expanded={!folded}
        onClick={onToggle}
        className="mb-1 flex h-7 max-w-full items-center gap-1.5 rounded-full pr-2 text-[13px] text-muted outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-focus"
      >
        <ChevronDownIcon
          size={14}
          className={`shrink-0 transition-transform ${folded ? "-rotate-90" : ""}`}
        />
        {icon}
        <span className="min-w-0 truncate">{title}</span>
      </button>
      {!folded && <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{children}</div>}
    </section>
  );
}

/** The speaker at the end of the search: a small popover with the soundboard's volume and mute. */
function VolumeButton() {
  const { t } = useT();
  const volume = useStore((s) => s.soundboard.volume);
  const muted = useStore((s) => s.soundboard.muted);
  const label = t("voice.soundboard.volume");
  return (
    <Popover>
      <Popover.Trigger
        aria-label={label}
        className={`flex size-10 shrink-0 items-center justify-center rounded-row outline-none transition-colors hover:bg-white/[0.08] hover:text-foreground aria-expanded:bg-white/[0.08] aria-expanded:text-foreground data-[focus-visible=true]:ring-2 data-[focus-visible=true]:ring-focus ${muted ? "text-foreground" : "text-muted"}`}
      >
        {muted ? <SpeakerSlashIcon size={18} /> : <SpeakerIcon size={18} />}
      </Popover.Trigger>
      <Popover.Content placement="bottom end" className="w-64">
        <Popover.Dialog
          aria-label={label}
          className="flex flex-col gap-5 p-5 outline-none"
        >
          <Slider
            value={volume}
            onChange={(v) =>
              setSoundboard({ volume: Array.isArray(v) ? v[0] : v })
            }
            minValue={0}
            maxValue={1}
            step={0.01}
            formatOptions={{ style: "percent" }}
            className="w-full"
          >
            <Label>{label}</Label>
            <Slider.Output />
            <Slider.Track>
              <Slider.Fill />
              <Slider.Thumb />
            </Slider.Track>
          </Slider>
          <Switch
            className="w-full"
            isSelected={muted}
            onChange={(value) => setSoundboard({ muted: value })}
          >
            <Switch.Content className="flex w-full items-center justify-between gap-3">
              <Label className="text-[14px] font-medium">
                {t("voice.soundboard.mute")}
              </Label>
              <Switch.Control className="shrink-0 [--switch-control-bg:rgb(255_255_255/0.16)]">
                <Switch.Thumb />
              </Switch.Control>
            </Switch.Content>
          </Switch>
        </Popover.Dialog>
      </Popover.Content>
    </Popover>
  );
}

const TILE_ACTION =
  "relative flex size-7 shrink-0 items-center justify-center rounded-full text-muted outline-none transition-colors hover:bg-white/10 hover:text-foreground focus-visible:ring-2 focus-visible:ring-focus";

/** Clicking the pill plays to the call. The headphones button previews or stops a local listen. */
function SoundTile({
  sound,
  favorite,
  playing,
  onEdit,
  onDelete,
}: {
  sound: Sound;
  favorite: boolean;
  playing: { at: number; duration: number } | null;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { t } = useT();
  const [menu, setMenu] = useState(false);
  const previewing = useStore((s) => s.previewing === sound.id);
  const star = favorite
    ? t("voice.soundboard.unfavorite")
    : t("voice.soundboard.favorite");
  const long = sound.durationMs > LONG_MS;
  const broadcast = t(playing ? "voice.soundboard.stopForCall" : "voice.soundboard.playForCall", { name: sound.name });
  const previewLabel = t(previewing ? "voice.soundboard.stopPreview" : "voice.soundboard.previewOnly", { name: sound.name });

  return (
    <div
      data-playing={playing ? "" : undefined}
      className="group/tile relative flex h-10 min-w-0 items-center overflow-hidden rounded-row bg-[color-mix(in_oklab,var(--overlay),white_6%)] transition-colors hover:bg-[color-mix(in_oklab,var(--overlay),white_11%)] data-[playing]:bg-[color-mix(in_oklab,var(--overlay),white_14%)] data-[playing]:shadow-[inset_0_0_0_1px_rgb(255_255_255/0.22)]"
      onContextMenu={(e) => {
        e.preventDefault();
        setMenu(true);
      }}
    >
      {playing && playing.duration > 0 && (
        <ClipProgress key={playing.at} {...playing} />
      )}
      <Tooltip delay={400} closeDelay={0}>
        <Tooltip.Trigger<'button'>
          render={(props) => <button {...props} />}
          type="button"
          aria-label={broadcast}
          onClick={() => {
            if (playing) void stopMySounds();
            else {
              stopPreview();
              void playSound(sound);
            }
          }}
          className="relative flex h-full min-w-0 flex-1 items-center gap-1.5 rounded-l-[12px] pl-2 pr-1 text-left text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus"
        >
          <span aria-hidden className="flex size-5 shrink-0 items-center justify-center text-[17px] leading-none">
            {playing ? <StopIcon size={13} /> : sound.emoji || <SoundboardIcon size={15} className="text-muted" />}
          </span>
          <span className="min-w-0 flex-1 truncate">{sound.name}</span>
          {long && <span className="shrink-0 text-[11px] text-muted">{clock(sound.durationMs)}</span>}
        </Tooltip.Trigger>
        <Tooltip.Content>{broadcast}</Tooltip.Content>
      </Tooltip>
      <button
        type="button"
        aria-label={star}
        aria-pressed={favorite}
        title={star}
        onClick={() => toggleFavorite(sound.id)}
        className={`${TILE_ACTION} opacity-0 group-hover/tile:opacity-100 group-focus-within/tile:opacity-100 [@media(hover:none)]:opacity-100`}
      >
        {favorite ? <StarFilledIcon size={14} /> : <StarIcon size={14} />}
      </button>
      <Tooltip delay={300} closeDelay={0}>
        <Tooltip.Trigger<'button'>
          render={(props) => <button {...props} />}
          type="button"
          aria-label={previewLabel}
          onClick={() => previewing ? stopPreview() : previewSound(sound)}
          className={`${TILE_ACTION} ${previewing ? "bg-white/10 text-foreground" : "opacity-0 group-hover/tile:opacity-100 group-focus-within/tile:opacity-100 [@media(hover:none)]:opacity-100"}`}
        >
          {previewing ? <StopIcon size={14} /> : <HeadphonesIcon size={16} />}
        </Tooltip.Trigger>
        <Tooltip.Content>{previewLabel}</Tooltip.Content>
      </Tooltip>
      <Dropdown isOpen={menu} onOpenChange={setMenu}>
        <Dropdown.Trigger aria-label={t("voice.soundboard.actions", { name: sound.name })} className={`${TILE_ACTION} absolute right-1 top-1.5 opacity-0 pointer-events-none focus-visible:z-10 focus-visible:opacity-100 focus-visible:pointer-events-auto [@media(hover:none)]:static [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100`}>
          <DotsVerticalIcon size={16} />
        </Dropdown.Trigger>
        <Dropdown.Popover placement="bottom end" className="min-w-48">
          <Dropdown.Menu
            aria-label={t("voice.soundboard.actions", { name: sound.name })}
            onAction={(key) => {
              if (key === "favorite") toggleFavorite(sound.id);
              if (key === "edit") onEdit();
              if (key === "delete") onDelete();
            }}
          >
            <MenuItem
              id="favorite"
              label={star}
              icon={
                favorite ? <StarFilledIcon size={16} /> : <StarIcon size={16} className="text-muted" />
              }
            />
            <MenuItem
              id="edit"
              label={t("voice.soundboard.edit")}
              icon={<PencilIcon size={16} />}
            />
            <Separator />
            <Dropdown.Item
              id="delete"
              textValue={t("voice.soundboard.delete")}
              variant="danger"
            >
              <Label>{t("voice.soundboard.delete")}</Label>
              <TrashIcon size={16} className="ml-auto text-danger" />
            </Dropdown.Item>
          </Dropdown.Menu>
        </Dropdown.Popover>
      </Dropdown>
    </div>
  );
}

function ClipProgress({ at, duration }: { at: number; duration: number }) {
  const [elapsed] = useState(() => Math.max(0, Date.now() - at));
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 origin-left bg-white/[0.16] motion-reduce:hidden"
      style={{
        animation: `sound-fill ${duration}ms linear forwards`,
        animationDelay: `-${elapsed}ms`,
      }}
    />
  );
}

function MenuItem({
  id,
  label,
  icon,
}: {
  id: string;
  label: string;
  icon: ReactNode;
}) {
  return (
    <Dropdown.Item id={id} textValue={label}>
      <Label>{label}</Label>
      <span className="ml-auto text-muted">{icon}</span>
    </Dropdown.Item>
  );
}

/**
 * Adding a clip (a file, a name that starts as the file's, an emoji, the volume) or, with `sound`, changing one that
 * is there (no file: the clip itself stays). "Listen" plays it here only, the file straight from the disk.
 */
function SoundDialog({
  sound,
  onClose,
  onSaved,
}: {
  sound?: Sound;
  onClose: () => void;
  /** Saved: the window closes for good, unlike cancel, the cross or Esc. */
  onSaved?: () => void;
}) {
  const { t } = useT();
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [wave, setWave] = useState<{ durationMs: number; peaks: number[]; coveredMs: number } | null>(null);
  /** The part of the picked file that will be kept, in ms (start, end). */
  const [segment, setSegment] = useState<[number, number]>([0, 0]);
  const [name, setName] = useState(sound?.name ?? "");
  const [named, setNamed] = useState(false);
  const [emoji, setEmoji] = useState(sound?.emoji ?? "");
  const [volume, setVolume] = useState(sound?.volume ?? 1);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const check = useRef<AbortController>(null);
  const saving = useRef(false);
  const playing = useStore((state) => state.previewing === (sound?.id ?? ""));
  const local = useRef<{ file: File; url: string } | null>(null);
  // Whether this window started a preview: closing it (cancel, the cross, Esc, a finished upload) ends that preview.
  const listened = useRef<ReturnType<typeof previewSound> | null>(null);

  function endListening() {
    listened.current?.stop();
    listened.current = null;
  }

  useEffect(
    () => () => {
      check.current?.abort();
      listened.current?.stop();
      if (local.current) URL.revokeObjectURL(local.current.url);
    },
    [],
  );

  const label = name.trim();
  const ready = !!label && !busy && (sound ? true : !!file && !!wave && !fileError && !checking);

  async function pick(picked?: File) {
    if (!picked || saving.current) return;
    endListening();
    check.current?.abort();
    const controller = new AbortController();
    check.current = controller;
    if (local.current) URL.revokeObjectURL(local.current.url);
    local.current = null;
    setFile(picked);
    setFileError(null);
    setWave(null);
    setChecking(true);
    if (!named) setName(picked.name.replace(/\.[^.]*$/, "").slice(0, MAX_NAME));
    try {
      const result = await inspectSoundFile(picked, controller.signal);
      if (controller.signal.aborted) return;
      if (result.error !== undefined) setFileError(result.error);
      else {
        setWave({ durationMs: result.durationMs, ...result.waveform });
        setSegment([0, Math.min(result.durationMs, MAX_SEGMENT)]);
      }
    } catch {
      if (!controller.signal.aborted) setFileError(t("voice.sound.notAudio"));
    } finally {
      if (!controller.signal.aborted) setChecking(false);
    }
  }

  function listen(range = segment) {
    if (sound) {
      listened.current = previewSound({ ...sound, volume });
      return;
    }
    if (!file || !wave || fileError || saving.current) return;
    if (local.current?.file !== file) {
      if (local.current) URL.revokeObjectURL(local.current.url);
      local.current = { file, url: URL.createObjectURL(file) };
    }
    listened.current = previewSound(
      {
        id: "",
        userId: "",
        name,
        emoji,
        volume,
        createdAt: 0,
        durationMs: wave.durationMs,
        url: local.current.url,
      },
      { fromMs: range[0], toMs: range[1] },
      wave.durationMs > LONG_MS,
    );
  }

  function togglePreview() {
    if (playing) endListening();
    else listen();
  }

  async function submit() {
    if (!ready || saving.current) return;
    saving.current = true;
    endListening();
    setBusy(true);
    const ok = sound
      ? await editSound(sound.id, { name: label, emoji, volume })
      : !!file && (await addSound(file, label, emoji, volume, { fromMs: segment[0], toMs: segment[1] }));
    if (ok) (onSaved ?? onClose)();
    else {
      saving.current = false;
      setBusy(false);
    }
  }

  return (
    <Dialog
      title={
        sound ? t("voice.soundboard.editTitle") : t("voice.soundboard.newTitle")
      }
      onClose={onClose}
      isBusy={busy}
      onFileDrop={sound ? undefined : pick}
      footer={
        <>
          <Quiet onClick={onClose} disabled={busy}>{t("common.cancel")}</Quiet>
          <Primary
            onPress={submit}
            isDisabled={!ready}
            isPending={busy}
            className="whitespace-nowrap md:rounded-full!"
          >
            {sound ? t("common.save") : t("voice.soundboard.upload")}
          </Primary>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <fieldset disabled={busy} className="flex min-w-0 flex-col gap-5">
          {!sound && (
            <div>
              <div className="flex items-center gap-3">
                <Secondary onPress={() => input.current?.click()} isDisabled={busy} className="whitespace-nowrap">
                  {t("voice.soundboard.pick")}
                </Secondary>
                {file && <span className="min-w-0 flex-1 truncate text-[14px]" title={file.name}>{file.name}</span>}
              </div>
              {fileError && <p role="alert" className="mt-2 text-[13px] text-danger">{fileError}</p>}
              <input
                ref={input}
                type="file"
                accept="audio/*"
                hidden
                onChange={(event) => {
                  const selected = event.currentTarget.files?.[0];
                  event.currentTarget.value = "";
                  void pick(selected);
                }}
              />
            </div>
          )}
          {checking && (
            <div role="status" aria-label={t("voice.soundboard.reading")} className="grid h-16 place-items-center rounded-row bg-[#18181b]">
              <Spinner size="sm" color="current" />
            </div>
          )}
          {wave && (
            <SoundTrim
              duration={wave.durationMs}
              peaks={wave.peaks}
              coveredMs={wave.coveredMs}
              segment={segment}
              playing={playing}
              preview={listened}
              disabled={busy}
              onChange={setSegment}
              onReplay={listen}
              onToggle={togglePreview}
              onStop={endListening}
            />
          )}
          {(sound || wave) && (
            <>
              <label className="block">
                <span className={fieldLabel}>{t("voice.soundboard.name")}</span>
                <input
                  autoFocus={!!sound}
                  value={name}
                  maxLength={MAX_NAME}
                  onChange={(e) => {
                    setName(e.target.value);
                    setNamed(true);
                  }}
                  className={field}
                />
              </label>
              <div>
                <span className={fieldLabel}>{t("voice.soundboard.emoji")}</span>
                <div className="flex items-center gap-2">
                  <EmojiPicker
                    label={t("voice.soundboard.emojiPick")}
                    onPick={(value) => { if (!saving.current) setEmoji(value); }}
                    className="flex size-[46px] shrink-0 items-center justify-center rounded-row border border-white/[0.07] bg-white/[0.03] text-[22px] outline-none transition-colors hover:border-white/20 aria-expanded:border-white/40 data-[focus-visible=true]:border-white/40"
                  >
                    {emoji || <SmileIcon size={20} className="text-muted" />}
                  </EmojiPicker>
                  {emoji && (
                    <Quiet onClick={() => setEmoji("")}>
                      {t("voice.soundboard.emojiClear")}
                    </Quiet>
                  )}
                </div>
              </div>
              <Slider
                value={volume}
                isDisabled={busy}
                onChange={(v) => {
                  const next = Array.isArray(v) ? v[0] : v;
                  setVolume(next);
                  listened.current?.setVolume(next);
                }}
                minValue={0}
                maxValue={1}
                step={0.01}
                formatOptions={{ style: "percent" }}
                className="thin-slider w-full"
              >
                <Label>{t("voice.soundboard.soundVolume")}</Label>
                <Slider.Output />
                <Slider.Track>
                  <Slider.Fill />
                  <Slider.Thumb />
                </Slider.Track>
              </Slider>
              {sound && (
                <div>
                  <Secondary onPress={togglePreview} isDisabled={busy} className="whitespace-nowrap">
                    {playing ? <StopIcon size={12} /> : <PlayIcon size={12} />}
                    {t(playing ? "voice.soundboard.stop" : "voice.soundboard.preview")}
                  </Secondary>
                </div>
              )}
            </>
          )}
        </fieldset>
      </form>
    </Dialog>
  );
}

/**
 * A small soundboard glyph by someone who has just played a clip (the sidebar's room list, the call's tiles): it
 * fades in and out once, no loop. Gone for good once its time is up, and nothing for a play older than the mount.
 */
export function SoundPlayedMark({
  userId,
  size = 16,
  className = "",
}: {
  userId: string;
  size?: number;
  className?: string;
}) {
  const { t } = useT();
  const at = useStore((s) => s.soundPlays[userId]);
  const [mountedAt] = useState(Date.now);
  const [done, setDone] = useState(0);

  useEffect(() => {
    if (at === undefined) return;
    const left = at + PLAYED_FOR - Date.now();
    if (left <= 0) {
      setDone(at);
      return;
    }
    const id = setTimeout(() => setDone(at), left);
    return () => clearTimeout(id);
  }, [at]);

  if (at === undefined || at + PLAYED_FOR <= mountedAt || done === at)
    return null;
  return (
    <span
      key={at}
      role="img"
      aria-label={t("voice.soundboard.playing")}
      className={`inline-flex shrink-0 animate-[sound-played_2.5s_ease-out_forwards] ${className}`}
    >
      <SoundboardIcon size={size} />
    </span>
  );
}
