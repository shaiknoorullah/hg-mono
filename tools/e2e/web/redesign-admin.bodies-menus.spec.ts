import { expect, test, type Page, type Route } from '@playwright/test';

import { declareUnpairable, expectDesignFor, type BoardFor } from './design';
import { E2E_MODE } from './mode';
import { routeLogin, signIn, type StaffRole } from './redesign-admin.support';

test.skip(E2E_MODE !== 'mock', 'written against the mock server; run with E2E_MODE=mock');

/**
 * The redesigned admin console's issuing bodies, menu reviews and edit-on-behalf screens, each
 * state captured for the design board it must match (tools/e2e/README.md, "Design captures").
 * Boards are drawn at 1440 wide, so the tablet project takes no capture. Mock mode: the list
 * calls are served from the mock's own fixture scenarios with `x-mock-scenario`, and the states
 * the stateless mock cannot give (an empty page, a server error, a call that never answers) with
 * `page.route`.
 *
 * Declared unpairable, with the reason on each: `BodiesGrid` (a component the page boards
 * compose, drawn without the shell), `MenuReview-States` and `MenuItem-OnBehalf-States` (several
 * states side by side on one board).
 *
 * Board ids are written out in full on purpose: tools/e2e/web/check-boards.mjs validates only
 * literal ids.
 */
const BASE = process.env.E2E_ADMIN_REDESIGN_URL ?? process.env.BASE_URL;
if (BASE) test.use({ baseURL: BASE });

const EMPTY_PAGE = { data: [], meta: { next_cursor: null, has_more: false } };
const failing = (route: Route) =>
  route.fulfill({ status: 500, json: { error: { code: 'INTERNAL_ERROR', message: 'boom', request_id: 'req_e2e' } } });
const empty = (route: Route) => route.fulfill({ json: EMPTY_PAGE });
const never = () => new Promise<void>(() => undefined);

/** Serves a call from one of the mock's fixture scenarios. */
const scenario = (name: string) => async (route: Route) => {
  const response = await route.fetch({ headers: { ...route.request().headers(), 'x-mock-scenario': name } });
  await route.fulfill({ response });
};

/** Signs in as `role`, answers `glob` with `handler`, and opens `hash`. */
async function open(page: Page, role: StaffRole, hash: string, glob?: string, handler?: (route: Route) => Promise<void>) {
  await routeLogin(page, role);
  if (glob && handler) await page.route(glob, handler);
  await page.goto('/');
  await signIn(page);
  await expect(page.locator('#app-bar-heading')).toBeVisible();
  await page.evaluate((h) => {
    window.location.hash = h;
  }, hash);
}

async function capture(page: Page, board: BoardFor, { settled = true } = {}) {
  // A call that never answers keeps the network busy for good: the loading state is captured as it is.
  if (settled) await page.waitForLoadState('networkidle');
  // A build older than the screen draws "Not built yet"; that is not the board's state.
  await expect(page.getByText('Not built yet')).toHaveCount(0);
  await expectDesignFor(page, board);
}

const BODIES = '**/v1/admin/halal-issuing-bodies?**';
const QUEUE = '**/v1/admin/menu-reviews?**';

