import type { Entry } from '../index';
import type { account as source } from '../ru/account';

/** Same keys as ru/account.ts: `satisfies` fails tsc on a missing or extra key. */
export const account = {
} satisfies Record<keyof typeof source, Entry>;
