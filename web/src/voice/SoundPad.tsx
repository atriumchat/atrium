import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
} from "react";
import {
  Dropdown,
  Label,
  Popover,
  Separator,
  Slider,
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
  checkSoundFile,
  editSound,
  loadMySounds,
  playSound,
  previewSound,
  removeSound,
  setSoundboard,
  soundFileDuration,
  stopMySounds,
  toggleFavorite,
} from "./soundboard";

const MAX_SOUNDS = 20;
const MAX_NAME = 32;
/** How long the mark stays by someone who played a clip; the fade in index.css (sound-played) runs as long. */
const PLAYED_FOR = 2500;
/** Clips longer than this show their length on the pill. */
const LONG_MS = 10_000;
const MAX_MS = 60_000;

function clock(ms: number) {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

type DialogState =
  | { kind: "add" }
  | { kind: "edit"; sound: Sound }
  | { kind: "delete"; sound: Sound }
  | null;

// The same two faces as the neighbours: the 40px pill in the call panel, the labelled 44px button in the call controls.
const BUTTON = {
  panel:
    "flex h-10 w-full items-center justify-center rounded-full bg-default text-foreground [&_svg]:size-5",
  control:
    "flex h-11 items-center gap-2 whitespace-nowrap rounded-full bg-default px-3.5 text-[15px] font-medium text-foreground @[640px]:px-4",
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
}: {
  look: keyof typeof BUTTON;
  disabled?: boolean;
}) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [dialog, setDialog] = useState<DialogState>(null);
  const label = t("voice.soundboard.label");

  function show(next: NonNullable<DialogState>) {
    setOpen(false);
    setDialog(next);
  }
  function hide() {
    setDialog(null);
    setOpen(true);
  }

  const face = (
    <>
      <SoundboardIcon size={look === "control" ? 18 : 20} />
      {look === "control" && (
        <span className="hidden @[800px]:inline">{label}</span>
      )}
    </>
  );
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
    <Popover isOpen={open} onOpenChange={setOpen}>
      <Popover.Trigger
        aria-label={label}
        className={`${BUTTON[look]} ${BUTTON_ENABLED}`}
      >
        {face}
      </Popover.Trigger>
      <Popover.Content
        placement={look === "panel" ? "top start" : "top"}
        className="w-[min(420px,calc(100vw-16px))]"
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
      {look === "panel" && !disabled ? (
        <Tooltip delay={300} closeDelay={0}>
          <Tooltip.Trigger>{trigger}</Tooltip.Trigger>
          <Tooltip.Content>{label}</Tooltip.Content>
        </Tooltip>
      ) : (
        trigger
      )}
      {dialog?.kind === "add" && <SoundDialog onClose={hide} />}
      {dialog?.kind === "edit" && (
        <SoundDialog sound={dialog.sound} onClose={hide} />
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
  const [query, setQuery] = useState("");
  const [folded, setFolded] = useState<SectionId[]>([]);
  const [current, setCurrent] = useState<SectionId>("favorites");
  const list = useRef<HTMLDivElement>(null);
  const heads = useRef<Partial<Record<SectionId, HTMLElement | null>>>({});
  const q = query.trim().toLowerCase();
  const shown = q
    ? sounds.filter((s) => s.name.toLowerCase().includes(q))
    : sounds;
  const favorite = shown.filter((s) => favorites.includes(s.id));
  const canAdd = !q && sounds.length < MAX_SOUNDS;

  const sections: { id: SectionId; title: string }[] = [];
  if (favorite.length > 0)
    sections.push({ id: "favorites", title: t("voice.soundboard.favorites") });
  if (shown.length > 0 || canAdd)
    sections.push({ id: "mine", title: t("voice.soundboard.mine") });
  const active = sections.some((s) => s.id === current)
    ? current
    : sections[0]?.id;

  useEffect(() => {
    void loadMySounds();
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
      behavior: "smooth",
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
            className="block h-10 w-full rounded-[12px] border border-white/[0.07] bg-white/[0.03] pl-10 pr-3 text-[15px] outline-none transition-colors placeholder:text-faint focus:border-white/40"
          />
        </label>
        {playing && (
          <button
            type="button"
            aria-label={t("voice.soundboard.stop")}
            title={t("voice.soundboard.stop")}
            onClick={() => void stopMySounds()}
            className="flex size-10 shrink-0 items-center justify-center rounded-[12px] text-foreground outline-none transition-colors hover:bg-white/[0.08] focus-visible:ring-2 focus-visible:ring-focus"
          >
            <StopIcon size={16} />
          </button>
        )}
        <VolumeButton />
      </div>
      <div className="flex">
        {sections.length > 0 && (
          <nav
            aria-label={t("voice.soundboard.label")}
            className="flex w-12 shrink-0 flex-col items-center gap-1 border-r border-white/[0.07] py-1 pl-2 pr-1.5"
          >
            {sections.map((s) => (
              <Tooltip key={s.id} delay={300} closeDelay={0}>
                <Tooltip.Trigger>
                  <button
                    type="button"
                    aria-label={s.title}
                    aria-current={active === s.id || undefined}
                    onClick={() => jump(s.id)}
                    className={`flex size-8 items-center justify-center rounded-[10px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-focus ${active === s.id ? "bg-white/[0.1] text-foreground" : "text-muted hover:bg-white/[0.05] hover:text-foreground"}`}
                  >
                    {s.id === "favorites" ? (
                      <StarIcon size={18} />
                    ) : (
                      <SoundboardIcon size={18} />
                    )}
                  </button>
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
              {s.id === "mine" && canAdd && (
                <button
                  type="button"
                  onClick={onAdd}
                  className="flex h-10 w-full items-center justify-center gap-1.5 whitespace-nowrap rounded-[12px] border border-dashed border-white/20 px-2 text-[13px] text-muted outline-none transition-colors hover:border-white/40 hover:text-foreground focus-visible:ring-2 focus-visible:ring-focus"
                >
                  <PlusIcon size={14} className="shrink-0" />
                  <span className="min-w-0 truncate">
                    {t("voice.soundboard.add")}
                  </span>
                </button>
              )}
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
      {!folded && <div className="grid grid-cols-3 gap-1.5">{children}</div>}
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
        className={`flex size-10 shrink-0 items-center justify-center rounded-[12px] outline-none transition-colors hover:bg-white/[0.08] hover:text-foreground aria-expanded:bg-white/[0.08] aria-expanded:text-foreground data-[focus-visible=true]:ring-2 data-[focus-visible=true]:ring-focus ${muted ? "text-foreground" : "text-muted"}`}
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
  "flex size-6 items-center justify-center rounded-full text-muted outline-none transition-[background-color,color,opacity] hover:bg-white/10 hover:text-foreground focus-visible:ring-2 focus-visible:ring-focus";
// Shown on hover and for the keyboard; on a touch screen only the "…" stays, and it holds the rest.
const REVEAL =
  "opacity-0 pointer-fine:group-hover:opacity-100 group-has-[:focus-visible]:opacity-100";
const CONCEAL =
  "pointer-fine:group-hover:opacity-0 group-has-[:focus-visible]:opacity-0";

/**
 * One clip as a 40px pill: the emoji, then the name on one line (the tooltip has all of it). A click plays it for the
 * call; while it plays (`playing`) a fill sweeps across the pill over the clip's length. On hover the emoji turns
 * into a play glyph (listening, only you hear it) and the star and "…" show at the right end; a right-click opens
 * the same menu with edit and delete. The buttons sit beside the pill's own button, not in it.
 */
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
  // The full name as a tooltip only when the pill cuts it short.
  const nameRef = useRef<HTMLSpanElement>(null);
  const [truncated, setTruncated] = useState(false);
  const star = favorite
    ? t("voice.soundboard.unfavorite")
    : t("voice.soundboard.favorite");
  const long = sound.durationMs > LONG_MS;
  const toggle = () => void (playing ? stopMySounds() : playSound(sound));

  return (
    <div
      data-playing={playing ? "" : undefined}
      className="group relative h-10 overflow-hidden rounded-[12px] bg-[color-mix(in_oklab,var(--overlay),white_6%)] transition-colors hover:bg-[color-mix(in_oklab,var(--overlay),white_11%)] data-[playing]:bg-[color-mix(in_oklab,var(--overlay),white_14%)] data-[playing]:shadow-[inset_0_0_0_1px_rgb(255_255_255/0.22)]"
      onContextMenu={(e) => {
        e.preventDefault();
        setMenu(true);
      }}
    >
      {playing && (
        <span
          key={playing.at}
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 origin-left bg-white/[0.16]"
          style={{
            animation:
              playing.duration > 0
                ? `sound-fill ${playing.duration}ms linear forwards`
                : "sound-pulse 450ms ease-out forwards",
          }}
        />
      )}
      <Tooltip delay={400} closeDelay={0} isDisabled={!truncated}>
        {/* The trigger is a wrapper of its own: without the pill's size the button inside collapses to its text. */}
        <Tooltip.Trigger className="block h-full w-full">
          <button
            type="button"
            onClick={toggle}
            onPointerEnter={() => setTruncated(!!nameRef.current && nameRef.current.scrollWidth > nameRef.current.clientWidth)}
            className={`relative flex h-full w-full items-center rounded-[12px] pl-[38px] pr-3 text-left text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus pointer-coarse:pr-8 ${menu ? "pr-8" : "pointer-fine:group-hover:pr-8 group-has-[:focus-visible]:pr-8"}`}
          >
            <span ref={nameRef} className="min-w-0 truncate">
              {sound.name}
            </span>
            {long && (
              // On hover the menu's dots take the end of the pill: the length steps aside.
              <span className={`ml-auto shrink-0 pl-2 text-[11px] text-muted pointer-coarse:hidden ${menu ? "hidden" : "pointer-fine:group-hover:hidden group-has-[:focus-visible]:hidden"}`}>
                {clock(sound.durationMs)}
              </span>
            )}
          </button>
        </Tooltip.Trigger>
        <Tooltip.Content>{sound.name}</Tooltip.Content>
      </Tooltip>
      <button
        type="button"
        aria-label={
          playing ? t("voice.soundboard.stop") : t("voice.soundboard.preview")
        }
        onClick={() => (playing ? void stopMySounds() : previewSound(sound))}
        className="absolute left-1 top-1 flex size-8 items-center justify-center rounded-full outline-none transition-colors hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-focus pointer-coarse:pointer-events-none"
      >
        {playing ? (
          <StopIcon size={14} />
        ) : (
          <>
            <span
              className={`flex items-center justify-center text-[17px] leading-none transition-opacity ${CONCEAL}`}
            >
              {sound.emoji || (
                <SoundboardIcon size={16} className="text-muted" />
              )}
            </span>
            <span
              className={`absolute flex items-center justify-center transition-opacity ${REVEAL}`}
            >
              <PlayIcon size={13} />
            </span>
          </>
        )}
      </button>
      <Dropdown isOpen={menu} onOpenChange={setMenu}>
        <Dropdown.Trigger
          aria-label={t("voice.soundboard.actions", { name: sound.name })}
          // On hover with a mouse (right-click opens it too); a finger gets it always.
          className={`${TILE_ACTION} absolute right-1 top-2 pointer-coarse:opacity-100 ${menu ? "opacity-100" : REVEAL}`}
        >
          <DotsVerticalIcon size={16} />
        </Dropdown.Trigger>
        <Dropdown.Popover placement="bottom end" className="min-w-48">
          <Dropdown.Menu
            aria-label={t("voice.soundboard.actions", { name: sound.name })}
            onAction={(key) => {
              if (key === "preview") previewSound(sound);
              if (key === "favorite") toggleFavorite(sound.id);
              if (key === "edit") onEdit();
              if (key === "delete") onDelete();
            }}
          >
            <MenuItem
              id="preview"
              label={t("voice.soundboard.preview")}
              icon={<PlayIcon size={16} />}
            />
            <MenuItem
              id="favorite"
              label={star}
              icon={
                favorite ? <StarFilledIcon size={16} /> : <StarIcon size={16} />
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
}: {
  sound?: Sound;
  onClose: () => void;
}) {
  const { t } = useT();
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [fileMs, setFileMs] = useState<number | null>(null);
  const [name, setName] = useState(sound?.name ?? "");
  const [named, setNamed] = useState(false);
  const [emoji, setEmoji] = useState(sound?.emoji ?? "");
  const [volume, setVolume] = useState(sound?.volume ?? 1);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const checkId = useRef(0);
  const local = useRef<{ file: File; url: string } | null>(null);

  useEffect(
    () => () => {
      if (local.current) URL.revokeObjectURL(local.current.url);
    },
    [],
  );

  const label = name.trim();
  const ready =
    !!label && !busy && (sound ? true : !!file && !fileError && !checking);

  async function pick(e: ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0];
    e.target.value = "";
    if (!picked) return;
    const id = ++checkId.current;
    setFile(picked);
    setFileError(null);
    setFileMs(null);
    setChecking(true);
    if (!named) setName(picked.name.replace(/\.[^.]*$/, "").slice(0, MAX_NAME));
    const problem = await checkSoundFile(picked);
    if (id !== checkId.current) return;
    const ms = problem ? null : await soundFileDuration(picked);
    if (id !== checkId.current) return;
    setFileError(problem);
    setFileMs(ms);
    setChecking(false);
  }

  function listen() {
    if (sound) {
      previewSound({ ...sound, volume });
      return;
    }
    if (!file || fileError) return;
    if (local.current?.file !== file) {
      if (local.current) URL.revokeObjectURL(local.current.url);
      local.current = { file, url: URL.createObjectURL(file) };
    }
    previewSound({
      id: "",
      userId: "",
      name,
      emoji,
      volume,
      createdAt: 0,
      durationMs: fileMs ?? 0,
      url: local.current.url,
    });
  }

  async function submit() {
    if (!ready) return;
    setBusy(true);
    const ok = sound
      ? await editSound(sound.id, { name: label, emoji, volume })
      : !!file && (await addSound(file, label, emoji, volume));
    if (ok) onClose();
    else setBusy(false);
  }

  return (
    <Dialog
      title={
        sound ? t("voice.soundboard.editTitle") : t("voice.soundboard.newTitle")
      }
      onClose={onClose}
      footer={
        <>
          <Quiet onClick={onClose}>{t("common.cancel")}</Quiet>
          <Primary
            onPress={submit}
            isDisabled={!ready}
            isPending={busy}
            className="whitespace-nowrap"
          >
            {sound ? t("common.save") : t("voice.soundboard.upload")}
          </Primary>
        </>
      }
    >
      <form
        className="flex flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {!sound && (
          <div>
            <span className={fieldLabel}>{t("voice.soundboard.file")}</span>
            <div className="flex items-center gap-3">
              <Secondary
                onPress={() => input.current?.click()}
                className="whitespace-nowrap"
              >
                {t("voice.soundboard.pick")}
              </Secondary>
              <span
                className={`min-w-0 flex-1 truncate text-[14px] ${file ? "" : "text-muted"}`}
              >
                {file ? file.name : t("voice.soundboard.noFile")}
              </span>
            </div>
            <p
              className={`mt-2 text-[13px] ${fileError ? "text-danger" : "text-muted"}`}
            >
              {fileError ?? t("voice.soundboard.limits")}
            </p>
            {!fileError && fileMs !== null && fileMs > MAX_MS && (
              <p className="mt-1 text-[13px] text-muted">
                {t("voice.soundboard.trimmed")}
              </p>
            )}
            <input
              ref={input}
              type="file"
              accept="audio/*"
              hidden
              onChange={pick}
            />
          </div>
        )}
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
              onPick={setEmoji}
              className="flex size-[46px] shrink-0 items-center justify-center rounded-[12px] border border-white/[0.07] bg-white/[0.03] text-[22px] outline-none transition-colors hover:border-white/20 aria-expanded:border-white/40 data-[focus-visible=true]:border-white/40"
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
          onChange={(v) => setVolume(Array.isArray(v) ? v[0] : v)}
          minValue={0}
          maxValue={1}
          step={0.01}
          formatOptions={{ style: "percent" }}
          className="w-full"
        >
          <Label>{t("voice.soundboard.soundVolume")}</Label>
          <Slider.Output />
          <Slider.Track>
            <Slider.Fill />
            <Slider.Thumb />
          </Slider.Track>
        </Slider>
        <div>
          <Secondary
            onPress={listen}
            isDisabled={!sound && (!file || !!fileError || checking)}
            className="whitespace-nowrap"
          >
            <PlayIcon size={12} />
            {t("voice.soundboard.preview")}
          </Secondary>
        </div>
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
