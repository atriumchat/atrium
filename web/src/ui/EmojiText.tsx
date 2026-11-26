import type { ReactNode } from 'react';
import emojiAssets from 'virtual:twemoji-assets';
import { useStore } from '../store';
import type { CustomEmoji } from '../types';

export const emojiShortcode = /:([a-z0-9_а-яё]{2,32}):/;
export const emojiNamePattern = /^[a-z0-9_а-яё]{2,32}$/;
const emojiCandidate = /\p{Extended_Pictographic}|\p{Emoji_Presentation}|\u20e3/u;
const emojiPresentation = /\p{Emoji_Presentation}|[\ufe0f\u20e3\u200d]/u;
const assets = new Set(emojiAssets);
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

export function serverEmojiUrl(name: string) {
  return `/api/server/emoji/${encodeURIComponent(name)}`;
}

export function twemojiUrl(text: string) {
  if (!emojiPresentation.test(text)) return;
  const codepoints = Array.from(text, (char) => char.codePointAt(0)!.toString(16));
  const full = codepoints.join('-');
  const withoutVariation = codepoints.filter((cp) => cp !== 'fe0f').join('-');
  const name = assets.has(full) ? full : assets.has(withoutVariation) ? withoutVariation : undefined;
  return name && `/twemoji/${name}.svg`;
}

function emojiMatches(text: string, catalog?: CustomEmoji) {
  const matches: { text: string; url: string; indices: [number, number] }[] = [];
  if (emojiCandidate.test(text)) {
    for (const { segment, index } of graphemes.segment(text)) {
      const url = twemojiUrl(segment);
      if (url) matches.push({ text: segment, url, indices: [index, index + segment.length] });
    }
  }
  if (!catalog) return matches;
  for (const match of text.matchAll(new RegExp(emojiShortcode, 'g'))) {
    if (Object.hasOwn(catalog, match[1])) {
      matches.push({ text: match[0], url: serverEmojiUrl(match[1]), indices: [match.index, match.index + match[0].length] });
    }
  }
  return matches.sort((a, b) => a.indices[0] - b.indices[0]);
}

export function isEmojiOnly(text: string, catalog: CustomEmoji) {
  const matches = emojiMatches(text, catalog);
  if (!matches.length || matches.length > 4) return false;
  let end = 0;
  for (const { indices: [start, next] } of matches) {
    if (text.slice(end, start).trim()) return false;
    end = next;
  }
  return !text.slice(end).trim();
}

export function EmojiText({ text, unicodeOnly = false }: { text: string; unicodeOnly?: boolean }) {
  const catalog = useStore((s) => unicodeOnly ? undefined : s.customEmoji);
  const matches = emojiMatches(text, catalog);
  if (!matches.length) return text;
  const output: ReactNode[] = [];
  let end = 0;
  for (const match of matches) {
    const [start, next] = match.indices;
    if (start > end) output.push(text.slice(end, start));
    output.push(<img key={start} src={match.url} alt={match.text} draggable={false} className="inline-block size-[1em] max-w-none align-[-0.12em] object-contain" />);
    end = next;
  }
  if (end < text.length) output.push(text.slice(end));
  return <>{output}</>;
}
