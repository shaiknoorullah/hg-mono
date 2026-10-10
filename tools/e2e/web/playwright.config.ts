import { defineConfig, type Project } from '@playwright/test';
import path from 'node:path';
import { OUT as out } from '../lib/paths.mjs';
import { E2E_MODE, type ProjectMeta } from './mode';

// The web flows: the restaurant and admin apps as tools/e2e/web/serve.sh serves them, against
// the API tools/e2e/stack/up.sh booted (E2E_MODE=real, the default) or `pnpm mock` on :4010
// (E2E_MODE=mock). Every step leaves a screenshot in $E2E_OUT/screenshots/<app>/; a failed test
// keeps its trace and video. tools/e2e/README.md.
//
// Projects: <app>-<flag>-<viewport>, for app restaurant | admin, flag legacy | redesign,
// viewport desktop (1440x900) | tablet (1024x768). Select with wildcards:
//   --project restaurant-legacy-desktop     the existing restaurant specs, as before
//   --project '*-redesign-*'                every redesign spec, both viewports
//   legacy    the redesign flag off (VITE_HG_REDESIGN unset): tools/e2e/web/<app>.spec.ts, real
//             mode only, since they read the seeded world
//   redesign  the build served with VITE_HG_REDESIGN=1: tools/e2e/web/redesign-<app>.*.spec.ts,
//             both modes (a spec reads E2E_MODE from ./mode to pick its data)
//
// Each call of `playwright test` gets its own report folder, $E2E_OUT/playwright/$E2E_RUN, since
// Playwright empties its output folder when a run starts and run.sh calls it once per flow.
const base = path.join(out, 'playwright', process.env.E2E_RUN ?? 'web');

const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  tablet: { width: 1024, height: 768 },
} as const;

// Where serve.sh serves each build. The legacy ports are the ones the API's CORS list allows
// (tools/e2e/stack/up.sh), and so are the redesign ones.
const URLS = {
  restaurant: {
    legacy: process.env.E2E_PARTNER_URL ?? process.env.BASE_URL ?? 'http://localhost:4173',
    redesign: process.env.E2E_PARTNER_REDESIGN_URL ?? 'http://localhost:4175',
  },
  admin: {
    legacy: process.env.E2E_ADMIN_URL ?? process.env.BASE_URL ?? 'http://localhost:4174',
    redesign: process.env.E2E_ADMIN_REDESIGN_URL ?? 'http://localhost:4176',
  },
} as const;

const NOTHING = /^$/;

function testMatch(app: ProjectMeta['app'], flag: ProjectMeta['flag']): RegExp {
  if (flag === 'redesign') return new RegExp(`(^|/)redesign-${app}\\.[^/]+\\.spec\\.ts$`);
  // The legacy specs read the seeded world (e2e-out/world.json): real mode only.
  return E2E_MODE === 'mock' ? NOTHING : new RegExp(`(^|/)${app}\\.spec\\.ts$`);
}

const projects: Project[] = [];
for (const app of ['restaurant', 'admin'] as const) {
  for (const flag of ['legacy', 'redesign'] as const) {
    for (const viewport of ['desktop', 'tablet'] as const) {
      const metadata: ProjectMeta = { app, flag, viewport, mode: E2E_MODE };
      projects.push({
        name: `${app}-${flag}-${viewport}`,
        testMatch: testMatch(app, flag),
        metadata,
        use: { baseURL: URLS[app][flag], viewport: VIEWPORTS[viewport] },
      });
    }
  }
}

export default defineConfig({
  testDir: '.',
  outputDir: path.join(base, 'results'),
  // On the real stack the flows share one seeded world and one order, so they run one at a
  // time, in the order tools/e2e/run.sh calls them. The mock keeps no state between requests.
  workers: E2E_MODE === 'real' ? 1 : 2,
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
    viewport: VIEWPORTS.desktop,
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
  projects,
});
