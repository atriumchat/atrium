import type { Entry } from '../index';
import type { shell as source } from '../ru/shell';

/** Same keys as ru/shell.ts: `satisfies` fails tsc on a missing or extra key. */
export const shell = {
} satisfies Record<keyof typeof source, Entry>;
