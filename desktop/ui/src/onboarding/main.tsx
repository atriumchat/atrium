import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/onest';
import { tokenCss } from '@atrium/ui-common';
import { t } from '../i18n';
import { Onboarding } from './Onboarding';

// The tokens as a stylesheet in the page, as the web app sets them (applyTokens): the CSP takes 'self' styles only, and
// a <style> made from script counts as the page's own.
const tokens = new CSSStyleSheet();
tokens.replaceSync(tokenCss());
document.adoptedStyleSheets = [tokens];
document.title = t('setup.title');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Onboarding />
  </StrictMode>,
);
