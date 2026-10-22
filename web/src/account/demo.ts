import type { Platform } from './WhereToUse';
import type { NewKey } from './RecoveryKey';

/**
 * Design work, development only: #signin, #key, #reset and #where (=ios, android, mac, windows) open those screens
 * with made-up answers and nothing sent to the server (the setup wizard has its own, #step=…).
 */
const match = import.meta.env.DEV ? window.location.hash.match(/#(signin|key|reset|where)(?:=(\w+))?/) : null;

export const demo = match?.[1] as 'signin' | 'key' | 'reset' | 'where' | undefined;
export const demoPlatform = match?.[1] === 'where' ? (match[2] as Platform | undefined) : undefined;
export const DEMO_KEY: NewKey = { key: 'K7QM-2XPA-9DHR-T4WC', name: 'Тимур', serverName: 'Подвал' };
export const DEMO_RESET_TOKEN = 'demo';
