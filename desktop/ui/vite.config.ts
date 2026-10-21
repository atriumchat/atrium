import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * The desktop app's windows, one page each, built into ../ui-dist for main.js to load with loadFile. Relative paths
 * (base './') because they're opened from file://, where `crossorigin` on a module script fails the load.
 */
const noCrossorigin: Plugin = {
  name: 'gomex-no-crossorigin',
  transformIndexHtml: (html) => html.replaceAll(' crossorigin', ''),
};

/**
 * The windows' CSP, in the built pages only: the dev server injects its styles and React's refresh preamble inline,
 * which it would block. Styles from script go through constructed stylesheets (main.tsx), which it allows.
 */
const CSP = "default-src 'none'; style-src 'self'; font-src 'self'; script-src 'self'; img-src 'self' data:";
const csp: Plugin = {
  name: 'gomex-csp',
  apply: 'build',
  transformIndexHtml: () => [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP }, injectTo: 'head' }],
};

export default defineConfig({
  base: './',
  plugins: [react(), noCrossorigin, csp],
  build: {
    outDir: resolve(__dirname, '../ui-dist'),
    emptyOutDir: true,
    // Fonts and the like as files: the pages' CSP allows only 'self'.
    assetsInlineLimit: 0,
    rolldownOptions: { input: { onboarding: resolve(__dirname, 'onboarding.html') } },
  },
  server: { port: 5320, strictPort: true },
});
