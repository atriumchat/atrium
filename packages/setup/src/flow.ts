/**
 * A flow's steps as data: where each stands on the one scale (`fill`, 0…1), the part it belongs to (the line over the
 * title, "Адрес (2/5)"), and where back leads. The screens draw it; the numbers and the way back live here, so the
 * phone, the desktop window and the web wizard can't drift apart.
 */

export type StepSpec<Part extends string, Ctx> = {
  fill: number;
  /** The part it's in, for "Адрес (2/5)"; null for a step outside the counted parts (no line over its title). */
  part: Part | null;
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
    /** The part a step is in, with its number and the count, for "Адрес (2/5)"; null where no line is shown. */
    stage(step: Step): { part: Part; n: number; total: number } | null {
      const part = flow.steps[step].part;
      return part === null ? null : { part, n: flow.parts.indexOf(part) + 1, total: flow.parts.length };
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
    // "No server?": signing up at the host, paying in, its API key; the app then makes the server itself.
    rent: { fill: 0.04, part: 'server', back: 'server' },
    'rent-pay': { fill: 0.04, part: 'server', back: 'rent' },
    'rent-key': { fill: 0.04, part: 'server', back: 'rent-pay' },
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
 * "Your own server" in the desktop app: the VPS, its address, the install. The server's first run follows in the web
 * wizard, with its own scale.
 */
export const ownOnDesktop = defineFlow<'server' | 'rent' | 'rent-pay' | 'rent-key' | 'address' | 'free-name' | 'free-mail' | 'own' | 'install', 'server' | 'address' | 'install', Way>({
  parts: ['server', 'address', 'install'],
  steps: {
    server: { fill: 0, part: 'server' },
    // "No server?": signing up at the host, paying in, its API key; the app then makes the server itself.
    rent: { fill: 0, part: 'server', back: 'server' },
    'rent-pay': { fill: 0, part: 'server', back: 'rent' },
    'rent-key': { fill: 0, part: 'server', back: 'rent-pay' },
    address: { fill: 0.2, part: 'address', back: 'server' },
    'free-name': { fill: 0.4, part: 'address', back: 'address' },
    'free-mail': { fill: 0.5, part: 'address', back: 'free-name' },
    own: { fill: 0.4, part: 'address', back: 'address' },
    // No way back: the installer is already at work on the server.
    install: { fill: 0.6, part: 'install' },
  },
});

/**
 * The server's first run in a browser (the web wizard): its code, name and icon, the admin, the key, early access (or
 * not), the channels from a Discord server (or not), the invite.
 */
export const firstRun = defineFlow<'code' | 'server' | 'crop' | 'admin' | 'key' | 'early' | 'discord' | 'invite', 'server' | 'account' | 'friends', { askCode: boolean }>({
  parts: ['server', 'account', 'friends'],
  steps: {
    code: { fill: 0.1, part: 'server' },
    // Back to the code only when it was asked for: a link that brought the code skips that step.
    server: { fill: 0.25, part: 'server', back: ({ askCode }) => (askCode ? 'code' : null) },
    crop: { fill: 0.3, part: 'server', back: 'server' },
    admin: { fill: 0.5, part: 'account', back: 'server' },
    key: { fill: 0.72, part: 'account' },
    early: { fill: 0.76, part: 'account' },
    discord: { fill: 0.8, part: 'friends' },
    invite: { fill: 0.9, part: 'friends' },
  },
});

/**
 * Getting in, on a server one already knows: what you're here for, then the nickname and password; by invite the
 * link first (whose it is shows under it), then the account; or the recovery key. Signing up is the counted way
 * ("Приглашение (1/2)"); signing in goes half the scale, signing up all of it.
 */
export const signInFlow = defineFlow<'start' | 'login' | 'recover' | 'invite' | 'account', 'invite' | 'account'>({
  parts: ['invite', 'account'],
  steps: {
    start: { fill: 0, part: null },
    login: { fill: 0.5, part: null, back: 'start' },
    recover: { fill: 0.5, part: null, back: 'login' },
    invite: { fill: 0.34, part: 'invite', back: 'start' },
    account: { fill: 0.67, part: 'account', back: 'invite' },
  },
});

export type OwnPhoneStep = keyof typeof ownOnPhone.steps;
export type SignInStep = keyof typeof signInFlow.steps;
export type OwnDesktopStep = keyof typeof ownOnDesktop.steps;
export type FirstRunStep = keyof typeof firstRun.steps;
