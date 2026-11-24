import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Button } from '@heroui/react';
import { api, ApiError, type SearchHit } from '../api';
import { dmTitle, getNavigationRevision, getSessionEpoch, openDm, selectChannel, setVoiceChat, useStore } from '../store';
import { localeOf, useT } from '../i18n';
import { Dialog } from '../ui/Dialog';
import { MagnifyingGlassIcon, XMarkIcon } from '@heroicons/react/24/solid';
import { plainText } from '../ui/Markdown';
import { fullStamp } from './format';
import { emptySearchFilters, SearchFilterMenu } from './SearchFilters';
import { SidePanel } from '../shell/SidePanel';
import { useIsMobile } from '../hooks';

const SIDE_PANEL = '(min-width: 76rem)';
const searchTrigger = '[data-message-search-trigger]';

const isWide = () => window.matchMedia(SIDE_PANEL).matches;
function subscribeWidth(onChange: () => void) {
  const query = window.matchMedia(SIDE_PANEL);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

const initialFilters = { words: '', ...emptySearchFilters };
type Filters = typeof initialFilters;
type SearchState = {
  open: boolean;
  editing: boolean;
  wide: boolean;
  panelId: string;
  filters: Filters;
  draft: Filters;
  setDraft: (filters: Filters) => void;
  show: () => void;
  hideEditor: () => void;
  submit: (filters: Filters) => void;
  close: (afterJump?: boolean) => void;
  dismiss: () => void;
};
const SearchContext = createContext<SearchState | null>(null);

export function useMessageSearch() {
  return useContext(SearchContext);
}

function lastTrigger() {
  return [...document.querySelectorAll<HTMLElement>(searchTrigger)].filter((el) => el.getClientRects().length).at(-1);
}

/** Keep the filters above the keyed conversations so a search can lead to several chats in a row. */
export function MessageSearchProvider({ children }: { children: ReactNode }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(initialFilters);
  const [filters, setFilters] = useState(initialFilters);
  const isMobile = useIsMobile();
  const wide = useSyncExternalStore(subscribeWidth, isWide);
  const panelId = useId();
  const returnToRoom = useRef<string | null>(null);
  const focusFrame = useRef(0);

  function show() {
    cancelAnimationFrame(focusFrame.current);
    setEditing(true);
  }

  function submit(next: Filters) {
    if (!hasQuery(next)) {
      if (open) close();
      return;
    }
    const { mode, voiceChatOpen, selectedChannelId, channels } = useStore.getState();
    if (!isMobile && mode === 'server' && voiceChatOpen &&
      channels.some((channel) => channel.id === selectedChannelId && channel.kind === 'voice')) {
      returnToRoom.current = selectedChannelId;
      setVoiceChat(false);
    }
    setDraft(next);
    setFilters(next);
    setEditing(false);
    setOpen(true);
    if (isMobile) (document.activeElement as HTMLElement | null)?.blur();
  }

  const hideEditor = useCallback(() => setEditing(false), []);

  const dismiss = useCallback(() => {
    returnToRoom.current = null;
    setOpen(false);
    setEditing(false);
    cancelAnimationFrame(focusFrame.current);
  }, []);

  function close(afterJump = false) {
    const { mode, selectedChannelId } = useStore.getState();
    const restoreRoomChat = !afterJump && mode === 'server' && returnToRoom.current === selectedChannelId && selectedChannelId !== null;
    dismiss();
    if (restoreRoomChat) setVoiceChat(true);
    focusFrame.current = requestAnimationFrame(() => lastTrigger()?.focus());
  }

  useEffect(() => () => cancelAnimationFrame(focusFrame.current), []);

  useEffect(() => useStore.subscribe((state, previous) => {
    if (state.isMobile || state.mode !== 'server' || !state.voiceChatOpen) return;
    if (previous.voiceChatOpen && previous.mode === state.mode &&
      previous.isMobile === state.isMobile && previous.selectedChannelId === state.selectedChannelId) return;
    if (state.channels.some((channel) => channel.id === state.selectedChannelId && channel.kind === 'voice')) dismiss();
  }), [dismiss]);

  useEffect(() => {
    function onShortcut(event: KeyboardEvent) {
      if (event.defaultPrevented || event.repeat || event.isComposing || event.altKey || !event.shiftKey || event.metaKey === event.ctrlKey) return;
      if (event.key.toLowerCase() !== 'f' && event.code !== 'KeyF') return;
      if (document.querySelector('[aria-modal="true"], [data-slot="modal-dialog"], [data-slot="drawer-dialog"], [data-slot="alert-dialog-dialog"]')) return;
      const trigger = lastTrigger();
      if (!trigger) return;
      event.preventDefault();
      trigger.click();
    }
    window.addEventListener('keydown', onShortcut);
    return () => window.removeEventListener('keydown', onShortcut);
  }, []);

  return <SearchContext.Provider value={{ open, editing, wide, panelId, filters, draft, setDraft, show, hideEditor, submit, close, dismiss }}>
    {children}
    {open && isMobile && <Dialog title={t('chat.search.title')} onClose={() => close()} sheet>
      <div id={panelId} data-message-search-panel="">
        <SearchBody />
      </div>
    </Dialog>}
  </SearchContext.Provider>;
}

function hasQuery({ words, author, conversation, file, link }: Filters) {
  return Boolean(words.trim() || author || conversation || file || link);
}

export function MessageSearchButton({ className = '', shortLabel = false }: { className?: string; shortLabel?: boolean }) {
  const { t, lang } = useT();
  const search = useContext(SearchContext);
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const advanced = useRef(false);
  const users = useStore((s) => s.users);
  const channels = useStore((s) => s.channels);
  const dms = useStore((s) => s.dms);
  const me = useStore((s) => s.me?.id);
  const focusField = () => input.current?.focus({ preventScroll: true });

  const editing = search?.editing;
  const hideEditor = search?.hideEditor;
  useEffect(() => {
    if (!editing || !hideEditor) {
      advanced.current = false;
      return;
    }
    const hide = (event: PointerEvent) => {
      if (advanced.current || !(event.target instanceof Node) || root.current?.contains(event.target)) return;
      hideEditor();
    };
    document.addEventListener('pointerdown', hide);
    return () => document.removeEventListener('pointerdown', hide);
  }, [editing, hideEditor]);

  if (!search) return null;
  const draft = search.draft;
  const active = search.editing || search.open;
  const filterCount = Object.values({ author: draft.author, conversation: draft.conversation, file: draft.file, link: draft.link }).filter(Boolean).length;
  const menuId = `${search.panelId}-filters`;
  const authors = search.editing ? Object.values(users)
    .sort((a, b) => a.name.localeCompare(b.name, localeOf(lang))).map(({ id, name }) => ({ id, label: name })) : [];
  const conversations = search.editing ? [
    ...channels.map(({ id, name }) => ({ id, label: `#${name}` })),
    ...dms.map((dm) => ({ id: dm.id, label: dmTitle(dm, users, me) })),
  ] : [];

  return (
    <div ref={root} className={`relative shrink-0 ${className}`} onBlur={(event) => {
      const next = event.relatedTarget;
      if (search.editing && !advanced.current && next instanceof Node && !event.currentTarget.contains(next)) search.hideEditor();
    }} onKeyDown={(event) => {
      if (advanced.current || event.defaultPrevented || event.nativeEvent.isComposing ||
        !(event.target instanceof Node) || !event.currentTarget.contains(event.target)) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        if (search.editing) {
          search.hideEditor();
          requestAnimationFrame(() => root.current?.querySelector<HTMLElement>(searchTrigger)?.focus());
        } else if (search.open) search.close();
      }
    }}>
      {active ? (
        <div className="flex h-(--app-header-control) w-[min(14rem,38cqw)] min-w-24 items-center gap-2 rounded-control-sm bg-default px-3 focus-within:ring-1 focus-within:ring-focus">
          <input
            ref={input}
            autoFocus={search.editing}
            type="search"
            role="combobox"
            aria-haspopup="dialog"
            enterKeyHint="search"
            maxLength={256}
            data-message-search-trigger=""
            data-message-search-input=""
            aria-label={t('chat.search.words')}
            aria-keyshortcuts="Control+Shift+F Meta+Shift+F"
            aria-expanded={search.editing}
            aria-controls={search.editing ? menuId : undefined}
            placeholder={t('chat.search.short')}
            value={draft.words}
            className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted [&::-webkit-search-cancel-button]:appearance-none"
            onClick={() => { search.show(); focusField(); }}
            onChange={(event) => {
              search.setDraft({ ...draft, words: event.target.value });
              search.show();
            }}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing || event.defaultPrevented) return;
              if (event.key === 'Enter') {
                event.preventDefault();
                search.submit(draft);
              } else if (event.key === 'ArrowDown') {
                event.preventDefault();
                search.show();
                requestAnimationFrame(() => root.current?.querySelector<HTMLElement>('[role="dialog"] button')?.focus());
              }
            }}
          />
          {filterCount > 0 && <span className="shrink-0 text-xs text-muted" title={t('chat.search.filters')}>{filterCount}</span>}
          <MagnifyingGlassIcon className="size-4 shrink-0 text-muted" aria-hidden="true" />
        </div>
      ) : (
        <button
          type="button"
          title={t('chat.search.title')}
          aria-label={t('chat.search.title')}
          aria-keyshortcuts="Control+Shift+F Meta+Shift+F"
          aria-expanded="false"
          data-message-search-trigger=""
          className="header-action header-search"
          onClick={search.show}
        >
          <MagnifyingGlassIcon className="shrink-0" aria-hidden="true" />
          <span aria-hidden="true" className="hidden whitespace-nowrap @min-[35rem]/chat-header:inline">{t(shortLabel ? 'chat.search.short' : 'chat.search.title')}</span>
        </button>
      )}
      {search.editing && (
        <SearchFilterMenu
          id={menuId}
          words={draft.words}
          canSearch={hasQuery(draft)}
          filters={{ author: draft.author, conversation: draft.conversation, file: draft.file, link: draft.link }}
          authors={authors}
          conversations={conversations}
          onChange={(next) => search.setDraft({ ...draft, ...next })}
          onSubmit={(next) => search.submit({ ...draft, ...next })}
          focusField={focusField}
          onAdvancedChange={(value) => { advanced.current = value; }}
        />
      )}
    </div>
  );
}

