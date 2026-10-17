import { useCallback, useEffect, useState } from 'react';
import { Button, Spinner, Toast } from '@heroui/react';
import { api, ApiError, getToken, setToken } from './api';
import { initStore } from './store';
import { connectSocket } from './socket';
import { clearInviteFromUrl } from './people/invite';
import { Login } from './account/Login';
import { Shell } from './shell/Shell';
import { SetupWizard } from './account/SetupWizard';

type Phase = 'loading' | 'login' | 'setup' | 'ready' | 'offline';

export function App() {
  const [phase, setPhase] = useState<Phase>(getToken() ? 'loading' : 'login');

  // Signed out on a server with no accounts yet: that's a fresh install, so the setup wizard instead of sign-in.
  useEffect(() => {
    if (getToken()) return;
    api.setupStatus().then((s) => s.needed && setPhase('setup'), () => undefined);
  }, []);

  const start = useCallback(async () => {
    try {
      const data = await api.bootstrap();
      initStore(data);
      // Already a member: an invite link opened again has nothing left to do.
      clearInviteFromUrl();
      connectSocket(getToken()!, () => {
        setToken(null);
        setPhase('login');
      });
      setPhase('ready');
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        setToken(null);
        setPhase('login');
      } else {
        setPhase('offline');
      }
    }
  }, []);

  useEffect(() => {
    if (phase === 'loading') start();
  }, [phase, start]);

  return (
    <>
      <Toast.Provider placement="top" />
      {phase === 'setup' ? (
        <SetupWizard onDone={() => setPhase('loading')} />
      ) : phase === 'login' ? (
        <Login onLoggedIn={() => setPhase('loading')} />
      ) : phase === 'ready' ? (
        <Shell />
      ) : (
        <Splash offline={phase === 'offline'} retry={() => setPhase('loading')} />
      )}
    </>
  );
}

function Splash({ offline, retry }: { offline: boolean; retry: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 text-txt-2">
      {offline ? (
        <>
          <span>Сервер недоступен</span>
          <Button onPress={retry}>Попробовать снова</Button>
        </>
      ) : (
        <Spinner />
      )}
    </div>
  );
}
