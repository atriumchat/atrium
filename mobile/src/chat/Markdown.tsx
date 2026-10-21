import { useState, type ReactNode } from 'react';
import { Linking, ScrollView, View } from 'react-native';
import { useStore } from '../store';
import { t } from '../i18n';
import { Text } from '../text';
import { colors } from '../theme';

/**
 * Discord-style message formatting, parsed by hand (same rules as web/src/ui/Markdown.tsx): ```code blocks```, > quotes,
 * **bold**, *italic* / _italic_, __underline__, ~~strike~~, ||spoilers||, `inline code`, links, and mentions stored as
 * <@id> / <@all>.
 */
const LINK = '#64a8ff';
const MONO = 'Menlo';

export function Markdown({ text, big = false, after }: { text: string; big?: boolean; after?: ReactNode }) {
  const blocks = splitBlocks(text);
  const size = big ? { fontSize: 44, lineHeight: 52 } : { fontSize: 17, lineHeight: 22 };
  return (
    <View>
      {blocks.map((b, i) => {
        const last = i === blocks.length - 1;
        if (b.kind === 'code') return <CodeBlock key={i} code={b.text} lang={b.lang} />;
        if (b.kind === 'quote') {
          return (
            <View key={i} style={{ marginVertical: 2, borderLeftWidth: 3, borderLeftColor: 'rgba(255,255,255,0.25)', paddingLeft: 12 }}>
              <Text style={[size, { color: 'rgba(255,255,255,0.8)' }]}>{inline(b.text, `q${i}`)}{last ? after : null}</Text>
            </View>
          );
        }
        return <Text key={i} style={[size, { color: 'rgba(255,255,255,0.9)' }]}>{inline(b.text, `p${i}`)}{last ? after : null}</Text>;
      })}
    </View>
  );
}

type Block = { kind: 'text' | 'quote'; text: string } | { kind: 'code'; text: string; lang: string };

function splitBlocks(text: string): Block[] {
  const out: Block[] = [];
  const fence = /```([\w-]*)\n?([\s\S]*?)```/g;
  let last = 0;
  for (const m of text.matchAll(fence)) {
    if (m.index! > last) out.push(...textBlocks(text.slice(last, m.index)));
    out.push({ kind: 'code', lang: (m[1] ?? '').toLowerCase(), text: (m[2] ?? '').replace(/\n$/, '') });
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
    const body = quote ? (quote[1] ?? '') : line;
    const prev = out[out.length - 1];
    if (prev && prev.kind === kind) prev.text += `\n${body}`;
    else out.push({ kind, text: body });
  }
  return out.map((b, i) => (i === 0 && b.kind === 'text' ? { ...b, text: b.text.replace(/^\n/, '') } : b)).filter((b) => b.kind !== 'text' || b.text !== '');
}

const INLINE: { re: RegExp; render: (m: RegExpExecArray, key: string) => ReactNode }[] = [
  { re: /`([^`\n]+)`/, render: (m, key) => <Text key={key} style={{ fontFamily: MONO, fontSize: 15, backgroundColor: 'rgba(255,255,255,0.1)' }}>{m[1]}</Text> },
  { re: /<@([0-9a-f]{32}|all)>/, render: (m, key) => <Mention key={key} id={m[1]!} /> },
  { re: /<#([0-9a-f]{32})>/, render: (m, key) => <RoomName key={key} id={m[1]!} /> },
  { re: /https?:\/\/[^\s<]+[^\s<.,:;"')\]!?]/, render: (m, key) => <Text key={key} style={{ color: LINK }} onPress={() => void Linking.openURL(m[0]).catch(() => undefined)}>{m[0]}</Text> },
  { re: /\|\|([\s\S]+?)\|\|/, render: (m, key) => <Spoiler key={key}>{m[1]!}</Spoiler> },
  { re: /\*\*([\s\S]+?)\*\*/, render: (m, key) => <Text key={key} style={{ fontWeight: '600' }}>{inline(m[1]!, key)}</Text> },
  { re: /__([\s\S]+?)__/, render: (m, key) => <Text key={key} style={{ textDecorationLine: 'underline' }}>{inline(m[1]!, key)}</Text> },
  { re: /~~([\s\S]+?)~~/, render: (m, key) => <Text key={key} style={{ textDecorationLine: 'line-through' }}>{inline(m[1]!, key)}</Text> },
  { re: /(?<![\p{L}\p{N}*])\*(?!\s)([^*\n]+?)\*(?![\p{L}\p{N}])/u, render: (m, key) => <Text key={key} style={{ fontStyle: 'italic' }}>{inline(m[1]!, key)}</Text> },
  { re: /(?<![\p{L}\p{N}_])_(?!\s)([^_\n]+?)_(?![\p{L}\p{N}])/u, render: (m, key) => <Text key={key} style={{ fontStyle: 'italic' }}>{inline(m[1]!, key)}</Text> },
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
    if (!best) { out.push(rest); break; }
    if (best.m.index > 0) out.push(rest.slice(0, best.m.index));
    out.push(best.rule.render(best.m, `${keyBase}.${n++}`));
    rest = rest.slice(best.m.index + best.m[0].length);
  }
  return out;
}

function Mention({ id }: { id: string }) {
  const user = useStore((s) => (id === 'all' ? undefined : s.users[id]));
  const isMe = useStore((s) => id === 'all' || s.data?.me.id === id);
  return <Text style={{ color: LINK, fontWeight: isMe ? '600' : '500' }}>@{id === 'all' ? t('common.md.everyone') : (user?.name ?? t('common.md.someone'))}</Text>;
}
function RoomName({ id }: { id: string }) {
  const name = useStore((s) => s.data?.channels.find((c) => c.id === id)?.name);
  return <Text style={{ color: LINK, fontWeight: '500' }}>{name ?? t('common.md.deletedRoom')}</Text>;
}
function Spoiler({ children }: { children: string }) {
  const [open, setOpen] = useState(false);
  return <Text accessibilityLabel={open ? undefined : t('common.md.spoiler')} onPress={() => setOpen(true)} style={open ? { backgroundColor: 'rgba(255,255,255,0.1)' } : { backgroundColor: '#3f3f46', color: 'transparent' }}>{children}</Text>;
}

function CodeBlock({ code, lang }: { code: string; lang: string }) {
  return (
    <View style={{ marginVertical: 4, borderRadius: 14, borderWidth: 0.5, borderColor: colors.border, backgroundColor: 'rgba(0,0,0,0.5)' }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 12 }}>
        <View>
          {lang ? <Text style={{ paddingBottom: 4, fontSize: 12, color: colors.faint }}>{lang}</Text> : null}
          <Text selectable style={{ fontFamily: MONO, fontSize: 14.5, lineHeight: 21, color: 'rgba(255,255,255,0.9)' }}>{code}</Text>
        </View>
      </ScrollView>
    </View>
  );
}
