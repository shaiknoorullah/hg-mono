import { defineConfig } from '@playwright/test';
import path from 'node:path';
import { OUT as out } from '../lib/paths.mjs';

// The web flows: the restaurant and admin apps as tools/e2e/web/serve.sh serves them, against
// the API tools/e2e/stack/up.sh booted. Every step leaves a screenshot in
// $E2E_OUT/screenshots/<app>/; a failed test keeps its trace and video. tools/e2e/README.md.

export default defineConfig({
  testDir: '.',
  outputDir: path.join(out, 'playwright', 'results'),
  // The flows share one seeded world and one order, so they run one at a time, in the order
  // tools/e2e/run.sh calls them.
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  reporter: [
    ['list'],
    ['html', { outputFolder: path.join(out, 'playwright', 'report'), open: 'never' }],
    ['junit', { outputFile: path.join(out, 'playwright', 'junit.xml') }],
  ],
  use: {
    viewport: { width: 1440, height: 900 },
    colorScheme: 'light',
    locale: 'en-CA',
    timezoneId: 'America/Toronto',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
    actionTimeout: 20_000,
  },
  projects: [
    { name: 'restaurant', testMatch: /restaurant\.spec\.ts/, use: { baseURL: 'http://localhost:4173' } },
    { name: 'admin', testMatch: /admin\.spec\.ts/, use: { baseURL: 'http://localhost:4174' } },
  ],
});
