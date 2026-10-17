import { useSyncExternalStore } from 'react';

/** Below Tailwind's `md` breakpoint the app switches to the phone layout. */
const PHONE = '(max-width: 767px)';

function subscribe(onChange: () => void) {
  const query = window.matchMedia(PHONE);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

export function useIsMobile() {
  return useSyncExternalStore(subscribe, () => window.matchMedia(PHONE).matches);
}
