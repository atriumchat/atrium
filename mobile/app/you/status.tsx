import { useState } from 'react';
import { ActionSheetIOS, ScrollView, View } from 'react-native';
import { Stack } from 'expo-router';
import { api } from '../../src/api';
import { showError, useStore } from '../../src/store';
import { t as tt, useT, type Key } from '../../src/i18n';
import { colors } from '../../src/theme';
import { Field, FieldLabel, Row, RowIcon, Rows, StatusDot } from '../../src/components/Settings';
import { CheckIcon } from '../../src/icons';
import { statusUntil } from '../../src/format';
import { haptic } from '../../src/haptics';
import type { MyStatus } from '../../src/protocol';
import { statusKey } from '../../src/shell/You';

const DURATIONS: [number, Key][] = [[15, 'shell.duration.m15'], [60, 'shell.duration.h1'], [8 * 60, 'shell.duration.h8'], [24 * 60, 'shell.duration.h24'], [3 * 24 * 60, 'shell.duration.d3'], [0, 'shell.duration.forever']];

async function saveStatus(status: MyStatus, text: string, minutes?: number) {
  try {
    const r = await api.status(status, text.trim(), minutes);
    useStore.setState((s) => ({ data: s.data ? { ...s.data, myStatus: r.status, myStatusText: r.text, myStatusUntil: r.until } : null }));
  } catch (e) { showError(e instanceof Error ? e.message : tt('shell.status.changeFailed')); }
}

/** Online, do not disturb or invisible (the last two for how long, in a native sheet), and a line of your own. */
export default function StatusPage() {
  const { t } = useT();
  const status = useStore((s) => s.data?.myStatus ?? 'online');
  const until = useStore((s) => s.data?.myStatusUntil);
  const saved = useStore((s) => s.data?.myStatusText ?? '');
  const [text, setText] = useState(saved);
  const hint: Record<MyStatus, string> = { online: '', dnd: t('shell.status.dndHint'), invisible: t('shell.status.invisibleHint') };
  function choose(id: MyStatus) {
    haptic.select();
    if (id === 'online') return void saveStatus('online', text);
    const options = [...DURATIONS.map(([, key]) => t(key)), t('common.cancel')];
    ActionSheetIOS.showActionSheetWithOptions({ title: t('shell.status.duration', { status: t(statusKey[id]) }), options, cancelButtonIndex: options.length - 1, userInterfaceStyle: 'dark' }, (i) => {
      const picked = DURATIONS[i];
      if (picked) void saveStatus(id, text, picked[0]);
    });
  }
  return (
    <ScrollView style={{ backgroundColor: colors.window }} contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 16, paddingTop: 8 }}>
      <Stack.Screen options={{ title: t('shell.status.title') }} />
      <Rows>
        {(['online', 'dnd', 'invisible'] as const).map((id, i) => (
          <Row key={id} icon={<RowIcon><StatusDot status={id} /></RowIcon>} title={t(statusKey[id])} value={status === id && id !== 'online' && until ? statusUntil(until) : hint[id] || undefined} chevron={false} onPress={() => choose(id)} last={i === 2}>
            {status === id ? <CheckIcon size={20} /> : null}
          </Row>
        ))}
      </Rows>
      <View style={{ marginTop: 24, paddingHorizontal: 16 }}><FieldLabel>{t('shell.status.own')}</FieldLabel></View>
      <Field value={text} maxLength={64} onChangeText={setText} onBlur={() => text.trim() !== saved && void saveStatus(status, text)} onSubmitEditing={() => void saveStatus(status, text)} returnKeyType="done" placeholder={t('shell.status.placeholder')} autoCapitalize="sentences" />
    </ScrollView>
  );
}
