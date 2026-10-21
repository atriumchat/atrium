import { useEffect } from 'react';
import Animated, { FadeInUp, FadeOutUp } from 'react-native-reanimated';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { ThemeProvider, DarkTheme } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import { useFonts, Onest_400Regular, Onest_500Medium, Onest_600SemiBold, Onest_700Bold } from '@expo-google-fonts/onest';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { startSession, useStore } from '../src/store';
import { useT } from '../src/i18n';
import { Text } from '../src/text';
import { colors } from '../src/theme';
import { useRing } from '../src/shell/useRing';

const theme = { ...DarkTheme, colors: { ...DarkTheme.colors, primary: '#ffffff', background: colors.window, card: colors.window, text: '#ffffff', border: colors.separator } };
const page = { headerShown: true, headerStyle: { backgroundColor: colors.window }, headerTintColor: '#fff', headerShadowVisible: false, headerBackButtonDisplayMode: 'minimal' as const, contentStyle: { backgroundColor: colors.window } };

export default function RootLayout() {
  const [fontsReady] = useFonts({ Onest_400Regular, Onest_500Medium, Onest_600SemiBold, Onest_700Bold });
  const ready = useStore((s) => s.ready);
  const authenticated = useStore((s) => s.authenticated);
  const recovery = useStore((s) => s.recoveryKey);
  const error = useStore((s) => s.error);
  const router = useRouter();
  const segments = useSegments();
  const { t } = useT();
  useEffect(() => { void startSession(); }, []);
  useRing();
  useEffect(() => {
    if (!ready) return;
    // "Your own server" is reached signed out, from the sign-in page.
    const login = segments[0] === 'login' || segments[0] === 'own';
    if (!authenticated && !login) router.replace('/login');
    else if (authenticated && recovery && segments[0] !== 'recovery') router.replace('/recovery');
    else if (authenticated && !recovery && (login || segments[0] === 'recovery')) router.replace('/');
  }, [ready, authenticated, recovery, segments, router]);
  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(() => useStore.setState({ error: null }), 7000);
    return () => clearTimeout(timer);
  }, [error]);
  return (
    <SafeAreaProvider>
      <ThemeProvider value={theme}>
        <StatusBar style="light" />
        {!ready || !fontsReady ? (
          <View style={{ flex: 1, backgroundColor: colors.window, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color="white" accessibilityLabel={t('m.loading')} /></View>
        ) : (
          <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.window } }}>
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="login" options={{ gestureEnabled: false, animation: 'fade' }} />
            <Stack.Screen name="own" />
            <Stack.Screen name="recovery" options={{ gestureEnabled: false }} />
            <Stack.Screen name="chat/[id]" />
            <Stack.Screen name="room/[id]" />
            <Stack.Screen name="friends" />
            <Stack.Screen name="you/profile" options={page} />
            <Stack.Screen name="you/status" options={page} />
            <Stack.Screen name="you/bio" options={page} />
            <Stack.Screen name="you/settings" options={page} />
            <Stack.Screen name="inbox" options={{ presentation: 'formSheet', sheetAllowedDetents: [0.7, 1], sheetGrabberVisible: true, contentStyle: { backgroundColor: colors.overlay } }} />
            <Stack.Screen name="user/[id]" options={{ presentation: 'formSheet', sheetAllowedDetents: [0.6, 1], sheetGrabberVisible: true, contentStyle: { backgroundColor: colors.overlay } }} />
            <Stack.Screen name="group" options={{ presentation: 'formSheet', sheetAllowedDetents: [0.7, 1], sheetGrabberVisible: true, contentStyle: { backgroundColor: colors.overlay } }} />
            <Stack.Screen name="members/[id]" options={{ presentation: 'formSheet', sheetAllowedDetents: [0.75, 1], sheetGrabberVisible: true, contentStyle: { backgroundColor: colors.overlay } }} />
          </Stack>
        )}
        {error ? (
          <Animated.View key={error} entering={FadeInUp.duration(200)} exiting={FadeOutUp.duration(160)} style={{ position: 'absolute', top: 64, left: 16, right: 16, zIndex: 100 }}>
            <Pressable accessibilityRole="alert" onPress={() => useStore.setState({ error: null })} style={{ borderRadius: 20, padding: 18, backgroundColor: '#541c1c' }}>
              <Text style={{ lineHeight: 21 }}>{error}</Text>
            </Pressable>
          </Animated.View>
        ) : null}
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
