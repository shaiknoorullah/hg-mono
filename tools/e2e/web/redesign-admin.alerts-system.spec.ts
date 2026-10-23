import { expect, test, type Page, type Route } from '@playwright/test';

import { declareUnpairable, expectDesignFor, type BoardFor } from './design';
import { E2E_MODE } from './mode';
import { routeLogin, signIn, type StaffRole } from './redesign-admin.support';

test.skip(E2E_MODE !== 'mock', 'written against the mock server; run with E2E_MODE=mock');

/**
 * The redesigned admin console's System status page and Your account page, each state captured for
 * the design board it must match (tools/e2e/README.md, "Design captures"). Boards are drawn at 1440
 * wide, so the tablet project takes no capture. Mock mode: the two health probes are answered with
 * `page.route`, which is the only way to give the stateless mock a server that is not ready.
 *
 * Live alerts is not captured here: its states are driven by the realtime socket, which `page.route`
 * cannot script. It is covered by the unit tests in `apps/admin/src/redesign/alerts`.
 */
const BASE = process.env.E2E_ADMIN_REDESIGN_URL ?? process.env.BASE_URL;
if (BASE) test.use({ baseURL: BASE });

const ASS = 'admin/alerts-sessions-system/';

const READY = {
  data: { ready: true, dependencies: ['postgres', 'redis', 'minio', 'stripe'].map((name) => ({ name, ready: true, detail: null })) },
};
const HEALTH = { data: { status: 'ok', version: '0.18.3', started_at: '2026-09-27T22:10:00.000Z' } };
const ENVELOPE_503 = { error: { code: 'SERVICE_UNAVAILABLE', message: 'Service not ready.', request_id: 'req_e2e' } };

interface Probes {
  readiness: (route: Route) => Promise<void>;
  health?: (route: Route) => Promise<void>;
}

const ok = (json: unknown) => (route: Route) => route.fulfill({ json });
const status = (code: number, json: unknown) => (route: Route) => route.fulfill({ status: code, json });
const never = () => new Promise<void>(() => undefined);

async function openSystem(page: Page, role: StaffRole, probes: Probes) {
  await routeLogin(page, role);
  await page.route('**/health/ready', probes.readiness);
  await page.route('**/health', probes.health ?? ok(HEALTH));
  await page.goto('/');
  await signIn(page);
  await expect(page.locator('#app-bar-heading')).toBeVisible();
  await page.evaluate(() => {
    window.location.hash = '#/system';
  });
  await expect(page.locator('#app-bar-heading')).toHaveText('System status');
}

async function capture(page: Page, board: BoardFor) {
  await page.waitForLoadState('networkidle');
  // A build older than the screen draws "Not built yet"; that is not the board's state.
  await expect(page.getByText('Not built yet')).toHaveCount(0);
  await expectDesignFor(page, board);
}

test.describe('redesigned admin · system status and account (mock)', () => {
  test.use({ colorScheme: 'light' });

  test('system, all ready', async ({ page }) => {
    await openSystem(page, 'SUPER_ADMIN', { readiness: ok(READY) });
    await expect(page.getByText('The API is ready to serve requests')).toBeVisible();
    await capture(page, { 1440: `${ASS}SystemHealthy` });
  });

  test('system, not ready and the server named nothing', async ({ page }) => {
    await openSystem(page, 'SUPER_ADMIN', { readiness: status(503, ENVELOPE_503) });
    await expect(page.getByText('The API is not ready').first()).toBeVisible();
    await capture(page, { 1440: `${ASS}SystemNotReady` });
  });

  test('system, not ready, as a support agent', async ({ page }) => {
    await openSystem(page, 'SUPPORT_AGENT', { readiness: status(503, ENVELOPE_503) });
    await expect(page.getByText('What customers may notice')).toBeVisible();
    await capture(page, { 1440: `${ASS}SystemSupportDegraded` });
  });

  test('system, the report lists nothing', async ({ page }) => {
    await openSystem(page, 'SUPER_ADMIN', { readiness: ok({ data: { ready: true, dependencies: [] } }) });
    await expect(page.getByText('The API answered but listed no dependencies')).toBeVisible();
    await capture(page, { 1440: `${ASS}SystemEmpty` });
  });

  test('system, neither check answers', async ({ page }) => {
    await openSystem(page, 'SUPER_ADMIN', { readiness: status(500, ENVELOPE_503), health: status(500, ENVELOPE_503) });
    await expect(page.getByText("The API didn't answer either check")).toBeVisible();
    await capture(page, { 1440: `${ASS}SystemError` });
  });

  test('system, first check still running', async ({ page }) => {
    await openSystem(page, 'SUPER_ADMIN', { readiness: never, health: never });
    await expect(page.getByText('Checking the API')).toBeVisible();
    await capture(page, { 1440: `${ASS}SystemLoading` });
  });

  test('your account', async ({ page }) => {
    await routeLogin(page, 'ADMIN');
    await page.goto('/');
    await signIn(page);
    await expect(page.locator('#app-bar-heading')).toBeVisible();
    await page.evaluate(() => {
      window.location.hash = '#/account';
    });
    await expect(page.locator('#app-bar-heading')).toHaveText('Your account');
    await capture(page, { 1440: `${ASS}Account` });
  });

  test('your account, the states board', async ({ page }) => {
    await routeLogin(page, 'ADMIN');
    await page.goto('/');
    await signIn(page);
    // Sign-in lands on the restaurant queue; going to the account before it has landed lets the landing replace it.
    await expect(page.locator('#app-bar-heading')).toHaveText('Restaurant applications');
    await page.evaluate(() => {
      window.location.hash = '#/account';
    });
    await expect(page.locator('#app-bar-heading')).toHaveText('Your account');
    // Account-States draws several states on one board; one screenshot cannot be compared with it.
    await declareUnpairable(page, `${ASS}Account-States`, 'a composite board: fields to fix, saving, saved, not saved and the sign-out panel side by side');
  });
});
