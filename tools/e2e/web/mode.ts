import { test, type Page } from '@playwright/test';

/**
 * Which API the web flows run against (tools/e2e/README.md, Redesign):
 *
 *   real  the compose stack tools/e2e/stack/up.sh boots, with the seeded world. The default.
 *   mock  `pnpm mock` on :4010, serving contracts/fixtures/** by scenario.
 *
 * run.sh's older values for E2E_MODE (all, web) name which flows run, not the API; they mean
 * real here. run.sh now reads E2E_FLOWS for that.
 */
export type E2EMode = 'mock' | 'real';
export const E2E_MODE: E2EMode = process.env.E2E_MODE === 'mock' ? 'mock' : 'real';

/** What playwright.config.ts records on each project, readable from test.info().project.metadata. */
export interface ProjectMeta {
  app: 'restaurant' | 'admin';
  flag: 'legacy' | 'redesign';
  viewport: 'desktop' | 'tablet';
  mode: E2EMode;
}

/** The running test's project: app, flag, viewport and mode. */
export function projectMeta(): ProjectMeta {
  return test.info().project.metadata as ProjectMeta;
}

/** The mock API's address, as serve.sh builds the apps against it in mock mode. */
export const MOCK_API_URL = process.env.E2E_MOCK_API_URL ?? 'http://localhost:4010';

/**
 * Serve a fixture scenario (contracts/fixtures) for the page's requests to the mock API: every
 * request, or only those whose URL matches `url` (a glob or RegExp, e.g. '**\/v1/orders/**').
 * Sends the mock's `X-Mock-Scenario` header; an operation without that scenario gets its
 * default (tools/mock-server/README.md). Call it again to change the scenario mid-test. Mock
 * mode only: on the real stack it is an error.
 */
export async function mockScenario(page: Page, scenario: string, url: string | RegExp = `${MOCK_API_URL}/**`): Promise<void> {
  if (E2E_MODE !== 'mock') throw new Error(`mockScenario("${scenario}") needs E2E_MODE=mock`);
  await page.unroute(url);
  await page.route(url, (route) => route.continue({ headers: { ...route.request().headers(), 'x-mock-scenario': scenario } }));
}
