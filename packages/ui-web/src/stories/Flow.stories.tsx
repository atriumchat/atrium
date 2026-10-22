import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Drum, FlowPrimary, FlowSecondary, FlowShell, FlowStep, KeptRow, LineField, RadioRow, TextAction } from '../index';

/** Whole steps, as a flow shows them: the parts together, at a phone's width and a monitor's (resize the canvas). */
const meta: Meta = { title: 'Flow/Steps' };
export default meta;

const noop = () => undefined;

export const Fields: StoryObj = {
  render: () => (
    <FlowShell fill={0.1} label="Сервер (1/5)">
      <FlowStep title="Вход на сервер" sub="Адрес и пароль из письма хостинга" onBack={noop} actions={<FlowPrimary>Подключиться</FlowPrimary>}>
        <div className="flow-pair">
          <LineField label="Адрес" placeholder="203.0.113.10" />
          <LineField label="Логин" defaultValue="root" />
        </div>
        <LineField label="Пароль" type="password" placeholder="Из письма" error="Пароль не подошёл" />
      </FlowStep>
    </FlowShell>
  ),
};

export const Choice: StoryObj = {
  render: function Choice() {
    const [way, setWay] = useState<'free' | 'own'>('free');
    return (
      <FlowShell fill={0.3} label="Адрес (2/5)">
        <FlowStep title="Адрес сервера" sub="По нему друзья откроют сервер" onBack={noop} actions={<FlowPrimary>Дальше</FlowPrimary>}>
          <div role="radiogroup">
            <RadioRow title="Бесплатный" sub="имя.dedyn.io" on={way === 'free'} onPress={() => setWay('free')} />
            <RadioRow title="Свой домен" sub="Если он уже есть" on={way === 'own'} onPress={() => setWay('own')} last />
          </div>
        </FlowStep>
      </FlowShell>
    );
  },
};

export const KeptAndSkip: StoryObj = {
  render: () => (
    <FlowShell fill={0.45} label="Адрес (2/5)">
      <FlowStep
        title="Бесплатный адрес"
        sub="Имя и почта для письма"
        note="Письмо приходит за минуту"
        onBack={noop}
        actions={<FlowPrimary disabled>Дальше</FlowPrimary>}
        aside={<FlowSecondary onPress={noop}>Позже</FlowSecondary>}
        below={<TextAction onPress={noop}>У меня свой домен</TextAction>}
      >
        <KeptRow label="podval.dedyn.io" go="Взять" onPress={noop} />
        <LineField label="Имя" placeholder="podval" suffix=".dedyn.io" />
      </FlowStep>
    </FlowShell>
  ),
};

const TASKS = ['Проверка сервера', 'Адрес', 'Docker', 'Файрвол', 'Вход по ключу', 'Файлы', 'Настройки', 'Копии', 'Загрузка', 'Запуск', 'Сертификаты'];

export const Install: StoryObj<{ done: number }> = {
  args: { done: 4 },
  argTypes: { done: { control: { type: 'range', min: 0, max: TASKS.length } } },
  render: ({ done }) => (
    <FlowShell fill={0.5 + (0.3 * done) / TASKS.length} label="Установка (3/5)">
      <FlowStep title="Ставим Atrium" sub="Пара минут" actions={<FlowPrimary busy>Открыть</FlowPrimary>}>
        <Drum
          items={TASKS.map((label, i) => ({ id: String(i), label, state: i < done ? 'done' : i === done ? 'run' : undefined }))}
          current={String(done)}
        />
      </FlowStep>
    </FlowShell>
  ),
};
