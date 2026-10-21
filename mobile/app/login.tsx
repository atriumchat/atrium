import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import Animated, { FadeIn, FadeOut, SlideInRight, SlideOutLeft } from 'react-native-reanimated';
import { api, getCredentials } from '../src/api';
import { normalizeServer } from '../src/protocol';
import { signIn } from '../src/store';
import { useT } from '../src/i18n';
import { Text } from '../src/text';
import { FlowPrimary, FlowShell, FlowStep, KeptRow, LineField, RadioRow, TextAction } from '@gomex/ui-native';
import { RecoveryKeyStep } from '../src/components/RecoveryKeyStep';
import { MOCK_KEY } from '../src/own/mock';

/**
 * Signing in, in the flow look (DESIGN.md), a short step at a time so nothing scrolls: what you're here for, then the
 * nickname and password; by invite, the link first (whose it is shows under it), then the account; or the recovery key.
 * The server is remembered and shown as a line to change, not a field to fill every time.
 */

type Step = 'start' | 'login' | 'invite' | 'account' | 'recover' | 'key';
type Way = 'login' | 'invite' | 'own';
// The edge (EdgeTicks) for each step: signing up goes round once, signing in half way.
const FILL: Record<Step, number> = { start: 0, login: 0.5, recover: 0.5, invite: 0.34, account: 0.67, key: 1 };

/** Invite links look like https://app.example.com/?invite=CODE; a bare code works too. */
function parseInvite(text: string): { server?: string; code: string } {
  const value = text.trim();
  try { const url = new URL(value); const code = url.searchParams.get('invite'); if (code) return { server: url.origin, code }; } catch { /* a bare code */ }
  return { code: value };
}

