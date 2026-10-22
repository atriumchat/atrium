import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Redirect } from 'expo-router';
import { Drum, FlowPrimary, FlowSecondary, FlowShell, FlowStep, KeptRow, LineField, RadioRow, TextAction } from '@atrium/ui-native';

/**
 * Atrium Flow's native parts on one screen, every state a tap away (the web's are in Storybook, @atrium/ui-web).
 * Development builds only: /design.
 */

const TASKS = ['Проверка сервера', 'Адрес', 'Docker', 'Файрвол', 'Вход по ключу', 'Файлы', 'Настройки', 'Копии', 'Загрузка', 'Запуск', 'Сертификаты'];

export default function Design() {
  const [done, setDone] = useState(3);
  const [way, setWay] = useState<'free' | 'own'>('free');
  const [busy, setBusy] = useState(false);
  if (!__DEV__) return <Redirect href="/" />;
  const step = () => setDone((d) => (d + 1) % (TASKS.length + 1));
  return (
    <FlowShell fill={done / TASKS.length} label={`Atrium Flow (${done}/${TASKS.length})`}>
      <ScrollView contentContainerStyle={{ flexGrow: 1 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <FlowStep
          title="Части"
          sub="Каждая в своих состояниях"
          note="Заметка над кнопками"
          error={way === 'own' ? 'Общая ошибка шага' : null}
          onBack={step}
          onSubmit={() => setBusy((b) => !b)}
          actions={<FlowPrimary busy={busy} onPress={() => setBusy((b) => !b)}>Дальше</FlowPrimary>}
          aside={<FlowSecondary onPress={step}>Позже</FlowSecondary>}
          below={<TextAction onPress={step}>Текстовое действие</TextAction>}
        >
          <LineField label="Поле" placeholder="Подсказка" />
          <LineField label="С ошибкой" placeholder="you@gmail.com" suffix=".dedyn.io" error="Ошибка под полем" />
          <KeptRow label="podval.dedyn.io" go="Взять" onPress={step} />
          <FlowPrimary disabled>Недоступна</FlowPrimary>
          <View accessibilityRole="radiogroup">
            <RadioRow title="Бесплатный" sub="имя.dedyn.io" on={way === 'free'} onPress={() => setWay('free')} />
            <RadioRow title="Свой домен" sub="Показывает общую ошибку" on={way === 'own'} onPress={() => setWay('own')} last />
          </View>
          <Drum items={TASKS.map((label, i) => ({ id: String(i), label, state: i < done ? 'done' : i === done ? 'run' : undefined }))} current={String(done)} />
        </FlowStep>
      </ScrollView>
    </FlowShell>
  );
}