export function MessageSearchPanel() {
  const { t } = useT();
  const search = useContext(SearchContext);
  const isMobile = useIsMobile();
  if (!search?.open || isMobile) return null;
  return <SidePanel
    layout={search.wide ? 'docked' : 'responsive'}
    kind="search"
    onClose={() => search.close()}
    id={search.panelId}
    title={t('chat.search.title')}
    data-message-search-panel=""
    actions={<button type="button" className="header-action" aria-label={t('common.close')} onClick={() => search.close()}><XMarkIcon aria-hidden="true" /></button>}
    onKeyDown={(event) => {
      if (event.key === 'Escape' && !event.defaultPrevented && !event.nativeEvent.isComposing &&
        event.target instanceof Node && event.currentTarget.contains(event.target)) {
        event.preventDefault();
        event.stopPropagation();
        search.close();
      }
    }}
  >
    <SearchBody />
  </SidePanel>;
}

function SearchBody() {
  const { t } = useT();
  const isMobile = useIsMobile();
  const { filters, close } = useContext(SearchContext)!;
  const users = useStore((s) => s.users);
  const channels = useStore((s) => s.channels);
  const dms = useStore((s) => s.dms);
  const me = useStore((s) => s.me?.id);
  const { words, author, conversation, file, link } = filters;

  const params = new URLSearchParams();
  if (words.trim()) params.set('q', words.trim());
  if (author) params.set('author', author);
  if (conversation) params.set('conversation', conversation);
  if (file) params.set('file', 'true');
  if (link) params.set('link', 'true');

  const scope = new Map([
    ...channels.map((c) => [c.id, '#' + c.name] as const),
    ...dms.map((d) => [d.id, dmTitle(d, users, me)] as const),
  ]);
  return (
    <div className={isMobile ? '' : 'min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 py-2'}>
      {params.size ? <Results key={params.toString()} query={params.toString()} scope={scope} onJump={() => { if (isMobile) close(true); }} />
        : <p className="px-2 text-sm text-muted">{t('chat.search.hint')}</p>}
    </div>
  );
}

