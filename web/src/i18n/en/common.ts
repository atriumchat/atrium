import type { Entry } from '../index';
import type { common as source } from '../ru/common';

/** Same keys as ru/common.ts: `satisfies` fails tsc on a missing or extra key. */
export const common = {
} satisfies Record<keyof typeof source, Entry>;
