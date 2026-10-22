// One lint for the clients and their packages (docs/adr/001-client-architecture.md): the TypeScript rules, the rules of
// hooks, the packages' boundaries (dependencies point down, only through a package's index) and no colours written by
// hand in Gomex Flow. The server, deploy and the Electron shell's plain scripts are outside it.
import js from '@eslint/js';
import boundaries from 'eslint-plugin-boundaries';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const DEEP = { group: ['@gomex/*/*'], message: 'Import the package by its name: everything public is in its index.ts.' };

/** Workspace packages a part of the repo may not import by name (the boundaries plugin sees those as external). */
const NOT_BY_NAME = {
  'packages/ui-common/**': ['@gomex/ui-web', '@gomex/ui-native', '@gomex/setup'],
  'packages/ui-web/**': ['@gomex/ui-native', '@gomex/setup'],
  'packages/ui-native/**': ['@gomex/ui-web', '@gomex/setup'],
  // The domain model runs anywhere: no UI, no platform.
  'packages/setup/**': ['@gomex/ui-common', '@gomex/ui-web', '@gomex/ui-native', 'react', 'react-dom', 'react-native'],
  'web/**': ['@gomex/ui-native'],
  'desktop/ui/**': ['@gomex/ui-native'],
  'mobile/**': ['@gomex/ui-web'],
};
const byName = Object.entries(NOT_BY_NAME).map(([files, names]) => ({
  files: [files],
  rules: {
    'no-restricted-imports': [
      'error',
      { paths: names.map((name) => ({ name, message: 'Against the packages\' direction (docs/adr/001-client-architecture.md).' })), patterns: [DEEP] },
    ],
  },
}));

const FLOW = [
  'packages/ui-web/src/**',
  'packages/ui-native/src/**',
  'desktop/ui/src/**',
  'mobile/app/{own,login,recovery,design}.tsx',
  'mobile/src/own/**',
  'mobile/src/components/RecoveryKeyStep.tsx',
  'web/src/account/{SetupWizard,Login,KeyStep,RecoveryKey,ResetPassword,WhereToUse}.tsx',
];

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/storybook-static/**',
      'desktop/ui-dist/**',
      'desktop/*.js',
      'desktop/tests/**',
      'mobile/ios/**',
      'mobile/android/**',
      'mobile/modules/**',
      'mobile/web-stubs/**',
      'mobile/scripts/**',
      'web/tests/**',
      'web/public/**',
      'server/**',
      'deploy/**',
      'review/**',
      '.claude/**',
      '**/*.config.{js,cjs,mjs}',
      '**/metro.config.js',
      '**/babel.config.js',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    plugins: { 'react-hooks': reactHooks, boundaries },
    settings: {
      'import/resolver': { node: { extensions: ['.ts', '.tsx', '.js', '.json'] } },
      'boundaries/elements': [
        { type: 'ui-common', pattern: 'packages/ui-common' },
        { type: 'ui-web', pattern: 'packages/ui-web' },
        { type: 'ui-native', pattern: 'packages/ui-native' },
        { type: 'setup', pattern: 'packages/setup' },
        { type: 'web', pattern: 'web' },
        { type: 'mobile', pattern: 'mobile' },
        { type: 'desktop', pattern: 'desktop' },
      ],
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
      // Protocol payloads are typed where they're read; `any` at the edge is allowed, not in new code by habit.
      '@typescript-eslint/no-explicit-any': 'warn',
      // Dependencies point down: the shared packages never reach into an app, ui-common into nothing of ours.
      'boundaries/dependencies': [
        'error',
        {
          default: 'allow',
          policies: [
            { from: { element: { type: 'ui-common' } }, disallow: { to: { element: { types: { anyOf: ['ui-web', 'ui-native', 'setup', 'web', 'mobile', 'desktop'] } } } } },
            { from: { element: { type: 'ui-web' } }, disallow: { to: { element: { types: { anyOf: ['ui-native', 'setup', 'web', 'mobile', 'desktop'] } } } } },
            { from: { element: { type: 'ui-native' } }, disallow: { to: { element: { types: { anyOf: ['ui-web', 'setup', 'web', 'mobile', 'desktop'] } } } } },
            { from: { element: { type: 'setup' } }, disallow: { to: { element: { types: { anyOf: ['ui-common', 'ui-web', 'ui-native', 'web', 'mobile', 'desktop'] } } } } },
            { from: { element: { type: 'web' } }, disallow: { to: { element: { types: { anyOf: ['ui-native', 'mobile', 'desktop'] } } } } },
            { from: { element: { type: 'desktop' } }, disallow: { to: { element: { types: { anyOf: ['ui-native', 'web', 'mobile'] } } } } },
            // The phone app still takes the web's dictionaries and protocol types (a @gomex/protocol package later).
            { from: { element: { type: 'mobile' } }, disallow: { to: { element: { types: { anyOf: ['ui-web', 'desktop'] } } } } },
          ],
        },
      ],
      // A package is used through its index only.
      'no-restricted-imports': ['error', { patterns: [DEEP] }],
    },
  },
  ...byName,
  {
    // The phone app's few CommonJS files: its entry and its Expo config plugins.
    files: ['mobile/index.js', 'mobile/plugins/**/*.js'],
    languageOptions: { sourceType: 'commonjs', globals: globals.node },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    files: FLOW,
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'Literal[value=/^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/]',
          message: 'A colour in Gomex Flow is a token (@gomex/ui-common color).',
        },
        { selector: 'Literal[value=/^rgba?\\(/]', message: 'A colour in Gomex Flow is a token (@gomex/ui-common color).' },
      ],
    },
  },
);