function Results({ query, scope, onJump }: { query: string; scope: Map<string, string>; onJump: () => void }) {
  const { t } = useT();
  const users = useStore((s) => s.users);
  const blocked = useStore((s) => s.blocked);
  const [items, setItems] = useState<SearchHit[]>([]);
  const [cursor, setCursor] = useState<SearchHit>();
  const [retry, setRetry] = useState(0);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [failed, setFailed] = useState(false);
  const [opening, setOpening] = useState(false);
  const [selected, setSelected] = useState<string>();
  const [jumpError, setJumpError] = useState('');
  const active = useRef(false);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams(query);
    if (cursor) {
      params.set('before', String(cursor.createdAt));
      params.set('beforeId', cursor.id);
    }
    const timer = window.setTimeout(() => {
      api.searchMessages(params, controller.signal).then((page) => {
        if (controller.signal.aborted) return;
        setItems((prev) => cursor ? [...prev, ...page] : page);
        setMore(page.length === 40);
        setLoading(false);
      }, () => {
        if (!controller.signal.aborted) { setFailed(true); setLoading(false); }
      });
    }, cursor ? 0 : 180);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, cursor, retry]);

  async function jump(hit: SearchHit) {
    if (opening) return;
    setOpening(true);
    setJumpError('');
    const epoch = getSessionEpoch();
    const navigation = getNavigationRevision();
    const current = () => active.current && epoch === getSessionEpoch() && navigation === getNavigationRevision();
    try {
      const context = await api.messageContext(hit.id);
      if (!current()) return;
      if (hit.dm) openDm(hit.channelId);
      else {
        selectChannel(hit.channelId);
        if (useStore.getState().channels.some((c) => c.id === hit.channelId && c.kind === 'voice')) setVoiceChat(true);
      }
      const cached = useStore.getState().messages[hit.channelId]?.some((m) => m.id === hit.id);
      useStore.setState({ jumpTo: hit.id, searchContext: cached ? null : { conversation: hit.channelId, messages: context } });
      setSelected(hit.id);
      onJump();
    } catch (error) {
      if (current()) setJumpError(error instanceof ApiError && error.status === 404 ? t('chat.search.gone') : t('chat.loadFailed', { error: error instanceof Error ? error.message : String(error) }));
    } finally {
      if (active.current) setOpening(false);
    }
  }

  const visible = items.filter((item) => !blocked.includes(item.userId) && scope.has(item.channelId));
  return <div className="space-y-1 pb-2" aria-busy={loading}>
    {visible.map((item) => <button
      key={item.id}
      type="button"
      aria-disabled={opening || undefined}
      aria-current={selected === item.id || undefined}
      onClick={() => void jump(item)}
      className="block w-full cursor-pointer rounded-row px-2 py-2.5 text-left hover:bg-default focus-visible:outline-2 focus-visible:outline-focus aria-current:bg-default"
    >
      <span className="block truncate text-[13px] font-medium">{users[item.userId]?.name} · {scope.get(item.channelId)}</span>
      <span className="block truncate text-xs text-muted">{fullStamp(item.createdAt)}</span>
      <span className="mt-1 line-clamp-2 break-words text-sm">{plainText(item.content, users) || t('chat.search.attachments', { n: item.fileCount })}</span>
    </button>)}
    <p className="px-2 text-sm text-muted empty:hidden" role="status">
      {jumpError || (opening ? t('chat.search.opening') : failed ? t('chat.search.failed') : loading ? t('chat.search.loading') : !visible.length ? t('chat.search.empty') : '')}
    </p>
    {!loading && (failed || more) && <Button size="sm" variant="tertiary" className="ml-3 mt-2 rounded-full" onPress={() => {
      setLoading(true);
      if (failed) { setFailed(false); setRetry((value) => value + 1); }
      else setCursor(items.at(-1));
    }}>{t(failed ? 'chat.search.retry' : 'chat.search.more')}</Button>}
  </div>;
}
