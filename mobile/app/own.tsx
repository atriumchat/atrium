import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Linking, Pressable, Share, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import * as ImagePicker from 'expo-image-picker';
import { Image } from 'expo-image';
import Animated, { FadeIn, FadeOut, SlideInRight, SlideOutLeft } from 'react-native-reanimated';
import { ApiError, type Credentials } from '../src/api';
import { useT, type Key } from '../src/i18n';
import { Text } from '../src/text';
import { colors } from '../src/theme';
import { haptic } from '../src/haptics';
import { AtriumMark } from '../src/components/Logo';
import { Drum, FlowPrimary, FlowSecondary, FlowShell, FlowStep, KeptRow, LineField, RadioRow, RING, TextAction, useFlowFrame } from '@atrium/ui-native';
import { RecoveryKeyStep } from '../src/components/RecoveryKeyStep';
import { real } from '../src/own/backend';
import { DinoRun } from '../src/own/DinoRun';
import { adminForm, capacity, doneCount, emailOk as isEmail, jobFill, MOCK_DOMAIN, MOCK_INVITE, MOCK_KEY, MOCK_SETUP_CODE, OWN_READY, ownOnPhone, pickTurn, TASKS, type Facts, type OwnPhoneStep as Step, type Progress } from '@atrium/setup';
import { mock, mockInstall, mockPace } from '../src/own/mock';
import type { Saved } from '../src/own/setup';

/**
 * "Your own server" on the phone (src/own/setup.ts): the VPS from the host's e-mail becomes an Atrium server, then its
 * first run happens here too, as the web wizard does it in a browser (web/src/account/SetupWizard.tsx): the server's
 * name and icon, the admin, the recovery key, the first invite link. One scale along the screen's edge for the whole
 * way (EdgeTicks), the part with its number above it ("Адрес (2/5)"); the screens in type alone on black, no plates,
 * fields as lines. Nothing scrolls.
 */

const MAX_ICON = 8 * 1024 * 1024;

