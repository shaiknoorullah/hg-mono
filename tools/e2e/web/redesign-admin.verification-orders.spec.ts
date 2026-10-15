import { expect, test, type Page, type Route } from '@playwright/test';

import { expectDesignFor, type BoardFor } from './design';
import { E2E_MODE } from './mode';
import { routeLogin, signIn } from './redesign-admin.support';

test.skip(E2E_MODE !== 'mock', 'written against the mock server; run with E2E_MODE=mock');

/**
 * The redesigned admin console's built list screens, each state captured for the design board it
 * must match (tools/e2e/README.md, "Design captures"): the restaurant applications queue, the
 * orders list and the disputes list. Boards are drawn at 1440 wide, so the tablet project takes no
 * capture. Mock mode: the list calls are answered with `page.route`, an empty page or a server
 * error, the two states the stateless mock cannot give.
 */
const BASE = process.env.E2E_ADMIN_REDESIGN_URL ?? process.env.BASE_URL;
if (BASE) test.use({ baseURL: BASE });

const RV = 'admin/restaurant-verification/';
const OR = 'admin/orders/';

const EMPTY_PAGE = { data: [], meta: { next_cursor: null, has_more: false } };
const failing = (route: Route) =>
  route.fulfill({ status: 500, json: { error: { code: 'INTERNAL_ERROR', message: 'boom', request_id: 'req_e2e' } } });
const empty = (route: Route) => route.fulfill({ json: EMPTY_PAGE });

/** Signs in as `role` and opens `hash`, with the list call at `glob` answered by `handler`. */
async function openList(page: Page, glob: string, handler: (route: Route) => Promise<void>, hash: string) {
  await routeLogin(page, 'SUPER_ADMIN');
  await page.route(glob, handler);
  await page.goto('/');
  await signIn(page);
  await expect(page.locator('#app-bar-heading')).toBeVisible();
  await page.evaluate((h) => {
    window.location.hash = h;
  }, hash);
}

async function capture(page: Page, board: BoardFor) {
  await page.waitForLoadState('networkidle');
  // A build older than the screen draws "Not built yet"; that is not the board's state.
  await expect(page.getByText('Not built yet')).toHaveCount(0);
  await expectDesignFor(page, board);
}

test.describe('redesigned admin · lists (mock)', () => {
  test.use({ colorScheme: 'light' });

  test('restaurant applications, queue clear', async ({ page }) => {
    await openList(page, '**/v1/admin/restaurant-applications?**', empty, '#/restaurants');
    await expect(page.locator('#app-bar-heading')).toHaveText('Restaurant applications');
    await capture(page, { 1440: `${RV}Queue-Drained` });
  });

  test('restaurant applications, the list does not load', async ({ page }) => {
    await openList(page, '**/v1/admin/restaurant-applications?**', failing, '#/restaurants');
    await expect(page.locator('#app-bar-heading')).toHaveText('Restaurant applications');
    await capture(page, { 1440: `${RV}Queue-Error` });
  });

  test('orders, none yet', async ({ page }) => {
    await openList(page, '**/v1/admin/orders?**', empty, '#/orders');
    await expect(page.locator('#app-bar-heading')).toHaveText('Orders');
    await capture(page, { 1440: `${OR}OrdersEmpty` });
  });

  test('orders, the list does not load', async ({ page }) => {
    await openList(page, '**/v1/admin/orders?**', failing, '#/orders');
    await expect(page.locator('#app-bar-heading')).toHaveText('Orders');
    await capture(page, { 1440: `${OR}OrdersError` });
  });

  test('disputes, none open', async ({ page }) => {
    await openList(page, '**/v1/admin/orders?**', empty, '#/disputes');
    await expect(page.locator('#app-bar-heading')).toBeVisible();
    await capture(page, { 1440: `${OR}DisputesClear` });
  });

  test('disputes, the list does not load', async ({ page }) => {
    await openList(page, '**/v1/admin/orders?**', failing, '#/disputes');
    await expect(page.locator('#app-bar-heading')).toBeVisible();
    await capture(page, { 1440: `${OR}DisputesError` });
  });
});
