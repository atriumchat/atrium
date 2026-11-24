import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { Tooltip } from '@heroui/react';
import { detectPlatform } from '../account/WhereToUse';
import { useT } from '../i18n';
import { dmTitle, openDm, selectChannel, useStore } from '../store';
import { Dialog } from '../ui/Dialog';
import { DmAvatar } from '../ui/DmAvatar';
import { HashIcon, HashLockIcon, SearchIcon, SpeakerIcon, SpeakerLockIcon } from '../ui/icons';

export function QuickSwitchButton({ onPress }: { onPress: () => void }) {
  const { t } = useT();
  const shortcut = detectPlatform() === 'mac' ? '⌘K' : 'Ctrl+K';
  return (
    <Tooltip delay={0} closeDelay={0}>
      <Tooltip.Trigger<'button'>
        render={(attributes) => <button {...attributes} type="button" />}
        aria-label={t('shell.switch.title')}
        aria-keyshortcuts="Meta+K Control+K"
        aria-haspopup="dialog"
        onClick={onPress}
        className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-default text-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-focus"
      >
        <SearchIcon size={21} />
      </Tooltip.Trigger>
      <Tooltip.Content placement="right">
        {t('shell.switch.title')} <kbd className="ml-1 text-muted">{shortcut}</kbd>
      </Tooltip.Content>
    </Tooltip>
  );
}

export function QuickSwitch({ onClose }: { onClose: () => void }) {
  const { t } = useT();
  const channels = useStore((s) => s.channels);
  const categories = useStore((s) => s.categories);
  const dms = useStore((s) => s.dms);
  const users = useStore((s) => s.users);
  const meId = useStore((s) => s.me?.id);
  const recent = useStore((s) => s.recentConversations);
  const [query, setQuery] = useState('');
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const normalized = query.trim().toLowerCase();
  const targets = [
    ...channels.map((channel) => {
      const voice = channel.kind === 'voice';
      const Icon = voice ? (channel.private ? SpeakerLockIcon : SpeakerIcon) : (channel.private ? HashLockIcon : HashIcon);
      return {
        kind: 'channel' as const,
        id: channel.id,
        key: `channel:${channel.id}`,
        title: channel.name,
        description: [t(voice ? 'shell.switch.voice' : 'shell.switch.channel'), categories.find((c) => c.id === channel.categoryId)?.name].filter(Boolean).join(' · '),
        icon: <Icon size={19} className="text-muted" />,
      };
    }),
    ...dms.map((dm) => ({
      kind: 'dm' as const,
      id: dm.id,
      key: `dm:${dm.id}`,
      title: dmTitle(dm, users, meId),
      description: t(dm.kind === 'group' ? 'shell.switch.group' : 'shell.switch.dm'),
      icon: <DmAvatar dm={dm} size={26} ringBg="var(--overlay)" />,
    })),
  ];
  const visible = normalized
    ? targets
        .filter(({ title }) => title.toLowerCase().includes(normalized))
        .sort((a, b) => Number(b.title.toLowerCase().startsWith(normalized)) - Number(a.title.toLowerCase().startsWith(normalized)))
    : recent.flatMap(({ kind, id }) => targets.find((item) => item.kind === kind && item.id === id) ?? []).slice(0, 8);
  const activeIndex = Math.max(0, visible.findIndex(({ key }) => key === activeKey));
  const active = visible[activeIndex];
  const activeId = active ? `${listId}-${activeIndex}` : undefined;

  useEffect(() => {
    // Let the dialog record the previously focused control before moving focus to search.
    const frame = requestAnimationFrame(() => input.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (activeId) document.getElementById(activeId)?.scrollIntoView({ block: 'nearest' });
  }, [activeId]);

  function choose(item: (typeof targets)[number]) {
    const { channels, dms } = useStore.getState();
    const current = item.kind === 'channel' ? channels : dms;
    if (!current.some(({ id }) => id === item.id)) return;
    if (item.kind === 'channel') selectChannel(item.id);
    else openDm(item.id);
    onClose();
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing || !active) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActiveKey(visible[(activeIndex + step + visible.length) % visible.length].key);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      choose(active);
    }
  }

  const listLabel = t(normalized ? 'shell.switch.results' : 'shell.switch.recent');
  return (
    <Dialog title={t('shell.switch.title')} onClose={onClose}>
      <label className="flex h-10 shrink-0 items-center gap-2.5 rounded-full bg-default px-4 text-muted focus-within:ring-2 focus-within:ring-focus">
        <SearchIcon size={17} />
        <input
          ref={input}
          data-initial-focus
          role="combobox"
          aria-autocomplete="list"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={activeId}
          aria-label={t('shell.switch.placeholder')}
          placeholder={t('shell.switch.placeholder')}
          autoComplete="off"
          value={query}
          onChange={(event) => { setQuery(event.target.value); setActiveKey(null); }}
          onKeyDown={onKeyDown}
          className="min-w-0 flex-1 bg-transparent text-[16px] text-foreground outline-none placeholder:text-muted"
        />
      </label>
      {visible.length > 0 && <p className="mt-3 px-2 text-[13px] text-muted">{listLabel}</p>}
      <ul id={listId} aria-label={listLabel} role="listbox" className="mt-1.5 max-h-[min(40vh,320px)] overflow-y-auto">
        {visible.map((item, index) => (
          <li
            id={`${listId}-${index}`}
            key={item.key}
            role="option"
            aria-selected={index === activeIndex}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => choose(item)}
            className="flex min-h-11 cursor-pointer items-center gap-2.5 rounded-row px-2.5 hover:bg-default/60 aria-selected:bg-default"
          >
            <span className="flex w-7 shrink-0 items-center justify-center" aria-hidden>{item.icon}</span>
            <span className="min-w-0 flex-1 truncate">{item.title}</span>
            <span className="max-w-[45%] truncate text-right text-[13px] text-muted">{item.description}</span>
          </li>
        ))}
      </ul>
      {visible.length === 0 && (
        <p role="status" className="py-3 text-center text-muted">{t(normalized ? 'shell.switch.emptyResults' : 'shell.switch.emptyRecent')}</p>
      )}
    </Dialog>
  );
}
