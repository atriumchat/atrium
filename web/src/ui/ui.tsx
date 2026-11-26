import { useState, type ReactNode } from 'react';
import { Button, Label, Slider, Tooltip } from '@heroui/react';
import { useT } from '../i18n';
import { getUserVolume, setUserVolume, toggleUserMute } from '../voice/devices';

type Placement = 'top' | 'bottom' | 'left' | 'right';

const SIZES = {
  sm: 'h-9 w-9 min-w-9 [&_svg]:size-[18px]',
  md: 'h-10 w-10 min-w-10 [&_svg]:size-5',
  lg: 'h-12 w-12 min-w-12 [&_svg]:size-6',
} as const;

/**
 * Round icon button with a tooltip.
 * tone: "plain" = grey fill, "ghost" = no fill until hover, "on" = white fill (toggled), "accent", "danger".
 * `alert` paints the icon red (muted mic / deafened).
 */
export function RoundButton(props: {
  label: string;
  onPress: () => void;
  children: ReactNode;
  tone?: 'plain' | 'ghost' | 'on' | 'accent' | 'danger';
  alert?: boolean;
  size?: keyof typeof SIZES;
  isDisabled?: boolean;
  placement?: Placement;
  className?: string;
}) {
  const tone = props.tone ?? 'plain';
  const variant = tone === 'accent' ? 'primary' : tone === 'danger' ? 'danger' : tone === 'ghost' ? 'ghost' : 'tertiary';
  const toneClass =
    tone === 'on'
      ? '[--button-bg:white] [--button-bg-hover:#e7e7ea] [--button-fg:#0b0b0c]'
      : tone === 'ghost'
        ? '[--button-fg:var(--foreground)]'
        : tone === 'danger'
          ? 'text-white [--button-fg:white]'
          : '';
  return (
    <Tooltip delay={300} closeDelay={0}>
      <Button
        isIconOnly
        variant={variant}
        aria-label={props.label}
        aria-pressed={tone === 'on' ? true : undefined}
        isDisabled={props.isDisabled}
        onPress={props.onPress}
        className={`rounded-full p-0 ${SIZES[props.size ?? 'md']} ${toneClass} ${props.alert ? 'text-danger' : ''} ${props.className ?? ''}`}
      >
        {props.children}
      </Button>
      <Tooltip.Content placement={props.placement ?? 'top'}>{props.label}</Tooltip.Content>
    </Tooltip>
  );
}

/** Per-person playback volume, 0–200%. */
export function VolumeSlider({ userId, name, showMute = false }: { userId: string; name: string; showMute?: boolean }) {
  const { t } = useT();
  const [value, setValue] = useState(() => getUserVolume(userId));
  return (
    <div className="flex w-full flex-col gap-3">
      <Slider
        value={value}
        onChange={(v) => {
          const next = Array.isArray(v) ? v[0] : v;
          setValue(next);
          setUserVolume(userId, next);
        }}
        minValue={0}
        maxValue={2}
        step={0.01}
        formatOptions={{ style: 'percent' }}
        className="w-full"
      >
        <Label>{showMute ? t('voice.userVolume') : t('common.volume', { name })}</Label>
        <Slider.Output />
        <Slider.Track>
          <Slider.Fill />
          {showMute && <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-1/2 z-10 w-px bg-foreground/60 mix-blend-difference" />}
          <Slider.Thumb />
        </Slider.Track>
      </Slider>
      {showMute && (
        <button type="button" className="rounded-row px-2 py-2 text-left text-sm outline-none hover:bg-default focus-visible:ring-2 focus-visible:ring-focus"
          onClick={() => setValue(toggleUserMute(userId))}>
          {t(value === 0 ? 'voice.userUnmute' : 'voice.userMute')}
        </button>
      )}
    </div>
  );
}
