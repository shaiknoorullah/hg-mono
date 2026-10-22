import { expect, test, type Page } from '@playwright/test';

import { E2E_MODE } from './mode';
import {
  AL_NOOR,
  arrive,
  BAIT,
  capture,
  CLAIM_ENDS,
  choose,
  karahiRow,
  KARAHI,
  oct,
  openAt,
  row,
  sep,
  SUFRA,
  TANDOOR,
  ZAYTOUN_ROW,
  type Ctx,
  type Scene,
} from './redesign-admin.verification.scene';

test.skip(E2E_MODE !== 'mock', 'written against the mock server; run with E2E_MODE=mock');

/**
 * The redesigned admin console's restaurant applications queue, each state not covered by
 * `redesign-admin.verification-orders.spec.ts` (the clear queue and the list that does not load)
 * captured for the design board it must match (tools/e2e/README.md, "Design captures"): the
 * queue while it loads, with nobody having applied, filtered to nothing, with only the breached,
 * as a support agent sees it, while more rows load, and every Take next outcome. Mock mode: the
 * calls are answered with `page.route` (see redesign-admin.verification.scene.ts), which is the
 * only way to give the stateless mock a claim held by the signed-in reviewer, a short page or a
 * call that fails on cue.
 *
 * Boards are drawn at 1440 wide, so the tablet project takes no capture.
 *
 * Boards of the area that no queue state can pair with are declared, with their reasons, in
 * `redesign-admin.verification-unpairable.spec.ts`.
 *
 * Board ids are written out in full on purpose: tools/e2e/web/check-boards.mjs validates only
 * literal ids.
 */
const BASE = process.env.E2E_ADMIN_REDESIGN_URL ?? process.env.BASE_URL;
if (BASE) test.use({ baseURL: BASE });

/** The board's five restaurants; Karahi House is claimed by the signed-in reviewer. */
const five = (c: Ctx) => [BAIT, SUFRA, karahiRow({ assigned_admin_id: c.me, review_lock_expires_at: CLAIM_ENDS }), ZAYTOUN_ROW, TANDOOR];

/** The page after Take next, for the boards that draw only Bait Al Mandi and Tandoor Lane. */
const two = () => [BAIT, TANDOOR];

const MORE = [
  row('a1b2c3d4-0001-4000-8000-0000000000c1', 'Lahore Tikka', 'Mississauga', 'DOCUMENTS_REVIEW', 1, sep(26, 11, 15), sep(30, 11, 15)),
  row('a1b2c3d4-0001-4000-8000-0000000000c2', 'Dosa Point', 'Toronto', 'DOCUMENTS_REVIEW', 1, sep(27, 9, 40), oct(1, 9, 40)),
  row('a1b2c3d4-0001-4000-8000-0000000000c3', 'Shami Grill', 'Vaughan', 'DOCUMENTS_REVIEW', 2, sep(27, 14, 5), oct(1, 14, 5)),
];

/** Opens the queue with the scene and waits for its heading. */
async function openQueue(page: Page, scene: Scene) {
  await arrive(page, scene);
  await openAt(page, '#/restaurants');
  await expect(page.locator('#app-bar-heading')).toHaveText('Restaurant applications');
}

const grid = (page: Page) => page.getByRole('grid');