const hostOf = (server: string) => server.trim().replace(/^https?:\/\//, '').replace(/\/$/, '');

export default function Login() {
  const { t } = useT();
  const router = useRouter();
  // `server`: the address of a server just set up from "Your own server" (app/own.tsx). `mock`: design work, no server.
  const params = useLocalSearchParams<{ invite?: string; server?: string; mock?: string }>();
  const mocked = __DEV__ && !!params.mock;
  const [server, setServer] = useState(params.server || getCredentials()?.server || process.env.EXPO_PUBLIC_SERVER_URL || '');
  const [editServer, setEditServer] = useState(!server);
  const [step, setStep] = useState<Step>(params.invite ? 'invite' : 'start');
  const [backwards, setBackwards] = useState(false);
  const [way, setWay] = useState<Way>(params.invite ? 'invite' : 'login');
  const [invite, setInvite] = useState(params.invite ?? '');
  const [inviter, setInviter] = useState<string | null>(null);
  const [inviteBad, setInviteBad] = useState(false);
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [key, setKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function go(next: Step, isBack = false) {
    setBackwards(isBack);
    setError(null);
    setStep(next);
  }

  // Whose invite it is, as soon as the link (or the code and a server) is there.
  useEffect(() => {
    if (step !== 'invite') return;
    const parsed = parseInvite(invite);
    setInviter(null);
    setInviteBad(false);
    if (parsed.code.length < 6) return;
    let origin: string;
    try { origin = normalizeServer(parsed.server ?? server); } catch { return; }
    let live = true;
    const check = mocked ? Promise.resolve({ inviter: 'Тимур' }) : api.checkInvite(origin, parsed.code);
    check.then((r) => live && setInviter(r.inviter), () => live && setInviteBad(true));
    return () => { live = false; };
  }, [step, invite, server]);

  async function submit() {
    const parsed = parseInvite(invite);
    let origin: string;
    try { origin = normalizeServer(step === 'account' && parsed.server ? parsed.server : server); } catch { setError(t('m.invalidServer')); return; }
    setBusy(true); setError(null);
    try {
      if (mocked) {
        if (step === 'account') go('key');
        else setError(t('account.login.failed'));
        return;
      }
      await signIn(origin, name, password, step === 'account' ? parsed.code : undefined, step === 'recover' ? key.replace(/[^a-zA-Z0-9]/g, '').toUpperCase() : undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('account.login.failed'));
    } finally {
      setBusy(false);
    }
  }

  const needServer = step === 'invite' ? !parseInvite(invite).server : true;
  const serverLine = needServer ? (
    editServer || !server.trim() ? (
      <LineField label={t('m.serverAddress')} value={server} onChangeText={setServer} placeholder={t('m.serverHint')} keyboardType="url" textContentType="URL" />
    ) : (
      <KeptRow label={t('m.serverRow', { host: hostOf(server) })} go={t('m.change')} onPress={() => setEditServer(true)} />
    )
  ) : null;
  const nickField = <LineField label={t('account.login.name')} value={name} onChangeText={setName} placeholder={t('setup.admin.nickPlaceholder')} textContentType="username" maxLength={32} returnKeyType="next" />;

  function screen() {
    switch (step) {
      case 'start':
        return (
          <FlowStep
            title="Gomex"
            sub={t('account.login.tagline')}
            actions={<FlowPrimary onPress={() => (way === 'own' ? router.push('/own') : go(way))}>{t('setup.next')}</FlowPrimary>}
          >
            <View>
              <RadioRow title={t('m.start.have')} sub={t('m.start.haveSub')} on={way === 'login'} onPress={() => setWay('login')} />
              <RadioRow title={t('m.start.invited')} sub={t('account.login.invitePlaceholder')} on={way === 'invite'} onPress={() => setWay('invite')} />
              <RadioRow title={t('own.entry')} sub={t('own.entrySub')} on={way === 'own'} onPress={() => setWay('own')} last />
            </View>
          </FlowStep>
        );
      case 'login': {
        const ready = !!server.trim() && !!name.trim() && !!password;
        return (
          <FlowStep
            onBack={() => go('start', true)}
            title={t('account.login.tabLogin')}
            sub={t('m.start.haveSub')}
            error={error}
            actions={<FlowPrimary busy={busy} disabled={!ready} onPress={() => void submit()}>{t('account.login.submitLogin')}</FlowPrimary>}
            below={<TextAction onPress={() => go('recover')}>{t('account.login.forgotPassword')}</TextAction>}
          >
            {serverLine}
            {nickField}
            <LineField label={t('account.login.password')} value={password} onChangeText={setPassword} placeholder="••••••••" secureTextEntry textContentType="password" returnKeyType="go" onSubmitEditing={() => ready && void submit()} />
          </FlowStep>
        );
      }
      case 'invite':
        return (
          <FlowStep
            onBack={() => go('start', true)}
            title={t('account.login.inviteLabel')}
            sub={t('m.inviteSub')}
            actions={<FlowPrimary disabled={!inviter} onPress={() => go('account')}>{t('setup.next')}</FlowPrimary>}
          >
            <View>
              <LineField
                label={t('m.inviteField')}
                value={invite}
                onChangeText={setInvite}
                placeholder={t('account.login.invitePlaceholder')}
                error={inviteBad && t('account.login.inviteFailed')}
              />
              {inviter ? <Text style={{ marginTop: 8, fontSize: 15 }}>{t('account.login.invitedBy', { name: inviter })}</Text> : null}
            </View>
            {serverLine}
          </FlowStep>
        );
      case 'account': {
        const ready = !!name.trim() && password.length >= 8;
        return (
          <FlowStep
            onBack={() => go('invite', true)}
            title={t('m.account')}
            sub={inviter ? t('account.login.invitedBy', { name: inviter }) : ''}
            error={error}
            actions={<FlowPrimary busy={busy} disabled={!ready} onPress={() => void submit()}>{t('account.login.submitRegister')}</FlowPrimary>}
          >
            {nickField}
            <LineField label={t('account.login.password')} value={password} onChangeText={setPassword} placeholder={t('setup.admin.passwordHint')} secureTextEntry textContentType="newPassword" returnKeyType="go" onSubmitEditing={() => ready && void submit()} />
          </FlowStep>
        );
      }
      case 'recover': {
        const ready = !!server.trim() && !!name.trim() && !!key.trim() && password.length >= 8;
        return (
          <FlowStep
            onBack={() => go('login', true)}
            title={t('account.login.recoverTitle')}
            sub={t('account.login.recoverHint')}
            error={error}
            actions={<FlowPrimary busy={busy} disabled={!ready} onPress={() => void submit()}>{t('m.recoverGo')}</FlowPrimary>}
          >
            {serverLine}
            {nickField}
            <LineField label={t('account.keyInput.label')} value={key} onChangeText={setKey} autoCapitalize="characters" placeholder="XXXX-XXXX-…" maxLength={64} />
            <LineField label={t('account.login.newPassword')} value={password} onChangeText={setPassword} placeholder={t('setup.admin.passwordHint')} secureTextEntry textContentType="newPassword" returnKeyType="go" onSubmitEditing={() => ready && void submit()} />
          </FlowStep>
        );
      }
      case 'key':
        // Only on mocks: a real sign-up gets the app's own key screen (app/recovery.tsx) from the store.
        return <RecoveryKeyStep value={MOCK_KEY} nick={name.trim()} place={hostOf(server)} onNext={() => go('start', true)} />;
    }
  }

  const label = step === 'invite' || step === 'account' || step === 'key'
    ? t('own.stageOf', { stage: step === 'invite' ? t('account.login.inviteLabel') : t('m.account'), n: step === 'invite' ? 1 : 2, total: 2 })
    : undefined;
  return (
    <FlowShell fill={FILL[step]} label={label}>
      <Animated.View key={step} entering={(backwards ? FadeIn : SlideInRight).duration(320)} exiting={(backwards ? FadeOut : SlideOutLeft).duration(160)} style={{ flex: 1 }}>
        {screen()}
      </Animated.View>
    </FlowShell>
  );
}
