import type { StorybookConfig } from '@storybook/react-vite';

// Atrium Flow's web parts, one story per part and state (DESIGN.md). `npm run storybook -w @gomex/ui-web`.
const config: StorybookConfig = {
  framework: '@storybook/react-vite',
  stories: ['../src/**/*.stories.tsx'],
  core: { disableTelemetry: true },
};
export default config;