test.describe('redesigned admin · restaurant applications queue (mock)', () => {
  test.use({ colorScheme: 'light' });

  // Every board of the area is drawn at 1440 wide (or at its own size, taken by resizing the page
  // in the specs that do), and the panes a panel squeezes at 1024 are a finding of their own, not
  // this spec's: the desktop project takes the captures.
  test.skip(({ viewport }) => viewport?.width !== 1440, 'the verification boards are drawn at 1440 wide');

  test('the list is still loading', async ({ page }) => {
    await openQueue(page, { list: 'never' });
    await expect(page.getByText('Loading applications').first()).toBeVisible();
    await capture(page, { 1440: 'admin/restaurant-verification/Queue-Loading' }, { settled: false });
  });

  test('nobody has applied yet', async ({ page }) => {
    await openQueue(page, { list: [] });
    await expect(page.getByText('Onboarding queue is clear')).toBeVisible();
    // "No restaurants have applied yet" is drawn only when every state is asked for and none comes back.
    await choose(page, 'Onboarding state', 'All 11 states');
    await expect(page.getByText('No restaurants have applied yet')).toBeVisible();
    await capture(page, { 1440: 'admin/restaurant-verification/Queue-NoRecords' });
  });

  test('the filters match nothing', async ({ page }) => {
    await openQueue(page, { listFor: (query, c) => (query.get('sla_breached') ? [] : five(c)) });
    await expect(grid(page).getByText('Karahi House')).toBeVisible();
    await choose(page, 'Onboarding state', 'Fix documents');
    await page.getByText('SLA breached only').click();
    await expect(page.getByText('No applications match these filters')).toBeVisible();
    await capture(page, { 1440: 'admin/restaurant-verification/Queue-Filtered' });
  });

  test('only the applications past their SLA', async ({ page }) => {
    await openQueue(page, { listFor: (query, c) => (query.get('sla_breached') ? [BAIT, AL_NOOR] : five(c)) });
    await expect(grid(page).getByText('Karahi House')).toBeVisible();
    await page.getByText('SLA breached only').click();
    await expect(grid(page).getByText('Al Noor Shawarma')).toBeVisible();
    await expect(grid(page).getByText('Karahi House')).toHaveCount(0);
    await capture(page, { 1440: 'admin/restaurant-verification/Queue-Breached' });
  });

  test('a support agent sees the queue read-only', async ({ page }) => {
    await openQueue(page, { role: 'SUPPORT_AGENT', list: five });
    await expect(grid(page).getByText('Karahi House')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Take next' })).toHaveCount(0);
    await capture(page, { 1440: 'admin/restaurant-verification/Queue-Support' });
  });

  test('loading more rows', async ({ page }) => {
    // The page loads the next one by itself as soon as the end of the list is in view, so the
    // state on screen is the load in flight.
    await openQueue(page, { list: (c) => [...five(c), ...MORE], hasMore: true, more: 'never' });
    await expect(page.getByText('Loading more…')).toBeVisible();
    await capture(page, { 1440: 'admin/restaurant-verification/Queue-More' }, { settled: false });
  });

  test('take next is claiming', async ({ page }) => {
    await openQueue(page, { list: two, take: 'never' });
    await expect(grid(page).getByText('Bait Al Mandi')).toBeVisible();
    const asked = page.waitForRequest((request) => request.url().includes('/take-next'));
    await page.getByRole('button', { name: 'Take next' }).click();
    await asked;
    await capture(page, { 1440: 'admin/restaurant-verification/Queue-Taking' }, { settled: false });
  });

  test('take next found nothing free', async ({ page }) => {
    await openQueue(page, { list: two, take: () => null });
    await expect(grid(page).getByText('Bait Al Mandi')).toBeVisible();
    await page.getByRole('button', { name: 'Take next' }).click();
    await expect(page.getByText('No application was free to take')).toBeVisible();
    await capture(page, { 1440: 'admin/restaurant-verification/Queue-TakeNull' });
  });

  test('take next failed', async ({ page }) => {
    await openQueue(page, { list: two, take: 'error' });
    await expect(grid(page).getByText('Bait Al Mandi')).toBeVisible();
    await page.getByRole('button', { name: 'Take next' }).click();
    await expect(page.getByText('Take next didn’t work')).toBeVisible();
    await capture(page, { 1440: 'admin/restaurant-verification/Queue-TakeError' });
  });

  test('take next while holding a claim', async ({ page }) => {
    await openQueue(page, { list: five, take: () => ({ restaurant_id: KARAHI.id }) });
    await expect(page.getByTestId('ClaimStrip')).toBeVisible();
    await page.getByRole('button', { name: 'Take next' }).click();
    await expect(page.getByText('You already hold Karahi House')).toBeVisible();
    await capture(page, { 1440: 'admin/restaurant-verification/Queue-TakeHeld' });
  });
});
