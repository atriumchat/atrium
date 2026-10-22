import { useCallback, useEffect, useState } from 'react';
import { Button, Spinner, Toast } from '@heroui/react';
import { api, ApiError, getToken } from './api';
import { initStore } from './store';
import { connectSocket } from './socket';
import { clearInviteFromUrl } from './people/invite';
import { FlowProvider } from '@gomex/ui-web';
import { Login, SIGN_IN_DEMO } from './account/Login';
import { Shell } from './shell/Shell';
import { DEMO, SetupWizard } from './account/SetupWizard';
import { RecoveryKeyScreen, loadNewKey, storeNewKey, type NewKey } from './account/RecoveryKey';
import { ResetPassword } from './account/ResetPassword';
import { clearResetFromUrl, resetFromUrl } from './account/resetLink';
import { WhereToUse, whereToUseNeeded } from './account/WhereToUse';
import type { Session } from './types';
import { endSession } from './account/session';
import { useT } from './i18n';

type Phase = 'loading' | 'login' | 'setup' | 'reset' | 'key' | 'where' | 'ready' | 'offline';

export function App() {
  const { t } = useT();
  // Opened from an admin's reset link; or reloaded on the recovery key's screen, where the key waits (see RecoveryKey).
  const [resetToken] = useState(resetFromUrl);
  const [newKey, setNewKey] = useState<NewKey | null>(() => (getToken() ? loadNewKey() : null));
  const [phase, setPhase] = useState<Phase>(
    DEMO ? 'setup' : resetToken ? 'reset' : newKey ? 'key' : getToken() ? 'loading' : 'login',
  );

  // Signed out on a server with no accounts yet: that's a fresh install, so the setup wizard instead of sign-in.
  useEffect(() => {
    if (getToken() || resetToken) return;
    api.setupStatus().then((s) => s.needed && setPhase('setup'), () => undefined);
  }, [resetToken]);

  // Sign-up, recovery and a reset link end here: the new recovery key comes first, then the app.
  function signedIn(session?: Session, signedUp = false) {
    if (!session?.recoveryKey) {
      storeNewKey(null);
      return setPhase('loading');
    }
    const fresh = { key: session.recoveryKey, name: session.user.name, serverName: session.serverName ?? '', newcomer: signedUp };
    storeNewKey(fresh);
    setNewKey(fresh);
    setPhase('key');
  }

  // The order after sign-up is: the key, then the "where to use Gomex" screen (not in the desktop app or a Home
  // Screen app, and not after a recovery), then the app.
  function keySeen() {
    const newcomer = newKey?.newcomer;
    storeNewKey(null);
    setNewKey(null);
    setPhase(newcomer && whereToUseNeeded() ? 'where' : 'loading');
  }

  const start = useCallback(async () => {
    try {
      const data = await api.bootstrap();
      initStore(data);
      // Already a member: an invite link opened again has nothing left to do.
      clearInviteFromUrl();
      connectSocket(getToken()!, () => {
        storeNewKey(null);
        endSession();
      });
      setPhase('ready');
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        storeNewKey(null);
        endSession();
      } else {
        setPhase('offline');
      }
    }
  }, []);

  useEffect(() => {
    if (phase === 'loading') start();
  }, [phase, start]);

  return (
    // The flows' own words (the back button's label) in the app's language, for every flow screen below.
    <FlowProvider labels={{ back: t('setup.back') }}>
      <Toast.Provider placement="top" />
      {SIGN_IN_DEMO ? (
        <Login onLoggedIn={signedIn} />
      ) : phase === 'setup' ? (
        <SetupWizard onDone={() => setPhase('loading')} />
      ) : phase === 'reset' && resetToken ? (
        <ResetPassword
          token={resetToken}
          onDone={signedIn}
          onCancel={() => {
            clearResetFromUrl();
            setPhase(getToken() ? 'loading' : 'login');
          }}
        />
      ) : phase === 'key' && newKey ? (
        <RecoveryKeyScreen value={newKey} onDone={keySeen} />
      ) : phase === 'where' ? (
        <WhereToUse onDone={() => setPhase('loading')} />
      ) : phase === 'login' ? (
        <Login onLoggedIn={signedIn} />
      ) : phase === 'ready' ? (
        <Shell />
      ) : (
        <Splash offline={phase === 'offline'} retry={() => setPhase('loading')} />
      )}
    </FlowProvider>
  );
}

function Splash({ offline, retry }: { offline: boolean; retry: () => void }) {
  const { t } = useT();
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 text-txt-2">
      {offline ? (
        <>
          <span>{t('account.app.offline')}</span>
          <Button onPress={retry}>{t('account.app.retry')}</Button>
        </>
      ) : (
        <Spinner />
      )}
    </div>
  );
}
