import { defineConfig } from 'vitest/config';

import { forkPool } from '../../vitest.shared';

export default defineConfig({
  test: {
    ...forkPool(),
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // Two workers at most: these tests render every template, and CI shares
    // the runner with the Go suite.
    maxWorkers: 2,
    minWorkers: 1,
  },
});
