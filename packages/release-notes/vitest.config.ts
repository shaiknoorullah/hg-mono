import { defineConfig } from 'vitest/config';

import { forkPool } from '../../vitest.shared';

export default defineConfig({
  test: { ...forkPool(), include: ['src/**/*.test.ts'] },
});
