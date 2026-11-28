import { useState, type ReactNode } from 'react';
import { Button, Label, ListBox, Select } from '@heroui/react';
import {
  AdjustmentsHorizontalIcon, ArrowLeftIcon, CheckIcon, ChevronDownIcon, ChevronRightIcon,
  HashtagIcon, LinkIcon, MagnifyingGlassIcon, PaperClipIcon, UserIcon, XMarkIcon,
} from '@heroicons/react/24/solid';
import { useT } from '../i18n';
import { Dialog } from '../ui/Dialog';

export const emptySearchFilters = { author: '', conversation: '', file: false, link: false };
type SearchFilters = typeof emptySearchFilters;
type Choice = { id: string; label: string };
type FilterPage = 'author' | 'conversation' | 'content';
type ContentFilter = 'file' | 'link';

const contentKeys = ['file', 'link'] as const;
const isContentFilter = (id: string): id is ContentFilter => id === 'file' || id === 'link';
const choiceRow = 'min-h-9 rounded-row px-2 focus:outline-none';
const rowButton = 'h-auto min-h-10 w-full justify-start gap-2 rounded-row px-2 text-left text-sm';

export function SearchFilterMenu({ id, words, canSearch, filters, authors, conversations, onChange, onSubmit, focusField, onAdvancedChange }: {
  id: string;
  words: string;
  canSearch: boolean;
  filters: SearchFilters;
  authors: Choice[];
  conversations: Choice[];
  onChange: (filters: SearchFilters) => void;
  onSubmit: (filters: SearchFilters) => void;
  focusField: () => void;
  onAdvancedChange: (open: boolean) => void;
}) {
  const { t } = useT();
  const [page, setPage] = useState<FilterPage | null>(null);
  const [query, setQuery] = useState('');
  const [advanced, setAdvanced] = useState(false);
  const names = {
    author: t('chat.search.filterAuthor'),
    conversation: t('chat.search.filterConversation'),
    content: t('chat.search.filterContent'),
  };
  const sources = {
    author: [{ id: '', label: t('chat.search.author') }, ...authors],
    conversation: [{ id: '', label: t('chat.search.conversation') }, ...conversations],
  };
  const authorLabel = authors.find(({ id }) => id === filters.author)?.label;
  const conversationLabel = conversations.find(({ id }) => id === filters.conversation)?.label;
  const active: { key: keyof SearchFilters; text: string; icon: ReactNode }[] = [];
  if (filters.author) active.push({ key: 'author', text: authorLabel ?? names.author, icon: <UserIcon /> });
  if (filters.conversation) active.push({ key: 'conversation', text: conversationLabel ?? names.conversation, icon: <HashtagIcon /> });
  if (filters.file) active.push({ key: 'file', text: t('chat.search.file'), icon: <PaperClipIcon /> });
  if (filters.link) active.push({ key: 'link', text: t('chat.search.link'), icon: <LinkIcon /> });

  function choosePage(next: FilterPage | null) {
    setQuery('');
    setPage(next);
  }

  function closeAdvanced() {
    setAdvanced(false);
    onAdvancedChange(false);
    requestAnimationFrame(focusField);
  }

  const filterMenu = [
    { id: 'author', icon: <UserIcon />, value: authorLabel },
    { id: 'conversation', icon: <HashtagIcon />, value: conversationLabel },
    { id: 'content', icon: <PaperClipIcon />, value: contentKeys.filter((key) => filters[key]).map((key) => t(`chat.search.${key}`)).join(' · ') },
  ] as const;

  return (
    <>
      <section id={id} role="dialog" aria-label={t('chat.search.filters')} className={`absolute right-0 top-full z-40 mt-2 w-72 max-w-[calc(100vw-32px)] rounded-popover border border-edge bg-overlay p-2 shadow-xl ${advanced ? 'hidden' : ''}`}>
        {canSearch && (
          <Button variant="tertiary" className={`${rowButton} mb-1`} onPress={() => onSubmit(filters)}>
            <MagnifyingGlassIcon className="size-[18px] shrink-0 text-muted" aria-hidden="true" />
            <span className="min-w-0 truncate">{words.trim() ? t('chat.search.runWords', { query: words.trim() }) : t('chat.search.run')}</span>
          </Button>
        )}
        {page === null ? (
          <>
            {active.length > 0 && (
            <div className="flex flex-wrap gap-1.5 px-1 py-1">
              {active.map(({ key, text, icon }) => (
                <button
                  key={key}
                  type="button"
                  aria-label={t('chat.search.removeFilter', { name: text })}
                  className="flex min-w-0 max-w-full items-center gap-1.5 rounded-full bg-default px-2 py-1.5 text-xs hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-focus"
                  onClick={() => {
                    onChange({ ...filters, [key]: emptySearchFilters[key] });
                    focusField();
                  }}
                >
                  <span className="shrink-0 text-muted [&_svg]:size-3.5" aria-hidden="true">{icon}</span>
                  <span className="min-w-0 truncate">{text}</span>
                  <XMarkIcon className="size-3.5 shrink-0 text-muted" aria-hidden="true" />
                </button>
              ))}
            </div>
          )}
          <h3 className="px-2 pb-1 pt-2 text-xs font-medium text-muted">{t('chat.search.filters')}</h3>
            {filterMenu.map(({ id, icon, value }) => (
              <Button key={id} variant="ghost" className={rowButton} onPress={() => choosePage(id)}>
                <span className="shrink-0 text-muted [&_svg]:size-[18px]" aria-hidden="true">{icon}</span>
                <span className="min-w-0 flex-1 py-1.5">
                  <span className="block">{names[id]}</span>
                  {value && <span className="block truncate text-xs text-muted">{value}</span>}
                </span>
                <ChevronRightIcon className="size-4 shrink-0 text-muted" aria-hidden="true" />
              </Button>
            ))}
            <Button variant="ghost" className={rowButton} onPress={() => { setAdvanced(true); onAdvancedChange(true); }}>
              <AdjustmentsHorizontalIcon className="size-[18px] text-muted" aria-hidden="true" />
              {t('chat.search.moreFilters')}
            </Button>
          </>
        ) : (
          <>
            <div className="mb-1 flex items-center gap-1">
              <button type="button" className="header-action" aria-label={t('common.back')} onClick={() => choosePage(null)}>
                <ArrowLeftIcon aria-hidden="true" />
              </button>
              <h3 className="text-sm font-medium">{names[page]}</h3>
            </div>
            {page === 'content' ? (
              <ContentChoices filters={filters} onChange={onChange} />
            ) : (
              <>
                <input
                  autoFocus
                  type="search"
                  value={query}
                  aria-label={t(page === 'author' ? 'chat.search.findAuthor' : 'chat.search.findConversation')}
                  placeholder={t('chat.search.short')}
                  className="mb-1 h-9 w-full rounded-row bg-default px-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-focus"
                  onChange={(event) => setQuery(event.target.value)}
                />
                <ListBox aria-label={names[page]} className="max-h-60 gap-0.5 overflow-y-auto" onAction={(key) => {
                  onChange({ ...filters, [page]: key === 'all' ? '' : String(key) });
                  choosePage(null);
                  focusField();
                }} renderEmptyState={() => <p className="px-2 py-2 text-sm text-muted">{t('chat.search.noFilterChoices')}</p>}>
                  {sources[page].filter(({ label }) => label.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())).map(({ id, label }) => (
                    <ListBox.Item key={id || 'all'} id={id || 'all'} textValue={label} className={choiceRow}>
                      <Label className="min-w-0 flex-1 truncate">{label}</Label>
                      {filters[page] === id && <CheckIcon className="size-4 shrink-0" aria-hidden="true" />}
                    </ListBox.Item>
                  ))}
                </ListBox>
              </>
            )}
          </>
        )}
      </section>
      {advanced && (
        <MoreFilters
          filters={filters}
          authorChoices={sources.author}
          conversationChoices={sources.conversation}
          onClose={closeAdvanced}
          onApply={(next) => {
            closeAdvanced();
            onChange(next);
            onSubmit(next);
          }}
        />
      )}
    </>
  );
}

