import type { ReactNode } from 'react';

/**
 * The Gomex Flow components' props, the same on every platform: @gomex/ui-web and @gomex/ui-native implement these
 * names and add only what their platform has (a DOM input's attributes, a TextInput's). Handlers are `onPress` on both,
 * as in React Native.
 */

/** The page under a flow: the scale (`fill`, 0…1, one for the whole flow) and the part it's in, "Адрес (2/5)". */
export type FlowShellProps = {
  fill: number;
  label?: string;
  /** Laid along the screen's bottom edge to edge, kept inside the ticks (the install's game). */
  bottom?: ReactNode;
  children: ReactNode;
};

/**
 * A step: the title and its line, the fields, and at the bottom the buttons. `error` and `note` stand over the buttons
 * (a field's own error goes under the field); `below` goes under them; `aside` is a small outlined button right of the
 * main one (skip, later). `onSubmit` makes Enter do what the main button does, where there is a keyboard.
 */
export type FlowStepProps = {
  title: string;
  sub?: string;
  error?: string | null;
  note?: string;
  /** Keeps the note's room without showing it, so the buttons don't jump when it comes. */
  noteHidden?: boolean;
  actions?: ReactNode;
  aside?: ReactNode;
  below?: ReactNode;
  onBack?: () => void;
  onSubmit?: () => void;
  children?: ReactNode;
};

/** The one main button: a white pill. */
export type FlowPrimaryProps = {
  onPress?: () => void;
  disabled?: boolean;
  busy?: boolean;
  children: string;
};

/** A small outlined button right of the main one, 2 apart: skip, later. */
export type FlowSecondaryProps = {
  onPress: () => void;
  children: string;
};

/** An underlined white word: a way out of the step that isn't its main action. */
export type TextActionProps = {
  onPress: () => void;
  left?: boolean;
  children: string;
};

/** A field as a line, its label above; its own error goes under it. */
export type LineFieldProps = {
  label: string;
  suffix?: string;
  error?: string | false;
  bad?: boolean;
};

/** One of a few choices, the radio on the right. */
export type RadioRowProps = {
  title: string;
  sub?: string;
  on: boolean;
  onPress: () => void;
  last?: boolean;
};

/** The flow's components, by name: both implementations export each of them. */
export const flowParts = ['FlowShell', 'FlowStep', 'FlowPrimary', 'FlowSecondary', 'TextAction', 'LineField', 'RadioRow'] as const;
