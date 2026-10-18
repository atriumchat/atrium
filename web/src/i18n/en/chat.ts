import type { Entry } from '../index';
import type { chat as source } from '../ru/chat';

/** Same keys as ru/chat.ts: `satisfies` fails tsc on a missing or extra key. */
export const chat = {
} satisfies Record<keyof typeof source, Entry>;