test.describe('redesigned admin · issuing bodies (mock)', () => {
  test.use({ colorScheme: 'light' });

  test('super admin, every status', async ({ page }) => {
    await open(page, 'SUPER_ADMIN', '#/issuing-bodies', BODIES, scenario('halal_issuing_bodies_every_status'));
    await expect(page.locator('#app-bar-heading')).toHaveText('Issuing bodies');
    await expect(page.getByRole('grid')).toBeVisible();
    await capture(page, { 1440: 'admin/restaurant-verification/Bodies' });
  });

  test('admin, read only', async ({ page }) => {
    await open(page, 'ADMIN', '#/issuing-bodies', BODIES, scenario('halal_issuing_bodies_every_status'));
    await expect(page.getByRole('grid')).toBeVisible();
    await expect(page.getByRole('button', { name: /Review…|Change status…/ })).toHaveCount(0);
    await capture(page, { 1440: 'admin/restaurant-verification/Bodies-Admin' });
  });

  test('no proposals waiting', async ({ page }) => {
    await open(page, 'SUPER_ADMIN', '#/issuing-bodies', BODIES, empty);
    await expect(page.locator('#app-bar-heading')).toHaveText('Issuing bodies');
    // Wide screens draw the filter as a native select; narrow ones as a listbox.
    const filter = page.getByLabel('Status', { exact: true });
    if ((await filter.evaluate((el) => el.tagName)) === 'SELECT') await filter.selectOption('PROPOSED');
    else {
      await filter.click();
      await page.getByRole('option', { name: 'Proposed, waiting for review' }).click();
    }
    await expect(page.getByText('No proposed bodies are waiting')).toBeVisible();
    await capture(page, { 1440: 'admin/restaurant-verification/Bodies-Empty' });
  });

  test('the list does not load', async ({ page }) => {
    await open(page, 'SUPER_ADMIN', '#/issuing-bodies', BODIES, failing);
    await expect(page.getByText('Issuing bodies didn’t load')).toBeVisible();
    await capture(page, { 1440: 'admin/restaurant-verification/Bodies-Error' });
  });

  test('loading', async ({ page }) => {
    await open(page, 'SUPER_ADMIN', '#/issuing-bodies', BODIES, never);
    await expect(page.getByText('Loading issuing bodies')).toBeVisible();
    await capture(page, { 1440: 'admin/restaurant-verification/Bodies-Loading' }, { settled: false });
  });

  test('review a proposed body', async ({ page }) => {
    await open(page, 'SUPER_ADMIN', '#/issuing-bodies', BODIES, scenario('halal_issuing_bodies_every_status'));
    await page.getByRole('button', { name: 'Review…' }).click();
    await expect(page.getByRole('region', { name: /Review a proposed issuing body/ })).toBeVisible();
    await capture(page, { 1440: 'admin/restaurant-verification/Bodies-Review' });
  });

  test('the grid component board', async ({ page }) => {
    await open(page, 'SUPER_ADMIN', '#/issuing-bodies', BODIES, scenario('halal_issuing_bodies_every_status'));
    await expect(page.getByRole('grid')).toBeVisible();
    await declareUnpairable(
      page,
      'admin/restaurant-verification/BodiesGrid',
      'a component board: the grid and its filter drawn alone at 1152 by 820 with no sidebar or app bar; the page boards (Bodies and its states) compose it and are compared instead',
    );
  });
});

test.describe('redesigned admin · menu reviews and edit on behalf (mock)', () => {
  test.use({ colorScheme: 'light' });

  async function openFirstVersion(page: Page) {
    await open(page, 'ADMIN', '#/menu-reviews', QUEUE, scenario('menu_review_queue'));
    const grid = page.getByRole('grid');
    await expect(grid).toBeVisible();
    await grid.getByRole('row').nth(1).click();
    await expect(page.getByTestId('VersionPanel')).toBeVisible();
  }

  test('the queue beside a pending version', async ({ page }) => {
    await openFirstVersion(page);
    await capture(page, { 1440: 'admin/restaurant-verification/MenuReview' });
  });

  test('reject a version', async ({ page }) => {
    await openFirstVersion(page);
    await page.getByRole('button', { name: 'Reject…' }).click();
    await expect(page.getByRole('region', { name: /Reject version/ })).toBeVisible();
    await capture(page, { 1440: 'admin/restaurant-verification/MenuReview-Reject' });
  });

  test('the states board', async ({ page }) => {
    await open(page, 'ADMIN', '#/menu-reviews', QUEUE, empty);
    await expect(page.getByText('Nothing waiting for review')).toBeVisible();
    await declareUnpairable(
      page,
      'admin/restaurant-verification/MenuReview-States',
      'a composite board: loading, nothing waiting, did not load and decision refused drawn side by side; each of those states is captured by its own test in this file, but not at the board’s layout',
    );
  });

  test('edit a menu item for a restaurant', async ({ page }) => {
    await open(page, 'ADMIN', '#/restaurants/3b8f7c52-2d0e-4a53-9a58-1c1f5f6c7a01/menu/items/9d7a3e10-5b44-4d2c-8f6e-2a9c4b7d1e02');
    await expect(page.getByRole('button', { name: 'Save and publish' })).toBeVisible();
    await capture(page, { 1440: 'admin/restaurant-verification/MenuItem-OnBehalf' });
  });

  test('edit on behalf, the states board', async ({ page }) => {
    await open(page, 'ADMIN', '#/restaurants/3b8f7c52-2d0e-4a53-9a58-1c1f5f6c7a01/menu/items/9d7a3e10-5b44-4d2c-8f6e-2a9c4b7d1e02');
    await expect(page.getByRole('button', { name: 'Save and publish' })).toBeVisible();
    await declareUnpairable(
      page,
      'admin/restaurant-verification/MenuItem-OnBehalf-States',
      'a composite board: loading, saving, fields refused, save failed, remove and removed drawn side by side on one canvas',
    );
  });
});
