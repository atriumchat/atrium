/** The installer's steps, in order, as the server's install script reports them (desktop/onboarding.js TASKS). */
export const TASKS = ['check', 'address', 'docker', 'firewall', 'ssh', 'files', 'config', 'backups', 'pull', 'up', 'https'] as const;
