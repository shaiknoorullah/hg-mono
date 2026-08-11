/**
 * ESLint flat config for `@hg/ui-native` — `pnpm --filter @hg/ui-native lint`.
 *
 * Intentionally minimal: this is the design-system enforcement config, not a style guide.
 * Formatting is not policed here. The only rule wired in today is **L-4**, and it is an
 * error, because RULE H-1 is a correctness property of the product rather than a
 * preference — a second filled green in the system makes the halal seal ambiguous, and an
 * ambiguous certification mark is the one defect this product cannot ship.
 *
 * The config lives under `src/lint/` so the rule, its tests and its wiring travel together.
 */
import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';

import hg from './index.js';

export default [
  {
    ignores: [
      '**/node_modules/**',
      // Generated token artefacts are data, not components: the palette necessarily
      // contains the reserved greens it is the rule's job to police elsewhere.
      'src/tokens/generated/**',
    ],
  },
  {
    files: ['src/**/*.{ts,tsx,js,jsx,mjs,cjs}'],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 2022,
      sourceType: 'module',
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    // The typescript-eslint plugin is registered but left switched off: this config
    // enforces the design system, not a style guide. It is here so the `eslint-disable`
    // comments the tiers already carry resolve to real rule names instead of erroring.
    plugins: { hg, '@typescript-eslint': tsPlugin },
    rules: {
      'hg/no-green-solids': 'error',
    },
  },
];
