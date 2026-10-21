/**
 * A flow's steps as data: where each stands on the one scale (`fill`, 0…1), the part it belongs to (the line over the
 * title, "Адрес (2/5)"), and where back leads. The screens draw it; the numbers and the way back live here, so the
 * phone, the desktop window and the web wizard can't drift apart.
 */

export type StepSpec<Part extends string, Ctx> = {
  fill: number;
  part: Part;
  /** One step back along the way actually walked; none where back leaves the flow. */
  back?: string | ((ctx: Ctx) => string | null);
};

export type Flow<Step extends string, Part extends string, Ctx = void> = {
  parts: readonly Part[];
  steps: Record<Step, StepSpec<Part, Ctx>>;
};

export function defineFlow<Step extends string, Part extends string, Ctx = void>(flow: Flow<Step, Part, Ctx>) {
  return {
    ...flow,
    /** The part a step is in, with its number and the count, for "Адрес (2/5)". */
    stage(step: Step) {
      const part = flow.steps[step].part;
      return { part, n: flow.parts.indexOf(part) + 1, total: flow.parts.length };
    },
    fill(step: Step) {
      return flow.steps[step].fill;
    },
    /** The step back leads to, or null where back leaves the flow (or there's none). */
    back(step: Step, ctx: Ctx): Step | null {
      const to = flow.steps[step].back;
      return ((typeof to === 'function' ? to(ctx) : to) ?? null) as Step | null;
    },
  };
}

/**
 * The scale through a long job: from `from` it fills towards `to` as `done` of `total` tasks are done, and stands at
 * `to` once the job is ready.
 */
export function jobFill(from: number, to: number, done: number, total: number, ready: boolean) {
  if (ready || total <= 0) return to;
  return from + ((to - from) * Math.min(done, total)) / total;
}

type Way = { way: 'free' | 'own' };

/**
 * "Your own server" on the phone: the VPS, its address (a free name, with the letter to confirm, or one's own
 * domain), the install, then the server's first run (name, admin, recovery key, the first invite).
 */
export const ownOnPhone = defineFlow({
  parts: ['server', 'address', 'install', 'setup', 'friends'],
  steps: {
    server: { fill: 0.04, part: 'server' },
    address: { fill: 0.12, part: 'address', back: 'server' },
    free: { fill: 0.2, part: 'address', back: 'address' },
    own: { fill: 0.2, part: 'address', back: 'address' },
    mail: { fill: 0.27, part: 'address', back: 'free' },
    install: { fill: 0.32, part: 'install' },
    name: { fill: 0.76, part: 'setup', back: 'install' },
    admin: { fill: 0.84, part: 'setup', back: 'name' },
    key: { fill: 0.91, part: 'setup' },
    invite: { fill: 0.97, part: 'friends' },
  },
});

/** On the phone the install fills the scale from its own step up to here, where the server's first run starts. */
export const OWN_READY = 0.68;

/**
 * "Your own server" in the desktop app: the VPS, its address, backups to the admin's Drive, the install. The server's
 * first run follows in the web wizard, with its own scale.
 */
export const ownOnDesktop = defineFlow<'server' | 'address' | 'free-name' | 'free-mail' | 'own' | 'backup' | 'install', 'server' | 'address' | 'backup' | 'install', Way>({
  parts: ['server', 'address', 'backup', 'install'],
  steps: {
    server: { fill: 0, part: 'server' },
    address: { fill: 0.2, part: 'address', back: 'server' },
    'free-name': { fill: 0.4, part: 'address', back: 'address' },
    'free-mail': { fill: 0.5, part: 'address', back: 'free-name' },
    own: { fill: 0.4, part: 'address', back: 'address' },
    backup: { fill: 0.6, part: 'backup', back: ({ way }) => (way === 'free' ? 'free-name' : 'own') },
    install: { fill: 0.8, part: 'install', back: 'backup' },
  },
});

/** The server's first run in a browser (the web wizard): its code, name and icon, the admin, the key, the invite. */
export const firstRun = defineFlow<'code' | 'server' | 'crop' | 'admin' | 'key' | 'invite', 'server' | 'account' | 'friends', { askCode: boolean }>({
  parts: ['server', 'account', 'friends'],
  steps: {
    code: { fill: 0.1, part: 'server' },
    // Back to the code only when it was asked for: a link that brought the code skips that step.
    server: { fill: 0.25, part: 'server', back: ({ askCode }) => (askCode ? 'code' : null) },
    crop: { fill: 0.3, part: 'server', back: 'server' },
    admin: { fill: 0.5, part: 'account', back: 'server' },
    key: { fill: 0.72, part: 'account' },
    invite: { fill: 0.9, part: 'friends' },
  },
});

export type OwnPhoneStep = keyof typeof ownOnPhone.steps;
export type OwnDesktopStep = keyof typeof ownOnDesktop.steps;
export type FirstRunStep = keyof typeof firstRun.steps;
