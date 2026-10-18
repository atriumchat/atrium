import type { Entry } from '../index';
import type { voice as source } from '../ru/voice';

/** Same keys as ru/voice.ts: `satisfies` fails tsc on a missing or extra key. */
export const voice = {
} satisfies Record<keyof typeof source, Entry>;
