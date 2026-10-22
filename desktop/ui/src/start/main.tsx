import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/onest';
import { tokenCss } from '@atrium/ui-common';
import './start.css';
import { Start } from './Start';

// The tokens as a stylesheet in the page, as the setup window does (onboarding/main.tsx): the CSP takes 'self' styles.
const tokens = new CSSStyleSheet();
tokens.replaceSync(tokenCss());
document.adoptedStyleSheets = [tokens];

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Start />
  </StrictMode>,
);