function ContentChoices({ filters, onChange }: { filters: SearchFilters; onChange: (filters: SearchFilters) => void }) {
  const { t } = useT();
  return (
    <ListBox
      aria-label={t('chat.search.filterContent')}
      selectionMode="multiple"
      selectionBehavior="toggle"
      selectedKeys={contentKeys.filter((key) => filters[key])}
      className="gap-0.5"
      onSelectionChange={(selection) => {
        const keys = selection === 'all' ? contentKeys : [...selection].map(String).filter(isContentFilter);
        onChange({ ...filters, file: keys.includes('file'), link: keys.includes('link') });
      }}
    >
      {contentKeys.map((key) => (
        <ListBox.Item key={key} id={key} textValue={t(`chat.search.${key}`)} className={choiceRow}>
          {key === 'file' ? <PaperClipIcon className="size-4 text-muted" aria-hidden="true" /> : <LinkIcon className="size-4 text-muted" aria-hidden="true" />}
          <Label className="flex-1">{t(`chat.search.${key}`)}</Label>
          {filters[key] && <CheckIcon className="size-4 shrink-0" aria-hidden="true" />}
        </ListBox.Item>
      ))}
    </ListBox>
  );
}

function MoreFilters({ filters, authorChoices, conversationChoices, onClose, onApply }: {
  filters: SearchFilters;
  authorChoices: Choice[];
  conversationChoices: Choice[];
  onClose: () => void;
  onApply: (filters: SearchFilters) => void;
}) {
  const { t } = useT();
  const [draft, setDraft] = useState(filters);
  const changed = Object.keys(emptySearchFilters).some((key) => draft[key as keyof SearchFilters] !== filters[key as keyof SearchFilters]);
  return (
    <Dialog
      title={t('chat.search.moreFilters')}
      onClose={onClose}
      sheet
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          <Button variant="ghost" size="sm" isDisabled={!Object.values(draft).some(Boolean)} onPress={() => setDraft(emptySearchFilters)}>{t('chat.search.resetFilters')}</Button>
          <div className="flex gap-2">
            <Button variant="tertiary" size="sm" onPress={onClose}>{t('common.cancel')}</Button>
            <Button size="sm" isDisabled={!changed} onPress={() => onApply(draft)}>{t('chat.search.applyFilters')}</Button>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <FilterSelect label={t('chat.search.filterAuthor')} value={draft.author} options={authorChoices} onChange={(author) => setDraft({ ...draft, author })} />
        <FilterSelect label={t('chat.search.filterConversation')} value={draft.conversation} options={conversationChoices} onChange={(conversation) => setDraft({ ...draft, conversation })} />
        <section className="flex flex-col gap-1.5">
          <h3 className="text-sm font-medium">{t('chat.search.filterContent')}</h3>
          <div className="rounded-row border border-edge p-1">
            <ContentChoices filters={draft} onChange={setDraft} />
          </div>
        </section>
      </div>
    </Dialog>
  );
}

function FilterSelect({ label, value, options, onChange }: { label: string; value: string; options: Choice[]; onChange: (value: string) => void }) {
  return (
    <Select value={value || 'all'} variant="secondary" onChange={(key) => {
      if (typeof key === 'string') onChange(key === 'all' ? '' : key);
    }}>
      <Label className="text-sm font-medium">{label}</Label>
      <Select.Trigger className="flex h-10 w-full min-w-0 items-center gap-2 rounded-row border border-edge px-2.5">
        <Select.Value className="min-w-0 truncate">{({ selectedText }) => selectedText}</Select.Value>
        <ChevronDownIcon className="size-4 shrink-0 text-muted" aria-hidden="true" />
      </Select.Trigger>
      <Select.Popover className="max-w-[calc(100vw-24px)]">
        <ListBox className="max-h-60 gap-0.5 overflow-y-auto p-2">
          {options.map(({ id, label: item }) => (
            <ListBox.Item key={id || 'all'} id={id || 'all'} textValue={item} className={choiceRow}>
              <Label className="min-w-0 flex-1 truncate">{item}</Label>
              {value === id && <CheckIcon className="size-4 shrink-0" aria-hidden="true" />}
            </ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
    </Select>
  );
}
