import { TASKS, type Progress, type StepState } from './install';

/**
 * A made-up install for design work and tests (the phone's /own?mock=1, the desktop window's #step=…): believable
 * timings, nothing real behind it.
 */

/** How long each installer step takes, in seconds: the address waits longest, as it does for real. */
export const MOCK_TOOK: Record<(typeof TASKS)[number], number> = { check: 2, address: 7, docker: 4, firewall: 1.5, ssh: 1, files: 1, config: 1, backups: 1.5, pull: 5, up: 3, https: 3 };
export const MOCK_KEY = 'K7QM-2XPA-9DHR-T4WC-8NBE-3VLY';
export const MOCK_INVITE = '7F3K9QAB';
export const MOCK_DOMAIN = 'podval.dedyn.io';
export const MOCK_SETUP_CODE = 'MOCKCODE01';

/** The install's progress `seconds` after it started. */
export function mockProgress(seconds: number, domain = MOCK_DOMAIN): Progress {
  let left = seconds;
  const steps: Record<string, StepState> = {};
  let current: string | null = null;
  for (const id of TASKS) {
    const took = MOCK_TOOK[id];
    if (left >= took) {
      steps[id] = { state: 'done', took };
      left -= took;
    } else {
      steps[id] = { state: 'run' };
      current = id;
      break;
    }
  }
  const ready = current ? null : `https://app.${domain}/?setup=${MOCK_SETUP_CODE}`;
  return { steps, current, doing: '', ready, exit: ready ? 0 : null, failed: null };
}
