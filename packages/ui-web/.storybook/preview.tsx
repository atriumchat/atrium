import type { Preview } from '@storybook/react-vite';
import '@fontsource-variable/onest';
import { tokenCss } from '@gomex/ui-common';

// The tokens as the web app sets them at start-up (applyTokens), so the parts look here as they do there.
const style = document.createElement('style');
style.textContent = `${tokenCss()}\nbody { margin: 0; background: var(--gx-page); color: var(--gx-text); font-family: var(--gx-font); }`;
document.head.prepend(style);

const preview: Preview = {
  parameters: {
    layout: 'fullscreen',
    backgrounds: { disable: true },
    controls: { expanded: true },
  },
};
export default preview;
