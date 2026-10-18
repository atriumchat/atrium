import type { Entry } from '../index';
import type { settings as source } from '../ru/settings';

/** Same keys as ru/settings.ts: `satisfies` fails tsc on a missing or extra key. */
export const settings = {
} satisfies Record<keyof typeof source, Entry>;
