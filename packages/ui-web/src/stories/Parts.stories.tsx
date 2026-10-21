import type { Meta, StoryObj } from '@storybook/react-vite';
import { FlowPrimary, FlowSecondary, LineField, RadioRow, TextAction } from '../index';

/** Each part alone, its states as controls. */
const meta: Meta = {
  title: 'Flow/Parts',
  decorators: [(Story) => <div style={{ maxWidth: 480, padding: 38 }}><Story /></div>],
};
export default meta;

const noop = () => undefined;

export const Primary: StoryObj<typeof FlowPrimary> = {
  args: { children: 'Дальше', disabled: false, busy: false },
  render: (args) => <div className="flow-buttons"><FlowPrimary {...args} /></div>,
};

export const PrimaryWithSecondary: StoryObj = {
  render: () => (
    <div className="flow-buttons">
      <FlowPrimary>Дальше</FlowPrimary>
      <FlowSecondary onPress={noop}>Позже</FlowSecondary>
    </div>
  ),
};

export const Field: StoryObj<typeof LineField> = {
  args: { label: 'Почта', placeholder: 'you@gmail.com', error: '', suffix: '' },
  render: (args) => <LineField {...args} />,
};

export const Radio: StoryObj<typeof RadioRow> = {
  args: { title: 'Бесплатный', sub: 'имя.dedyn.io', on: true, last: true, onPress: noop },
  render: (args) => <RadioRow {...args} />,
};

export const Text: StoryObj<typeof TextAction> = {
  args: { children: 'Скопировать', left: false, onPress: noop },
  render: (args) => <div style={{ display: 'flex', flexDirection: 'column' }}><TextAction {...args} /></div>,
};
