import type { Entry } from '../index';
import type { people as source } from '../ru/people';

/** Same keys as ru/people.ts: `satisfies` fails tsc on a missing or extra key. */
export const people = {
} satisfies Record<keyof typeof source, Entry>;