export default function OwnServer() {
  const { t } = useT();
  const router = useRouter();
  const params = useLocalSearchParams<{ mock?: string; step?: string; fast?: string }>();
  // Development only: the whole way on made-up answers (src/own/mock.ts), /own?mock=1&step=admin opening a step.
  const mocked = __DEV__ && !!params.mock;
  const frame = useFlowFrame();
  const own = mocked ? mock : real;
  const [step, setStep] = useState<Step>('server');
  const [backwards, setBackwards] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const [host, setHost] = useState('');
  const [user, setUser] = useState('root');
  const [password, setPassword] = useState('');
  const [facts, setFacts] = useState<Facts | null>(null);
  const [saved, setSaved] = useState<Saved | null>(null);
  const [earlier, setEarlier] = useState<Saved | null>(null);

  // The address: a free name is picked unless the person has a domain of their own.
  const [way, setWay] = useState<'free' | 'own'>('free');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [emailLeft, setEmailLeft] = useState(false);
  const emailOk = isEmail(email);
  const [domain, setDomain] = useState('');
  const turn = useRef(pickTurn()).current;

  const [progress, setProgress] = useState<Progress | null>(null);
  const [lost, setLost] = useState(false);
  // The server's own page answers over HTTPS: only then its setup goes on (a new address may still be spreading).
  const [reachable, setReachable] = useState(false);

  // The server's first run. The admin's session is made at "Create" and only signed in with at the end.
  const [serverName, setServerName] = useState('');
  const [defaultName, setDefaultName] = useState('Atrium');
  const [icon, setIcon] = useState<string | null>(null);
  const [iconSent, setIconSent] = useState(false);
  const [nick, setNick] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [admin, setAdmin] = useState<(Credentials & { named: string }) | null>(null);
  const [recoveryKey, setRecoveryKey] = useState('');
  const [link, setLink] = useState('');
  const [linkSent, setLinkSent] = useState<'copied' | 'shared' | null>(null);

  // An install started earlier (the app was closed) is offered again; a deSEC account made before can be reused.
  useEffect(() => {
    void own.loadSaved().then(setEarlier);
    return () => {
      own.cancelMail();
      own.close();
    };
  }, []);

  // A step opened directly on mocks gets what the steps before it would have left.
  useEffect(() => {
    if (mocked && params.fast) mockPace(2);
    const at = params.step;
    if (!mocked || !at) return;
    const ip = '203.0.113.10';
    const domain = MOCK_DOMAIN;
    setHost(ip);
    setFacts({ ip, os: 'Ubuntu 24.04 LTS · x86_64', root: true, cores: 1, memory: 1.9, disk: 17 });
    setSaved({ host: ip, ip, user: 'root', turn, cores: 1, memory: 1.9, domain: at === 'address' || at === 'free' || at === 'own' ? undefined : domain });
    if (at === 'mail') setEmail('me@example.com');
    if (at === 'install') mockInstall('start', domain);
    if (['ready', 'name', 'admin', 'key', 'invite'].includes(at)) {
      mockInstall('done', domain);
      setProgress({ steps: {}, current: null, doing: '', ready: `https://app.${domain}/?setup=${MOCK_SETUP_CODE}`, exit: 0, failed: null });
      setReachable(at !== 'ready');
    }
    if (at === 'admin' || at === 'key' || at === 'invite') setServerName('Подвал');
    if (at === 'key' || at === 'invite') {
      setNick('Тимур');
      setAdmin({ server: `https://app.${domain}`, token: 'mock', named: 'Подвал' });
      setRecoveryKey(MOCK_KEY);
      setLink(`https://app.${domain}/?invite=${MOCK_INVITE}`);
    }
    setStep(at === 'ready' ? 'install' : (at as Step));
  }, []);

  function go(next: Step, isBack = false) {
    setBackwards(isBack);
    setError('');
    setStep(next);
  }

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await action();
    } finally {
      setBusy(false);
    }
  }

  /* ---------- the server ---------- */

  function connectServer() {
    void run(async () => {
      const result = await own.connect({ host, user, password });
      if ('error' in result) {
        haptic.error();
        return setError(result.error);
      }
      haptic.success();
      setFacts(result.facts);
      // The key and the deSEC account of an earlier server stay; a new server gets its own key.
      setSaved({ host: host.trim(), ip: result.facts.ip, user: user.trim() || 'root', turn, cores: result.facts.cores, memory: result.facts.memory, desec: earlier?.desec, hostKey: result.hostKey });
      go('address');
    });
  }

  function resumeEarlier() {
    if (!earlier) return;
    void run(async () => {
      const result = await own.resume(earlier, password || null);
      if ('error' in result) return setError(result.error);
      setSaved(earlier);
      go('install');
    });
  }

  /** A server installed earlier: straight to its setup, no SSH needed (password login is off there by now). */
  function openEarlier() {
    if (!earlier?.url) return;
    setSaved(earlier);
    setProgress({ steps: {}, current: null, doing: '', ready: earlier.url, exit: null, failed: null });
    go('install');
  }

  /* ---------- the address ---------- */

  async function install(next: Saved) {
    setSaved(next);
    const result = await own.startInstall(next);
    if ('error' in result) {
      haptic.error();
      return setError(result.error);
    }
    setProgress(null);
    go('install');
  }

  function freeName() {
    void run(async () => {
      const result = await own.register({ name, email });
      if ('error' in result) return setError(result.error);
      go('mail');
    });
  }

  function useSavedName() {
    if (!saved?.desec) return;
    void run(async () => {
      const result = await own.reuse(saved.desec!, saved.ip);
      if ('error' in result) return setError(result.error);
      await install({ ...saved, domain: result.domain });
    });
  }

  // The letter: waited for while this step is up; confirmed, the name points here and the install starts by itself.
  useEffect(() => {
    if (step !== 'mail' || !saved) return;
    let live = true;
    void own.waitMail(saved.ip).then(async (result) => {
      if (!live) return;
      if ('error' in result) return setError(result.error);
      haptic.success();
      const next = { ...saved, domain: result.domain, desec: result.account };
      await own.save(next);
      await install(next);
    });
    return () => {
      live = false;
      own.cancelMail();
    };
  }, [step]);

  function ownDomain() {
    if (!saved) return;
    void run(async () => {
      const result = await own.checkDomain(domain, turn, saved.ip);
      if ('error' in result) return setError(result.error);
      await install({ ...saved, domain: domain.trim().toLowerCase() });
    });
  }

  /* ---------- the install ---------- */

  const ready = progress?.ready ?? null;
  // A run of the game going when the server came up is played out first: the screen waits for "Next" in the game.
  const [playing, setPlaying] = useState(false);
  const [lastRun, setLastRun] = useState(false);
  useEffect(() => {
    if (ready && playing) setLastRun(true);
  }, [ready]);
  const installing = step === 'install' && (!ready || lastRun);
  const failed = !ready && progress && (progress.failed || progress.exit !== null) ? progress.failed || t('own.install.stopped', { code: progress.exit ?? '?' }) : null;

  // The log on the server, read every second and a half while the step is up, and at once when the app comes back.
  useEffect(() => {
    if (step !== 'install' || ready || failed) return;
    let live = true;
    const poll = async () => {
      try {
        const next = await own.readProgress();
        if (!live) return;
        setLost(false);
        setProgress(next);
        if (next.ready) {
          haptic.success();
          if (saved) await own.save({ ...saved, url: next.ready, started: undefined });
        } else if (next.failed || next.exit !== null) haptic.error();
      } catch {
        if (live) setLost(true);
      }
    };
    void poll();
    const timer = setInterval(poll, 1500);
    const sub = AppState.addEventListener('change', (state) => state === 'active' && void poll());
    return () => {
      live = false;
      clearInterval(timer);
      sub.remove();
    };
  }, [step, ready, failed]);

  useEffect(() => {
    if (!ready || reachable) return;
    let live = true;
    const origin = new URL(ready).origin;
    const check = async () => {
      try {
        if (live && (await own.reachable(origin))) {
          setReachable(true);
          haptic.success();
        }
      } catch {
        // No certificate yet or the name doesn't resolve: try again.
      }
    };
    void check();
    const timer = setInterval(check, 4000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [ready, reachable]);

  /* ---------- the server's first run ---------- */

  // The installer's link carries the code that makes the admin (?setup=CODE); without it the server already has one.
  const origin = ready ? new URL(ready).origin : '';
  const code = ready ? new URL(ready).searchParams.get('setup') ?? '' : '';
  const title = serverName.trim() || defaultName;
  const toSignIn = () => router.replace({ pathname: '/login', params: { server: origin } });

  function startSetup() {
    if (!ready) return;
    haptic.tap();
    void run(async () => {
      try {
        const status = await own.setupStatus(origin);
        if (!status.needed || !code) return toSignIn();
        setDefaultName(status.serverName);
        go('name');
      } catch (e) {
        setError(e instanceof Error ? e.message : t('setup.error.failed'));
      }
    });
  }

  async function pickIcon() {
    const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.9 });
    const image = picked.canceled ? null : picked.assets[0];
    if (!image) return;
    if ((image.fileSize ?? 0) > MAX_ICON) return setError(t('setup.server.tooBig'));
    setError('');
    setIcon(image.uri);
    setIconSent(false);
  }

  function createAdmin() {
    if (adminPassword !== repeat) return setError(t('setup.admin.mismatch'));
    void run(async () => {
      try {
        // A retry after an error doesn't make the admin twice, nor send the icon again.
        let made = admin;
        if (!made) {
          const session = await own.setup(origin, code, title, nick.trim(), adminPassword);
          made = { server: origin, token: session.token, named: title };
          setAdmin(made);
        } else if (made.named !== title) {
          await own.renameServer(title, made);
          made = { ...made, named: title };
          setAdmin(made);
        }
        if (icon && !iconSent) {
          await own.uploadServerIcon(icon, made);
          setIconSent(true);
        }
        if (!recoveryKey) setRecoveryKey((await own.makeRecoveryKey(adminPassword, made)).key);
        if (!link) setLink(`${origin}/?invite=${encodeURIComponent((await own.invite(made)).code)}`);
        haptic.success();
        go('key');
      } catch (e) {
        haptic.error();
        // Someone finished the setup first (another phone, a browser): sign in there.
        if (e instanceof ApiError && e.status === 409) return toSignIn();
        setError(e instanceof Error ? e.message : t('setup.error.failed'));
      }
    });
  }

  async function shareLink() {
    const result = await Share.share({ message: link });
    if (result.action === Share.sharedAction) setLinkSent('shared');
  }

  /** Into the app as the admin. The key has been shown here, so the app's own key screen doesn't come again. */
  function finish() {
    if (!admin) return;
    void run(async () => {
      if (saved) await own.save({ ...saved, url: origin, started: undefined });
      await own.enter(admin.server, admin.token, null);
      if (mocked) router.back();
    });
  }

  /* ---------- the edge and the header ---------- */

  const fill = step === 'install' ? jobFill(ownOnPhone.fill('install'), OWN_READY, doneCount(progress), TASKS.length, !!ready) : ownOnPhone.fill(step);
  const stage = ownOnPhone.stage(step);
  const size = facts ?? (saved?.cores ? { cores: saved.cores, memory: saved.memory ?? 1 } : null);

  // Back along the way walked (ownOnPhone); from the first step, or the install once it's over, back leaves.
  const backTo = ownOnPhone.back(step, undefined);
  const leaves = step === 'server' || (step === 'install' && (!!failed || !!ready));
  const back = backTo || leaves ? () => (backTo ? goBack(backTo) : router.back()) : undefined;
  function goBack(to: Step) {
    // Back off the address, the server's SSH session goes with it.
    if (step === 'address') own.close();
    go(to, true);
  }

  /* ---------- the steps ---------- */

  function screen() {
    switch (step) {
      case 'server':
        return (
          <FlowStep
            onBack={back}
            title={t('own.server.h')}
            sub={t('own.server.sub')}
            error={error}
            actions={<FlowPrimary busy={busy} disabled={!host.trim() || !password} onPress={connectServer}>{t('own.connect')}</FlowPrimary>}
          >
            {earlier?.started && !earlier.url ? <KeptRow label={t('own.resume', { host: earlier.domain ?? earlier.host })} go={t('own.resumeGo')} onPress={resumeEarlier} /> : null}
            {earlier?.url ? <KeptRow label={t('own.installed', { host: earlier.domain ?? earlier.host })} go={t('own.installedGo')} onPress={openEarlier} /> : null}
            <View style={{ flexDirection: 'row', gap: 20 }}>
              <LineField style={{ flex: 2 }} label={t('own.ip')} value={host} onChangeText={setHost} placeholder="203.0.113.10" keyboardType="numbers-and-punctuation" returnKeyType="next" />
              <LineField style={{ flex: 1 }} label={t('own.login')} value={user} onChangeText={setUser} />
            </View>
            <LineField label={t('own.password')} value={password} onChangeText={setPassword} placeholder={t('own.passwordHint')} secureTextEntry textContentType="password" returnKeyType="go" onSubmitEditing={() => host.trim() && password && connectServer()} />
          </FlowStep>
        );
      case 'address':
        return (
          <FlowStep
            onBack={back}
            title={t('own.address.h')}
            sub={t('own.address.sub')}
            error={error}
            actions={<FlowPrimary onPress={() => go(way)}>{t('own.next')}</FlowPrimary>}
          >
            <View accessibilityRole="radiogroup">
              <RadioRow title={t('own.free')} sub={t('own.freeSub')} on={way === 'free'} onPress={() => setWay('free')} />
              <RadioRow title={t('own.own')} sub={t('own.ownSub')} on={way === 'own'} onPress={() => setWay('own')} last />
            </View>
          </FlowStep>
        );
      case 'free':
        return (
          <FlowStep
            onBack={back}
            title={t('own.free')}
            sub={t('own.free.sub')}
            error={error}
            actions={<FlowPrimary busy={busy} disabled={!name || !emailOk} onPress={freeName}>{t('own.next')}</FlowPrimary>}
          >
            {saved?.desec ? <KeptRow label={t('own.savedName', { domain: `${saved.desec.name}.dedyn.io` })} go={t('own.useSaved')} onPress={useSavedName} /> : null}
            <LineField label={t('own.name')} value={name} onChangeText={(v) => setName(v.replace(/\s/g, '').toLowerCase())} placeholder="podval" suffix=".dedyn.io" />
            <LineField label={t('own.email')} value={email} onChangeText={(v) => (setEmail(v), setEmailLeft(false))} onBlur={() => setEmailLeft(true)} error={emailLeft && !!email.trim() && !emailOk && t('own.emailBad')} placeholder="you@example.com" keyboardType="email-address" textContentType="emailAddress" returnKeyType="go" onSubmitEditing={() => name && emailOk && freeName()} />
          </FlowStep>
        );
      case 'mail':
        return (
          <FlowStep
            onBack={back}
            title={t('own.mail.h')}
            sub={t('own.mail.sub')}
            error={error}
            actions={<FlowPrimary onPress={() => void Linking.openURL('message://')}>{t('own.mail.open')}</FlowPrimary>}
          >
            <View>
              <Text numberOfLines={1} style={{ fontSize: 22, lineHeight: 28 }}>{email.trim()}</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 }}>
                <ActivityIndicator size="small" color={colors.muted} />
                <Text style={{ fontSize: 16, color: colors.muted }}>{t('own.mail.waiting')}</Text>
              </View>
            </View>
            <Text style={{ fontSize: 15, color: colors.muted }}>{t('own.mail.spam')}</Text>
          </FlowStep>
        );
      case 'own':
        return (
          <FlowStep
            onBack={back}
            title={t('own.own')}
            sub={t('own.own.sub')}
            error={error}
            actions={<FlowPrimary busy={busy} disabled={!domain.trim()} onPress={ownDomain}>{t('own.check')}</FlowPrimary>}
          >
            <LineField label={t('own.domain')} value={domain} onChangeText={setDomain} placeholder="chat.example.com" keyboardType="url" returnKeyType="go" onSubmitEditing={() => domain && ownDomain()} />
            <View style={{ gap: 6 }}>
              {['', 'app.', `${turn}.`].map((prefix) => (
                <View key={prefix} style={{ flexDirection: 'row', gap: 10 }}>
                  <Text numberOfLines={1} style={{ flex: 1, fontSize: 17 }}>{`${prefix}${domain.trim().toLowerCase() || 'example.com'}`}</Text>
                  <Text style={{ fontSize: 17, color: colors.muted }}>A {saved?.ip}</Text>
                </View>
              ))}
            </View>
          </FlowStep>
        );
      case 'install':
        return !installing ? (
          <FlowStep
            onBack={back}
            // The server is up, but its address doesn't open yet (a new name spreads, the certificate comes after it):
            // said as such, not as a greyed button.
            title={reachable ? t('own.install.ready') : t('own.install.almost')}
            sub={saved?.domain ?? ''}
            error={error}
            actions={<FlowPrimary busy={busy} disabled={!reachable} onPress={startSetup}>{reachable ? t('own.install.open') : t('own.install.waitButton')}</FlowPrimary>}
          >
            {!reachable ? (
              <View style={{ flexDirection: 'row', gap: 12, marginBottom: 16 }}>
                <ActivityIndicator color={colors.text} style={{ alignSelf: "flex-start", marginTop: 2 }} />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 18, lineHeight: 24 }}>{t('own.install.waitAddress')}</Text>
                  <Text style={{ marginTop: 4, fontSize: 15, lineHeight: 20, color: colors.muted }}>{t('own.install.waitHint')}</Text>
                </View>
              </View>
            ) : null}
            {size ? <Capacity size={size} /> : null}
          </FlowStep>
        ) : null;
      case 'name':
        return (
          <FlowStep
            onBack={back}
            title={t('setup.server.title')}
            sub={t('setup.server.sub')}
            error={error}
            actions={<FlowPrimary disabled={!serverName.trim()} onPress={() => go('admin')}>{t('setup.next')}</FlowPrimary>}
            aside={<FlowSecondary onPress={() => (setServerName(''), setIcon(null), go('admin'))}>{t('setup.server.skip')}</FlowSecondary>}
          >
            <LineField label={t('setup.server.nameLabel')} value={serverName} onChangeText={setServerName} maxLength={40} placeholder={t('setup.server.namePlaceholder')} autoComplete="off" textContentType="none" autoCapitalize="sentences" returnKeyType="next" onSubmitEditing={() => serverName.trim() && go('admin')} />
            <Pressable accessibilityRole="button" onPress={() => void pickIcon()} style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
              {icon ? <Image source={{ uri: icon }} style={{ width: 56, height: 56, borderRadius: 28 }} /> : <AtriumMark size={56} />}
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 20 }}>{t('setup.server.icon')}</Text>
                <Text style={{ fontSize: 15, textDecorationLine: 'underline' }}>{icon ? t('setup.server.another') : t('setup.server.choose')}</Text>
              </View>
              {icon ? <TextAction onPress={() => (setIcon(null), setIconSent(false))}>{t('setup.server.remove')}</TextAction> : null}
            </Pressable>
          </FlowStep>
        );
      case 'admin': {
        const { ready: adminReady, mismatch } = adminForm(nick, adminPassword, repeat);
        return (
          <FlowStep
            onBack={back}
            title={t('setup.admin.title')}
            sub={t('setup.admin.sub')}
            error={error}
            actions={<FlowPrimary busy={busy} disabled={!adminReady} onPress={createAdmin}>{t('setup.admin.create')}</FlowPrimary>}
          >
            <LineField label={t('setup.admin.nick')} value={nick} onChangeText={(v) => (setNick(v), setError(''))} maxLength={32} placeholder={t('setup.admin.nickPlaceholder')} textContentType="username" editable={!admin} returnKeyType="next" />
            <View style={{ flexDirection: 'row', gap: 20 }}>
              <LineField style={{ flex: 1 }} label={t('setup.admin.password')} value={adminPassword} onChangeText={setAdminPassword} secureTextEntry textContentType="newPassword" placeholder={t('setup.admin.passwordHint')} editable={!admin} />
              <LineField style={{ flex: 1 }} error={mismatch && t('setup.admin.mismatch')} label={t('setup.admin.repeat')} value={repeat} onChangeText={setRepeat} placeholder={t('own.repeatHint')} secureTextEntry textContentType="newPassword" editable={!admin} returnKeyType="go" onSubmitEditing={createAdmin} />
            </View>
          </FlowStep>
        );
      }
      case 'key':
        return <RecoveryKeyStep value={recoveryKey} nick={nick.trim()} place={`${title} · ${origin}`} onNext={() => go('invite')} />;
      case 'invite':
        return (
          <FlowStep
            title={t('setup.invite.title')}
            sub={t('setup.invite.sub')}
            error={error}
            actions={linkSent ? <FlowPrimary busy={busy} onPress={finish}>{t('own.invite.done')}</FlowPrimary> : <FlowPrimary onPress={() => void shareLink()}>{t('setup.invite.share')}</FlowPrimary>}
            aside={linkSent ? undefined : <FlowSecondary onPress={finish}>{t('setup.invite.later')}</FlowSecondary>}
          >
            <Text numberOfLines={2} style={{ fontSize: 22, lineHeight: 28 }}>{link.replace(/^https?:\/\//, '') || t('setup.invite.loading')}</Text>
            <TextAction left onPress={() => { void Clipboard.setStringAsync(link); haptic.tap(); setLinkSent((sent) => sent ?? 'copied'); }}>{linkSent === 'copied' ? t('common.copy.done') : t('common.copy.label')}</TextAction>
          </FlowStep>
        );
    }
  }

  return (
    <FlowShell
      fill={fill}
      label={stage ? t('own.stageOf', { stage: t(`own.stage.${stage.part}`), n: stage.n, total: stage.total }) : undefined}
      // While it installs (and hasn't failed), the game takes the bottom of the screen, edge to edge.
      bottom={
        installing && !failed ? (
          <Animated.View entering={FadeIn.duration(400)} exiting={FadeOut.duration(200)}>
            <DinoRun below={Math.max(8, frame.insets.bottom + 6 - RING)} last={!!ready} onPlaying={setPlaying} onLeave={() => setLastRun(false)} />
          </Animated.View>
        ) : undefined
      }
    >
      <Animated.View
        key={step === 'install' ? (installing ? 'install' : 'ready') : step}
        entering={(backwards ? FadeIn : SlideInRight).duration(320)}
        exiting={(backwards ? FadeOut : SlideOutLeft).duration(160)}
        style={{ flex: 1 }}
      >
        {installing ? (
          <FlowStep
            title={ready ? t('own.install.ready') : t('own.install.title')}
            sub={ready ? t('own.game.lastSub') : t('own.install.sub')}
            error={failed}
            note={lost ? t('own.install.reconnect') : undefined}
            actions={failed && saved ? <FlowPrimary busy={busy} onPress={() => void run(() => install(saved))}>{t('own.install.retry')}</FlowPrimary> : undefined}
          >
            <Drum items={TASKS.map((id) => ({ id, label: t(`own.task.${id}` as Key), state: progress?.steps[id]?.state }))} current={progress?.current ?? null} />
          </FlowStep>
        ) : (
          screen()
        )}
      </Animated.View>
    </FlowShell>
  );
}

/** How many people the server takes, instead of its specs (capacity.ts), set as Zune would: big thin numbers, a word under each. */
function Capacity({ size }: { size: { cores: number; memory: number } }) {
  const { t } = useT();
  const { call, screen } = capacity(size);
  const rows: [string, string][] = [
    [String(call), t('own.cap.call')],
    [String(screen), t('own.cap.screen')],
    ['100+', t('own.cap.members')],
  ];
  return (
    <View style={{ gap: 18 }}>
      {rows.map(([n, label]) => (
        <View key={label}>
          <Text style={{ fontSize: 64, lineHeight: 64, letterSpacing: -3, fontVariant: ['tabular-nums'] }}>{n}</Text>
          <Text style={{ fontSize: 18, lineHeight: 22, color: colors.muted }}>{label.toLowerCase()}</Text>
        </View>
      ))}
    </View>
  );
}
