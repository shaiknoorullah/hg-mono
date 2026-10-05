import { defineConfig } from '@playwright/test';
import path from 'node:path';
import { OUT as out } from '../lib/paths.mjs';

// The web flows: the restaurant and admin apps as tools/e2e/web/serve.sh serves them, against
// the API tools/e2e/stack/up.sh booted. Every step leaves a screenshot in
// $E2E_OUT/screenshots/<app>/; a failed test keeps its trace and video. tools/e2e/README.md.
//
// Each call of `playwright test` gets its own report folder, $E2E_OUT/playwright/$E2E_RUN, since
// Playwright empties its output folder when a run starts and run.sh calls it once per flow.
const base = path.join(out, 'playwright', process.env.E2E_RUN ?? 'web');

export default defineConfig({
  testDir: '.',
  outputDir: path.join(base, 'results'),
  // The flows share one seeded world and one order, so they run one at a time, in the order
  // tools/e2e/run.sh calls them.
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  reporter: [
    ['list'],
    ['html', { outputFolder: path.join(base, 'report'), open: 'never' }],
    ['junit', { outputFile: path.join(base, 'junit.xml') }],
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
    launchOptions: {
      ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
        ? {
            executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
          }
        : {}),
    },
  },
  projects: [
    { name: 'restaurant', testMatch: /restaurant\.spec\.ts/, use: { baseURL: process.env.E2E_PARTNER_URL ?? process.env.BASE_URL ?? 'http://localhost:4173' } },
    { name: 'admin', testMatch: /admin\.spec\.ts/, use: { baseURL: process.env.E2E_ADMIN_URL ?? process.env.BASE_URL ?? 'http://localhost:4174' } },
  ],
});
