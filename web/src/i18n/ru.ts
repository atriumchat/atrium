import { account } from './ru/account';
import { chat } from './ru/chat';
import { common } from './ru/common';
import { errors } from './ru/errors';
import { people } from './ru/people';
import { settings } from './ru/settings';
import { setup } from './ru/setup';
import { shell } from './ru/shell';
import { voice } from './ru/voice';

/** The source dictionary: its keys define what every other language must have. */
export const ru = { ...common, ...setup, ...account, ...chat, ...voice, ...people, ...shell, ...settings, ...errors };
