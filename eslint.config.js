import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

const POS_FEATURES = ['tables', 'order-entry', 'payment', 'order-history', 'kitchen', 'day-closing'];
const ADMIN_FEATURES = [
  'dashboard',
  'catalog',
  'pricing',
  'inventory',
  'stocktake',
  'accounting',
  'reports',
  'system',
];
const featurePatterns = (names) => names.map((n) => ({ group: [`@/features/${n}`, `@/features/${n}/*`] }));

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', '**/.turbo/**', 'apps/api/prisma/migrations/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },

  {
    files: ['e2e/**/*.{js,mjs,ts}', '*.js'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },

  // ---- API: dependency direction (domain ← contracts ← modules / core)
  {
    files: ['apps/api/**/*.ts'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['apps/api/src/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: ['@prisma/client', 'express', 'react', 'socket.io'],
          patterns: [
            {
              group: ['**/contracts/**', '**/core/**', '**/modules/**', 'node:*'],
              message: 'domain/ chỉ chứa nghiệp vụ thuần.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['apps/api/src/contracts/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: ['@prisma/client', 'express', 'socket.io'],
          patterns: [
            { group: ['**/core/**', '**/modules/**'], message: 'contracts/ chỉ được dùng domain/ và zod.' },
          ],
        },
      ],
    },
  },

  // ---- Web
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'no-restricted-imports': [
        'error',
        {
          paths: ['@prisma/client', '@ketoan/api'],
          patterns: [
            {
              group: ['@ketoan/api/*', '!@ketoan/api/contracts', '!@ketoan/api/domain'],
              message: 'Web chỉ được import @ketoan/api/contracts và @ketoan/api/domain.',
            },
          ],
        },
      ],
    },
  },
  ...POS_FEATURES.map((f) => ({
    files: [`apps/web/src/features/${f}/**/*.{ts,tsx}`],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: ['@ketoan/api'],
          patterns: featurePatterns(ADMIN_FEATURES.concat(POS_FEATURES.filter((x) => x !== f))),
        },
      ],
    },
  })),
  ...ADMIN_FEATURES.map((f) => ({
    files: [`apps/web/src/features/${f}/**/*.{ts,tsx}`],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: ['@ketoan/api'],
          patterns: featurePatterns(POS_FEATURES.concat(ADMIN_FEATURES.filter((x) => x !== f))),
        },
      ],
    },
  })),
);
