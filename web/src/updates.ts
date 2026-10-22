import { useStore } from './store';
import { desktop } from './desktop';

/*
 * Keeping people on the latest Atrium.
 *
 * The site: every deploy changes it, but a tab or desktop window opened before keeps running the old code — the
 * desktop app can sit in the tray for weeks. So we compare the build we're running with the server's (after each
 * reconnect, i.e. after a deploy restarts the server, when the window comes back, and every half hour) and reload:
 * on our own while nobody's looking and no call is on, otherwise when the person clicks "Update".
 *
 * The desktop app updates its own shell (desktop/updater.js); here we only mirror its state for the banner.
 */

/** The bundle this page runs, e.g. "/assets/index-D909MJww.js". Null on the dev server, which reloads by itself. */
const RUNNING = document.querySelector<HTMLScriptElement>('script[type="module"][src^="/assets/"]')?.getAttribute('src') ?? null;

export async function checkSiteUpdate() {
  if (!RUNNING || useStore.getState().siteUpdate) return;
  try {
    const html = await fetch('/', { cache: 'no-store' }).then((r) => r.text());
    const latest = html.match(/<script[^>]*type="module"[^>]*src="(\/assets\/[^"]+)"/)?.[1];
    if (latest && latest !== RUNNING) {
      useStore.setState({ siteUpdate: true });
      reloadIfIdle();
    }
  } catch {
    // Offline or the server is restarting: the next check will tell.
  }
}

const idle = () => {
  const { siteUpdate, voiceChannelId } = useStore.getState();
  return siteUpdate && document.hidden && !voiceChannelId;
};

let reloadTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Reloads into the new build if the window is out of sight and there's no call to cut off. After a deploy every
 * hidden tab would reload at once and hit the 1-CPU server together, so each waits a random 0–30 s first.
 */
export function reloadIfIdle() {
  if (!idle() || reloadTimer) return;
  reloadTimer = setTimeout(() => {
    reloadTimer = null;
    // Still nobody looking and no call: the window may have come back meanwhile.
    if (idle()) window.location.reload();
  }, Math.random() * 30_000);
}

export function startUpdateChecks() {
  setInterval(checkSiteUpdate, 30 * 60 * 1000);
  document.addEventListener('visibilitychange', () => (document.hidden ? reloadIfIdle() : checkSiteUpdate()));
  // A call just ended while the window was hidden.
  useStore.subscribe((s, prev) => {
    if (prev.voiceChannelId && !s.voiceChannelId) reloadIfIdle();
  });

  const update = desktop?.update;
  if (update) {
    update.get().then((state) => useStore.setState({ desktopUpdate: state }));
    update.onChange((state) => useStore.setState({ desktopUpdate: state }));
  }
}

/** Installers for apps from before self-updating (1.1.x), by platform. */
export const INSTALLERS: Record<string, string> = {
  darwin: '/download/Atrium-mac-apple-silicon.dmg',
  win32: '/download/Atrium-windows.exe',
};
