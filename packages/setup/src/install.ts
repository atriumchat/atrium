import { IPV4 } from './validate';

/**
 * The installer as the apps drive it over SSH (install.sh): how it's started detached, how its "::atrium" progress
 * lines read, and what the first look at the server asks. Strings in, strings out: the SSH itself is the platform's.
 */

/** The installer's steps, in the order they run ("::atrium run|done STEP"). */
export const TASKS = ['check', 'address', 'docker', 'firewall', 'ssh', 'files', 'config', 'backups', 'pull', 'up', 'https'] as const;
export type Task = (typeof TASKS)[number];

/** The relay's neutral subdomain, as install.sh picks it (TURN_NAMES); picked here so own-domain records can show it. */
export const TURN_NAMES = ['media', 'cdn', 'static', 'assets', 'files', 'img'] as const;
export const pickTurn = (random = Math.random) => TURN_NAMES[Math.floor(random() * TURN_NAMES.length)] ?? 'media';

export const INSTALLER_URL = 'https://github.com/atriumchat/atrium/releases/latest/download/install.sh';
export const LOG = '/root/atrium-app-install.log';

/** Single quotes for sh, safe for anything. */
export const sq = (value: string) => `'${String(value).replace(/'/g, `'\\''`)}'`;

/** Fetches the installer to the server. */
export const fetchCommand = (installerUrl = INSTALLER_URL) => `curl -fsSL --retry 3 ${sq(installerUrl)} -o /root/atrium-install.sh`;

/**
 * Starts the fetched installer detached (setsid, its output into LOG), so it runs on when the phone sleeps or the
 * window closes. The app's key goes in first: the installer adds it for root and switches password login off.
 */
export function startCommand({ domain, turn, publicKey }: { domain: string; turn: string; publicKey: string }) {
  const env = ['ATRIUM_YES=1', 'ATRIUM_PROGRESS=1', 'NO_COLOR=1', `DOMAIN=${sq(domain)}`, `TURN_HOST=${sq(turn)}`, `ATRIUM_AUTHORIZED_KEY=${sq(publicKey)}`].join(' ');
  const job = `${env} sh /root/atrium-install.sh > ${LOG} 2>&1; echo "::exit $?" >> ${LOG}`;
  return `rm -f ${LOG}; nohup setsid sh -c ${sq(job)} > /dev/null 2>&1 < /dev/null & echo started`;
}

export type StepState = { state: 'run' | 'done' | 'fail'; took?: number; why?: string };
export type Progress = {
  steps: Partial<Record<string, StepState>>;
  /** The step running now. */
  current: string | null;
  /** What it's doing (::atrium sub), or the installer's last plain line. */
  doing: string;
  /** The setup link once the server is up. */
  ready: string | null;
  /** The installer's exit code once it has ended. */
  exit: number | null;
  failed: string | null;
};

/** Reads back the log's progress lines and its last few plain ones, split by a "::tail" line (parseProgress). */
export const progressCommand = () =>
  `grep -a -E '^::(atrium|exit) ' ${LOG} 2>/dev/null; echo '::tail'; tail -c 800 ${LOG} 2>/dev/null | tr '\\r' '\\n' | grep -v '^::' | tail -n 4`;

/** The progress out of progressCommand's output. */
export function parseProgress(output: string): Progress {
  const [marks = '', tail = ''] = output.split('::tail\n');
  const progress: Progress = { steps: {}, current: null, doing: '', ready: null, exit: null, failed: null };
  for (const line of marks.split('\n')) {
    const exit = line.match(/^::exit (\d+)/);
    if (exit) {
      progress.exit = Number(exit[1]);
      continue;
    }
    const sub = line.match(/^::atrium sub (.+)$/);
    if (sub) {
      progress.doing = (sub[1] ?? '').slice(0, 120);
      continue;
    }
    const m = line.match(/^::atrium (run|done|fail|ready) ?(\S*) ?(.*)$/);
    if (!m) continue;
    const [, state = '', step = '', rest = ''] = m;
    if (state === 'ready') {
      progress.ready = step;
      continue;
    }
    if (state === 'run') {
      progress.current = step;
      progress.doing = '';
    }
    if (state === 'fail') progress.failed = rest || step;
    progress.steps[step] = { state: state as StepState['state'], ...(state === 'done' && rest ? { took: Number(rest) } : {}), ...(state === 'fail' ? { why: rest } : {}) };
  }
  if (!progress.doing) {
    const last = tail
      .split('\n')
      // The installer's colours (ANSI escapes) out of its plain lines.
      // eslint-disable-next-line no-control-regex
      .map((line) => line.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '').trim())
      .filter((line) => line && !/^[…✓✗!•]/.test(line))
      .pop();
    progress.doing = last?.slice(0, 120) ?? '';
  }
  return progress;
}

/** How many of the tasks are done. */
export const doneCount = (progress: Progress | null) => TASKS.filter((id) => progress?.steps[id]?.state === 'done').length;

/** The first look at a server: system, cores, memory, disk, whether it's root, the address friends will reach. */
export function probeCommand(host: string) {
  return [
    '. /etc/os-release 2>/dev/null; echo "OS=$PRETTY_NAME"',
    'echo "ARCH=$(uname -m)"',
    'echo "CPU=$(nproc)"',
    "echo \"MEM=$(awk '/^MemTotal:/ { print int($2 / 1024) }' /proc/meminfo)\"",
    "echo \"DISK=$(df -Pm / | awk 'NR == 2 { print $4 }')\"",
    'echo "UID=$(id -u)"',
    // The one typed if it's an IP, else the server's own view of it.
    IPV4.test(host.trim()) ? `echo IP=${host.trim()}` : 'echo "IP=$(curl -4fsS --max-time 8 https://api.ipify.org || hostname -I | cut -d" " -f1)"',
  ].join('; ');
}

export type Facts = { ip: string; os: string; root: boolean; cores: number; memory: number; disk: number };

/** probeCommand's output as numbers: memory and disk in GB. */
export function parseProbe(output: string): Facts {
  const facts = Object.fromEntries(output.split('\n').map((line) => line.split(/=(.*)/s).slice(0, 2)));
  return {
    ip: (facts.IP ?? '').trim(),
    os: [facts.OS, facts.ARCH].filter(Boolean).join(' · '),
    root: facts.UID === '0',
    cores: Number(facts.CPU) || 1,
    memory: Number(facts.MEM) / 1024,
    disk: Number(facts.DISK) / 1024,
  };
}
