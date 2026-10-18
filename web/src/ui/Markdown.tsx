import { Fragment, useState, type ReactNode } from 'react';
import { t, useT } from '../i18n';
import { useStore } from '../store';
import type { User } from '../types';

/**
 * Discord-style message formatting, parsed by hand into React elements (never HTML):
 * ```code blocks``` with light highlighting, > quotes, **bold**, *italic* / _italic_, __underline__,
 * ~~strike~~, ||spoilers||, `inline code`, links, and mentions stored as <@id> / <@all>.
 */

const MENTION = /<@([0-9a-f]{32}|all)>/g;
/** A voice room, stored as <#id>: alone in a message it's an invitation card (RoomCard), in text a name. */
const ROOM = /<#([0-9a-f]{32})>/g;

export function roomToken(channelId: string) {
  return `<#${channelId}>`;
}

/** The room a message invites to, when the message is just the room. */
export function invitedRoom(text: string): string | null {
  return /^<#([0-9a-f]{32})>$/.exec(text.trim())?.[1] ?? null;
}

function roomName(id: string) {
  return useStore.getState().channels.find((c) => c.id === id)?.name ?? t('common.md.deletedRoom');
}

/** Mentions as the people read them: "@Mike", "@everyone". */
export function mentionsToNames(text: string, users: Record<string, User>) {
  return text.replace(MENTION, (_, id: string) => (id === 'all' ? `@${t('common.md.everyone')}` : `@${users[id]?.name ?? t('common.md.someone')}`));
}

/** One line of plain text for previews and notifications: names instead of ids, no formatting marks. */
export function plainText(text: string, users: Record<string, User>) {
  const room = invitedRoom(text);
  if (room) return t('common.md.roomInvite', { name: roomName(room) });
  return mentionsToNames(text, users)
    .replace(ROOM, (_, id: string) => roomName(id))
    .replace(/```[\w-]*\n?/g, '')
    .replace(/(\*\*|__|~~|\|\||`)/g, '')
    .replace(/^> /gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** "@Name" typed in the composer becomes <@id> on the wire; longest names first, so "@Ann Lee" wins over "@Ann". */
export function namesToMentions(text: string, users: Record<string, User>) {
  let out = text.replace(/@(все|everyone)(?![\p{L}\p{N}_])/giu, '<@all>');
  const list = Object.values(users).sort((a, b) => b.name.length - a.name.length);
  for (const u of list) {
    const escaped = u.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(`@${escaped}(?![\\p{L}\\p{N}_])`, 'gu'), `<@${u.id}>`);
  }
  return out;
}

/** `after` goes right after the last word (e.g. "(edited)"), not on a line of its own. */
export function Markdown({ text, big = false, after }: { text: string; big?: boolean; after?: ReactNode }) {
  const blocks = splitBlocks(text);
  return (
    <div className={`whitespace-pre-wrap break-words text-foreground/90 ${big ? 'text-[44px] leading-[52px]' : 'text-[16px] leading-[22px]'}`}>
      {blocks.map((b, i) =>
        b.kind === 'code' ? (
          <CodeBlock key={i} code={b.text} lang={b.lang} />
        ) : b.kind === 'quote' ? (
          <blockquote key={i} className="my-0.5 border-l-[3px] border-white/25 pl-3 text-foreground/80">
            {inline(b.text, `q${i}`)}
          </blockquote>
        ) : (
          <Fragment key={i}>{inline(b.text, `p${i}`)}</Fragment>
        ),
      )}
      {after}
    </div>
  );
}

type Block = { kind: 'text' | 'quote'; text: string } | { kind: 'code'; text: string; lang: string };

