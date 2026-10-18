/** The desktop app's self-update (desktop/updater.js). */
export type DesktopUpdate = {
  status: 'idle' | 'checking' | 'downloading' | 'ready' | 'latest' | 'manual' | 'error';
  /** The running app's version. */
  current: string;
  /** The update's version (downloading, ready, manual). */
  version?: string;
  progress?: number;
  error?: string;
  /** With 'error': 'no-key' = built without the release key, so this copy never updates (since 1.3.1). */
  code?: 'no-key';
};

/** What the Gomex desktop app (desktop/preload.js) exposes to the page. In a normal browser it's undefined. */
type DesktopBridge = {
  platform: string;
  incomingCall(title: string, body: string): void;
  callHandled(): void;
  setBadge(count: number): void;
  notify(title: string, body: string, conversationId: string): void;
  onOpenConversation(callback: (conversationId: string) => void): void;
  /** Since 1.2.0; older apps can't update themselves. */
  update?: {
    get(): Promise<DesktopUpdate>;
    check(): Promise<DesktopUpdate>;
    install(): Promise<void>;
    onChange(callback: (state: DesktopUpdate) => void): void;
  };
  /**
   * Push-to-talk held anywhere, even with the window in the background (a system-wide key hook). `watch` takes
   * a KeyboardEvent.code or "Mouse4"/"Mouse5", or null to stop listening.
   */
  /** The language chosen in the app (the tray menu); null follows the system. */
  language?: {
    get(): Promise<'ru' | 'en' | null>;
    set(lang: 'ru' | 'en' | null): Promise<void>;
  };
  onLanguage?(callback: (lang: 'ru' | 'en' | null) => void): void;
  ptt?: {
    watch(key: string | null): void;
    onChange(callback: (down: boolean) => void): void;
  };
};

declare global {
  interface Window {
    gomexDesktop?: DesktopBridge;
  }
}

export const desktop: DesktopBridge | undefined = typeof window === 'undefined' ? undefined : window.gomexDesktop;
