import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/onest';
import { App } from './App';
import { applyTokens } from './applyTokens';
import './index.css';
// In the desktop app: mark the page before the first screen (sign-in too), for the window's top strip.
import './desktop';

applyTokens();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
