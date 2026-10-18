import type { Entry } from './index';
import type { ru } from './ru';
import { account } from './en/account';
import { chat } from './en/chat';
import { common } from './en/common';
import { errors } from './en/errors';
import { people } from './en/people';
import { settings } from './en/settings';
import { setup } from './en/setup';
import { shell } from './en/shell';
import { voice } from './en/voice';

/** Typed against ru: a key missing here (or an extra one) fails `tsc`. */
export const en: Record<keyof typeof ru, Entry> = { ...common, ...setup, ...account, ...chat, ...voice, ...people, ...shell, ...settings, ...errors };
