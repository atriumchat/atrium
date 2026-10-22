import { useEffect, useState } from 'react';
import { adminForm } from '@gomex/setup';
import { FlowPrimary, FlowShell, FlowStep, LineField } from '@gomex/ui-web';
import { api, setToken } from '../api';
import type { Session } from '../types';
import { clearResetFromUrl } from './resetLink';
import { useT } from '../i18n';
import { DEMO_RESET_TOKEN, demo } from './demo';

/**
 * The page a reset link opens, in the flow look: a new password, twice. The link belongs to one person (the admin
 * made it for them); it works once, ends their other sessions and signs this one in. A link that doesn't work says
 * why and leads to the sign-in.
 */
export function ResetPassword({ token, onDone, onCancel }: { token: string; onDone: (session: Session) => void; onCancel: () => void }) {
  const { t } = useT();
  const [name, setName] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // The same rules as the admin's password: 8 and more, the repeat wrong only once it's as long as the first.
  const { ready, mismatch } = adminForm(name ?? '', password, repeat);

  useEffect(() => {
    if (token === DEMO_RESET_TOKEN && demo === 'reset') return setName('Тимур');
    api.checkReset(token).then(
      (r) => setName(r.name),
      (e) => setProblem(e instanceof Error ? e.message : t('account.reset.linkFailed')),
    );
  }, [token, t]);

  async function submit() {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      const session = await api.reset(token, password);
      setToken(session.token);
      clearResetFromUrl();
      onDone(session);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('account.reset.failed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <FlowShell fill={0.5}>
      {problem ? (
        <FlowStep
          title={t('account.reset.title')}
          error={t('account.login.askNewLink', { problem })}
          onSubmit={onCancel}
          actions={<FlowPrimary type="submit">{t('account.reset.toLogin')}</FlowPrimary>}
        />
      ) : (
        <FlowStep
          title={t('account.reset.title')}
          sub={name ? t('account.reset.forName', { name }) : undefined}
          error={error}
          onSubmit={() => void submit()}
          actions={<FlowPrimary type="submit" busy={busy} disabled={!ready}>{t('account.reset.save')}</FlowPrimary>}
        >
          {/* So a password manager saves the new password under the right nick. */}
          <input type="text" value={name ?? ''} readOnly autoComplete="username" tabIndex={-1} aria-hidden className="sr-only" />
          <div className="flow-pair">
            <LineField label={t('account.reset.newPassword')} type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={t('setup.admin.passwordHint')} autoComplete="new-password" />
            <LineField label={t('account.reset.repeat')} type="password" value={repeat} onChange={(e) => setRepeat(e.target.value)} placeholder={t('setup.admin.repeatHint')} autoComplete="new-password" error={mismatch && t('account.reset.mismatch')} />
          </div>
        </FlowStep>
      )}
    </FlowShell>
  );
}
