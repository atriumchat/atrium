import { create } from 'zustand';

/** What the call's tiles show: your own tile and the people with no camera. Kept on this device. */
type CallView = { showSelf: boolean; showNoVideo: boolean; set: (patch: Partial<Omit<CallView, 'set'>>) => void };

const KEY = 'atrium_call_view';

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return { showSelf: saved.showSelf !== false, showNoVideo: saved.showNoVideo !== false };
  } catch {
    return { showSelf: true, showNoVideo: true };
  }
}

export const useCallView = create<CallView>((set, get) => ({
  ...load(),
  set: (patch) => {
    set(patch);
    const { showSelf, showNoVideo } = get();
    try {
      localStorage.setItem(KEY, JSON.stringify({ showSelf, showNoVideo }));
    } catch {
      // Not remembered; still applied for this session.
    }
  },
}));