function splitBlocks(text: string): Block[] {
  const out: Block[] = [];
  const fence = /```([\w-]*)\n?([\s\S]*?)```/g;
  let last = 0;
  for (const m of text.matchAll(fence)) {
    if (m.index! > last) out.push(...textBlocks(text.slice(last, m.index)));
    out.push({ kind: 'code', lang: m[1].toLowerCase(), text: m[2].replace(/\n$/, '') });
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push(...textBlocks(text.slice(last)));
  return out;
}

/** Runs of "> " lines become quotes; everything else stays text with its line breaks. */
function textBlocks(text: string): Block[] {
  const out: Block[] = [];
  for (const line of text.split('\n')) {
    const quote = /^>\s?(.*)$/.exec(line);
    const kind = quote ? 'quote' : 'text';
    const body = quote ? quote[1] : line;
    const prev = out[out.length - 1];
    if (prev && prev.kind === kind) prev.text += `\n${body}`;
    else out.push({ kind, text: body });
  }
  // Text right after a code block shouldn't start with the fence's line break.
  return out.map((b, i) => (i === 0 && b.kind === 'text' ? { ...b, text: b.text.replace(/^\n/, '') } : b)).filter((b) => b.kind !== 'text' || b.text !== '');
}

const INLINE: { re: RegExp; render: (m: RegExpExecArray, key: string) => ReactNode }[] = [
  { re: /`([^`\n]+)`/, render: (m, key) => <code key={key} className="rounded-[6px] bg-white/10 px-1.5 py-0.5 font-mono text-[0.88em]">{m[1]}</code> },
  { re: /<@([0-9a-f]{32}|all)>/, render: (m, key) => <Mention key={key} id={m[1]} /> },
  { re: /<#([0-9a-f]{32})>/, render: (m, key) => <RoomName key={key} id={m[1]} /> },
  {
    re: /https?:\/\/[^\s<]+[^\s<.,:;"')\]!?]/,
    render: (m, key) => (
      <a key={key} href={m[0]} target="_blank" rel="noreferrer noopener" className="text-[#64a8ff] hover:underline">
        {m[0]}
      </a>
    ),
  },
  { re: /\|\|([\s\S]+?)\|\|/, render: (m, key) => <Spoiler key={key}>{inline(m[1], key)}</Spoiler> },
  { re: /\*\*([\s\S]+?)\*\*/, render: (m, key) => <strong key={key} className="font-semibold text-foreground">{inline(m[1], key)}</strong> },
  { re: /__([\s\S]+?)__/, render: (m, key) => <u key={key}>{inline(m[1], key)}</u> },
  { re: /~~([\s\S]+?)~~/, render: (m, key) => <s key={key}>{inline(m[1], key)}</s> },
  { re: /(?<![\p{L}\p{N}*])\*(?!\s)([^*\n]+?)\*(?![\p{L}\p{N}])/u, render: (m, key) => <em key={key}>{inline(m[1], key)}</em> },
  { re: /(?<![\p{L}\p{N}_])_(?!\s)([^_\n]+?)_(?![\p{L}\p{N}])/u, render: (m, key) => <em key={key}>{inline(m[1], key)}</em> },
];

/** Formatting inside a line: always takes the earliest match, so nesting works and nothing overlaps. */
function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  let rest = text;
  let n = 0;
  while (rest) {
    let best: { m: RegExpExecArray; rule: (typeof INLINE)[number] } | null = null;
    for (const rule of INLINE) {
      const m = rule.re.exec(rest);
      if (m && (!best || m.index < best.m.index)) best = { m, rule };
    }
    if (!best) {
      out.push(rest);
      break;
    }
    if (best.m.index > 0) out.push(rest.slice(0, best.m.index));
    out.push(best.rule.render(best.m, `${keyBase}.${n++}`));
    rest = rest.slice(best.m.index + best.m[0].length);
  }
  return out;
}

function Mention({ id }: { id: string }) {
  const { t } = useT();
  const user = useStore((s) => (id === 'all' ? undefined : s.users[id]));
  const isMe = useStore((s) => id === 'all' || s.me?.id === id);
  return (
    <span className={`text-[#64a8ff] ${isMe ? 'font-semibold' : 'font-medium'}`}>
      @{id === 'all' ? t('common.md.everyone') : (user?.name ?? t('common.md.someone'))}
    </span>
  );
}

function RoomName({ id }: { id: string }) {
  const { t } = useT();
  const name = useStore((s) => s.channels.find((c) => c.id === id)?.name);
  return <span className="font-medium text-[#64a8ff]">{name ?? t('common.md.deletedRoom')}</span>;
}

function Spoiler({ children }: { children: ReactNode }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  return (
    <span
      role="button"
      tabIndex={0}
      aria-label={open ? undefined : t('common.md.spoiler')}
      onClick={() => setOpen(true)}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setOpen(true)}
      className={`rounded-[6px] px-0.5 transition-colors ${open ? 'bg-white/10' : 'cursor-pointer bg-[#3f3f46] text-transparent [&_*]:invisible'}`}
    >
      {children}
    </span>
  );
}

/* ---------- code ---------- */

const KEYWORDS = new Set(
  (
    'abstract and as async await break case catch class const continue def default del do elif else enum export extends ' +
    'false final finally fn for from func function go if impl import in interface is lambda let loop match mod module mut ' +
    'new nil none not null of or package pass private protected pub public raise return self static struct super switch ' +
    'this throw throws trait true try type typeof undefined use var void where while with yield True False None'
  ).split(' '),
);

const TOKEN = /(\/\/[^\n]*|#[^\n]*|\/\*[\s\S]*?\*\/|--[^\n]*)|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)|(\b\d[\d_.]*(?:e[+-]?\d+)?\b|\b0x[\da-f]+\b)|([A-Za-z_$][\w$]*)/gi;

/** A rough highlighter that works for most languages: comments, strings, numbers, keywords, calls. */
function highlight(code: string, lang: string): ReactNode[] {
  // "#" is a comment only in languages that use it; elsewhere it's a selector, a directive, a hash.
  const hashComments = /^(py|python|sh|bash|zsh|rb|ruby|yaml|yml|toml|ini|conf|dockerfile|r|pl|perl)$/.test(lang);
  const sqlComments = /^(sql|lua|hs|haskell)$/.test(lang);
  const out: ReactNode[] = [];
  let last = 0;
  let n = 0;
  for (const m of code.matchAll(TOKEN)) {
    const [whole, comment, string, number, word] = m;
    if (comment && ((whole.startsWith('#') && !hashComments) || (whole.startsWith('--') && !sqlComments))) continue;
    if (m.index! > last) out.push(code.slice(last, m.index));
    const color = comment
      ? 'text-[#6c7986] italic'
      : string
        ? 'text-[#fc6a5d]'
        : number
          ? 'text-[#d0bf69]'
          : word && KEYWORDS.has(word)
            ? 'text-[#fc5fa3]'
            : word && code[m.index! + whole.length] === '('
              ? 'text-[#67b7a4]'
              : '';
    out.push(color ? <span key={n++} className={color}>{whole}</span> : whole);
    last = m.index! + whole.length;
  }
  if (last < code.length) out.push(code.slice(last));
  return out;
}

function CodeBlock({ code, lang }: { code: string; lang: string }) {
  return (
    <pre className="my-1 max-w-full overflow-x-auto rounded-[14px] border-[0.5px] border-white/10 bg-black/50 px-4 py-3 font-mono text-[13.5px] leading-[1.55] text-foreground/90">
      {lang && <div className="pb-1 text-[11px] text-faint">{lang}</div>}
      <code>{highlight(code, lang)}</code>
    </pre>
  );
}
