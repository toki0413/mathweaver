/**
 * ESLint Flat Config — MathWeaver Desktop
 *
 * ESLint 9+ uses a flat config array instead of .eslintrc.* files.
 * Each object in the array applies rules to a set of files.
 */

import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'

export default tseslint.config(
  // --- Global ignores ---
  {
    ignores: [
      'dist/',
      'dist-web/',
      'out/',
      'node_modules/',
      'coverage/',
      'test-results/',
      '**/*.config.{ts,js}',
      'electron/preload/index.d.ts',
      'src/types/electron.d.ts',
      'test/mock-api.js',
    ],
  },

  // --- Base recommended rules ---
  js.configs.recommended,

  // --- TypeScript strict rules (for .ts/.tsx files) ---
  ...tseslint.configs.recommended,

  // --- React + Electron main process ---
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
    },
  },

  // --- Electron main/preload/backend (Node.js environment) ---
  {
    files: ['electron/**/*.ts'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
  },

  // --- Test files (relaxed rules) ---
  {
    files: ['tests/**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },

  // --- Project-wide custom rules ---
  {
    rules: {
      // Enforce consistent type imports (inline type specifiers)
      '@typescript-eslint/consistent-type-imports': [
        'warn',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      // Prevent unused variables (aligned with tsconfig noUnusedLocals)
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      // Allow console in specific contexts
      'no-console': [
        'warn',
        {
          allow: ['warn', 'error'],
        },
      ],
    },
  },
)
