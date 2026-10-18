import type { Entry } from '../index';
import type { errors as source } from '../ru/errors';

/** Same keys as ru/errors.ts: `satisfies` fails tsc on a missing or extra key. */
export const errors = {
} satisfies Record<keyof typeof source, Entry>;
