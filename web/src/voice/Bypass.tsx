import { useState } from 'react';
import { Button, Label, Popover, Switch } from '@heroui/react';
import { useStore } from '../store';
import { setBypass } from './voice';
import { useBadConnection, type CallStats } from './stats';
import { SignalIcon, XIcon } from '../ui/icons';
import { useT } from '../i18n';

const QUALITY = {
  good: { color: 'text-success', label: 'voice.quality.good' },
  fair: { color: 'text-warning', label: 'voice.quality.fair' },
  bad: { color: 'text-danger', label: 'voice.quality.bad' },
  unknown: { color: 'text-success', label: 'voice.quality.unknown' },
} as const;

/** The signal bars, coloured by how the call is going; a click shows the ping and the bypass switch, as in Discord. */
export function CallQuality({ stats, connected }: { stats: CallStats | null; connected: boolean }) {
  const { t } = useT();
  const quality = QUALITY[stats?.quality ?? 'unknown'];
  return (
    <Popover>
      <Popover.Trigger
        aria-label={t('voice.quality.label')}
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full outline-none hover:bg-white/10 ${connected ? quality.color : 'text-warning'}`}
      >
        <SignalIcon size={18} />
      </Popover.Trigger>
      <Popover.Content placement="top start" className="w-72">
        <Popover.Dialog aria-label={t('voice.quality.label')} className="p-5">
          <div className="flex items-baseline justify-between gap-4">
            <span className="text-[15px] font-medium">{t('voice.ping')}</span>
            <span className="text-[15px] font-medium tabular-nums">{stats?.rtt !== undefined ? t('voice.ms', { value: stats.rtt }) : '—'}</span>
          </div>
          <p className={`text-[13px] ${connected ? quality.color : 'text-warning'}`}>{connected ? t(quality.label) : t('voice.quality.connecting')}</p>
          <div className="mt-3 border-t-[0.5px] border-separator pt-3">
            <BypassSwitch />
          </div>
        </Popover.Dialog>
      </Popover.Content>
    </Popover>
  );
}

/** Relay-only mode: every call goes only through our relay on 443, the path that holds on the most restrictive networks. */
export function BypassSwitch() {
  const { t } = useT();
  const on = useStore((s) => s.serverRelayOnly || s.voicePrefs.relayOnly);
  const forced = useStore((s) => s.serverRelayOnly);
  const [busy, setBusy] = useState(false);
  return (
    <Switch
      className="w-full"
      isSelected={on}
      isDisabled={forced || busy}
      onChange={async (value) => {
        setBusy(true);
        await setBypass(value);
        setBusy(false);
      }}
    >
      <Switch.Content className="flex w-full items-center justify-between gap-3">
        <span className="min-w-0">
          <Label className="text-[14px] font-medium max-md:text-[16px] max-md:font-normal">{t('voice.antiLag')}</Label>
          <span className="block text-[13px] leading-snug text-muted">
            {forced ? t('voice.antiLag.forced') : t('voice.antiLag.hint')}
          </span>
        </span>
        {/* Off, the track is a white tint: graphite would vanish in the phone's graphite cards. */}
        <Switch.Control className="shrink-0 [--switch-control-bg:rgb(255_255_255/0.16)]">
          <Switch.Thumb />
        </Switch.Control>
      </Switch.Content>
    </Switch>
  );
}

/**
 * Offered when the call has stayed bad for a few seconds and anti-lag is off: one tap to switch it on.
 * Closing it hides it until the next call.
 */
export function BypassHint({ stats }: { stats: CallStats | null }) {
  const { t } = useT();
  const bad = useBadConnection(stats);
  const on = useStore((s) => s.serverRelayOnly || s.voicePrefs.relayOnly);
  const joinedAt = useStore((s) => s.joinedAt);
  const [dismissedFor, setDismissedFor] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  if (!bad || on || dismissedFor === joinedAt) return null;
  return (
    <div className="mt-2 flex items-center gap-2 rounded-[14px] bg-danger/10 py-1.5 pl-3 pr-1.5">
      <span className="min-w-0 flex-1 text-[13px] leading-snug text-danger">{t('voice.quality.bad')}</span>
      <Button
        size="sm"
        isPending={busy}
        onPress={async () => {
          setBusy(true);
          await setBypass(true);
          setBusy(false);
        }}
        className="h-8 shrink-0 rounded-full px-3 text-[13px] [--button-bg:white] [--button-bg-hover:#e7e7ea] [--button-fg:#0b0b0c]"
      >
        {t('voice.antiLag.enable')}
      </Button>
      <button onClick={() => setDismissedFor(joinedAt)} aria-label={t('voice.notNow')} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted hover:text-foreground">
        <XIcon size={14} />
      </button>
    </div>
  );
}
