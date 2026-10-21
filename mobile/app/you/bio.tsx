import { useState } from 'react';
import { KeyboardAvoidingView, View } from 'react-native';
import { router, Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../../src/api';
import { showError, useStore } from '../../src/store';
import { useT } from '../../src/i18n';
import { colors } from '../../src/theme';
import { Field, Primary } from '../../src/components/Settings';

export default function Bio() {
  const { t } = useT();
  const insets = useSafeAreaInsets();
  const saved = useStore((s) => s.data?.me.bio ?? '');
  const [bio, setBio] = useState(saved);
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      const me = await api.updateMe(bio);
      useStore.setState((s) => ({ users: { ...s.users, [me.id]: me }, data: s.data ? { ...s.data, me } : null }));
      router.back();
    } catch (e) { showError(e instanceof Error ? e.message : t('shell.you.saveFailed')); } finally { setBusy(false); }
  }
  return (
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: colors.window }}>
      <Stack.Screen options={{ title: t('shell.you.bio') }} />
      <View style={{ flex: 1, padding: 16, paddingTop: 8 }}>
        <Field autoFocus multiline value={bio} onChangeText={setBio} maxLength={190} placeholder={t('shell.you.bioPlaceholder')} accessibilityLabel={t('shell.you.bio')} autoCapitalize="sentences" />
      </View>
      <View style={{ padding: 16, paddingBottom: Math.max(16, insets.bottom) }}><Primary busy={busy} disabled={bio.trim() === saved} onPress={() => void save()}>{t('shell.you.save')}</Primary></View>
    </KeyboardAvoidingView>
  );
}
