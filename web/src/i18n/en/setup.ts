import type { Entry } from '../index';
import type { setup as source } from '../ru/setup';

/** Same keys as ru/setup.ts: `satisfies` fails tsc on a missing or extra key. */
export const setup = {
} satisfies Record<keyof typeof source, Entry>;
