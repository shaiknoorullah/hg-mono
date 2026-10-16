import { expect, test, type Page } from '@playwright/test';

import { declareUnpairable, expectDesign, expectDesignFor, type BoardFor } from './design';
import { E2E_MODE } from './mode';
import { application, arrive, at, FATIMA, oct, openAt, OTHER_REVIEWER, sep, summaryOf, type Json, type Scene } from './redesign-admin.rider-onboarding.scene';

test.skip(E2E_MODE !== 'mock', 'written against the mock server; run with E2E_MODE=mock');

/**
 * The redesigned admin console's rider applications queue, each state captured for the design board
 * it must match (tools/e2e/README.md, "Design captures"): the populated queue, every Take next
 * outcome, the claim strips, the filter, paging and the ways the list fails. Mock mode: the calls
 * are answered with `page.route` (see redesign-admin.rider-onboarding.scene.ts), which is the only
 * way to give the stateless mock a claim held by the signed-in reviewer, a short page or a failure.
 *
 * Boards are drawn at 1440 wide; the two narrow ones at 1024 and 1280, taken by resizing the page,
 * so the tablet project takes no capture.
 *
 * Board ids are written out in full on purpose: tools/e2e/web/check-boards.mjs validates only
 * literal ids.
 */
const BASE = process.env.E2E_ADMIN_REDESIGN_URL ?? process.env.BASE_URL;
if (BASE) test.use({ baseURL: BASE });

// ── the board's riders ───────────────────────────────────────────────────────

const row = (id: string, name: string, vehicle: Json['vehicle_type'], attempt: number, submitted: string, due: string, over: Json = {}): Json => ({
  rider_account_id: id,
  display_name: name,
  vehicle_type: vehicle,
  onboarding_state: 'DOCUMENTS_REVIEW',
  attempt_number: attempt,
  assigned_admin_id: null,
  review_lock_expires_at: null,
  submitted_at: submitted,
  sla_due_at: due,
  ...over,
});

const MUSA = row('0192f3a4-11d0-7c55-8e2a-77aa01bb3e07', 'Musa Ibrahim', 'SCOOTER', 1, sep(24, 10, 2), sep(27, 16, 2), { assigned_admin_id: OTHER_REVIEWER, review_lock_expires_at: sep(28, 15, 10) });
const fatima = (over: Json = {}) => row(FATIMA.id, 'Fatima Noor', 'CAR', 2, sep(26, 17, 55), sep(30, 9, 55), over);
const YUSUF = row('0192f3b0-5e61-7a02-b3c9-0f1e2d3c4b5a', 'Yusuf Ahmed', 'BICYCLE', 1, sep(27, 8, 40), sep(30, 14, 40));
const HAFSA = row('0192f3b8-9a12-7f33-a1d4-5c6d7e8f2210', 'Hafsa Qureshi', 'MOTORCYCLE', 1, sep(27, 19, 21), oct(1, 11, 21));
const OMAR = row('0192f3c2-2b7e-7d48-9c05-e1f2a3b4c688', 'Omar Siddiqui', 'ON_FOOT', 3, sep(28, 9, 5), oct(1, 15, 5));
const MORE = [
  row('0192f3c9-40aa-7e10-8b21-aa01c2d3e4f5', 'Maryam Hassan', 'BICYCLE', 1, sep(28, 10, 12), oct(1, 16, 12)),
  row('0192f3cc-7d11-7a90-9e33-bb12c3d4e506', 'Bilal Rahman', 'CAR', 1, sep(28, 11, 47), oct(1, 17, 47)),
  row('0192f3d0-1e22-7c41-a5f0-cc23d4e5f617', 'Zainab Khan', 'SCOOTER', 2, sep(28, 13, 9), oct(1, 19, 9)),
];
const FIVE = [MUSA, fatima(), YUSUF, HAFSA, OMAR];

const heldByMe = (me: string, until = sep(28, 15, 14)) => fatima({ assigned_admin_id: me, review_lock_expires_at: until });

const notYet = (n: number, name: string, vehicle: Json['vehicle_type'], state: string) =>
  row(`0192f390-0a0${n}-7b0${n}-800${n}-00000000000${n}`, name, vehicle, 1, sep(26, 12), oct(1, 12), { onboarding_state: state });
const decided = (n: number, name: string, vehicle: Json['vehicle_type'], attempt: number, submitted: string, state: string) =>
  row(`0192f390-0a0${n}-7b0${n}-800${n}-00000000000${n}`, name, vehicle, attempt, submitted, at(submitted), { onboarding_state: state });

const MIXED = [
  fatima(),
  { ...HAFSA, assigned_admin_id: OTHER_REVIEWER, review_lock_expires_at: sep(28, 14, 10) },
  notYet(1, 'Adam Tahir', null, 'REGISTERED'),
  notYet(2, 'Sara Mahmoud', 'CAR', 'PHONE_VERIFIED'),
  notYet(3, 'Ibrahim Osman', 'SCOOTER', 'PROFILE_PENDING'),
  notYet(4, 'Layla Farah', 'CAR', 'VEHICLE_PENDING'),
  notYet(5, 'Hamza Darwish', 'MOTORCYCLE', 'DOCUMENTS_PENDING'),
  decided(6, 'Aisha Bakr', 'CAR', 1, sep(21, 10, 11), 'DOCUMENTS_APPROVED'),
  decided(7, 'Khalid Wahid', 'SCOOTER', 2, sep(19, 13, 25), 'DOCUMENTS_REJECTED'),
  decided(8, 'Noura Saleh', 'BICYCLE', 1, sep(18, 11, 2), 'PAYOUT_PENDING'),
  decided(9, 'Yahya Latif', 'CAR', 1, sep(12, 15, 48), 'ACTIVE'),
];

async function capture(page: Page, board: BoardFor, { settled = true } = {}) {
  // A call that never answers keeps the network busy for good: that state is captured as it is.
  if (settled) await page.waitForLoadState('networkidle');
  // A build older than the screen draws "Not built yet"; that is not the board's state.
  await expect(page.getByText('Not built yet')).toHaveCount(0);
  await expectDesignFor(page, board);
}

/** Opens the queue with the scene and waits for its heading. */
async function openQueue(page: Page, scene: Scene) {
  await arrive(page, scene);
  await openAt(page, '#/riders');
  await expect(page.locator('#app-bar-heading')).toHaveText('Rider applications');
}

const grid = (page: Page) => page.getByRole('grid');

test.describe('redesigned admin · rider applications queue (mock)', () => {
  test.use({ colorScheme: 'light' });

  test('populated, no claim held', async ({ page }) => {
    await openQueue(page, { list: FIVE });
    await expect(grid(page).getByText('Fatima Noor')).toBeVisible();
    await capture(page, { 1440: 'admin/rider-onboarding/Main' });
  });

  test('all ten states and an ended claim', async ({ page }) => {
    await openQueue(page, { list: MIXED, listFor: () => MIXED });
    await expect(grid(page).getByText('Yahya Latif')).toBeVisible();
    await capture(page, { 1440: 'admin/rider-onboarding/QueueAllStates' });
  });

  test('nothing waiting', async ({ page }) => {
    await openQueue(page, { list: [] });
    await expect(page.getByText('Nothing waiting for review')).toBeVisible();
    await capture(page, { 1440: 'admin/rider-onboarding/QueueEmpty' });
  });

  test('the list is still loading', async ({ page }) => {
    await openQueue(page, { list: 'never' });
    await expect(page.getByText('Loading…')).toBeVisible();
    await capture(page, { 1440: 'admin/rider-onboarding/QueueLoading' }, { settled: false });
  });

  test('the list does not load', async ({ page }) => {
    await openQueue(page, { list: 'error' });
    await expect(page.getByText('Rider applications didn’t load')).toBeVisible();
    await capture(page, { 1440: 'admin/rider-onboarding/QueueError' });
  });

  test('no access (403)', async ({ page }) => {
    await openQueue(page, { list: 'forbidden' });
    await expect(page.getByText('You don’t have access to rider applications')).toBeVisible();
    await capture(page, { 1440: 'admin/rider-onboarding/QueueForbidden' });
  });

  test('session expired (401)', async ({ page }) => {
    await openQueue(page, { list: 'session' });
    await expect(page.getByRole('dialog', { name: 'Your session ended' })).toBeVisible();
    await declareUnpairable(
      page,
      'admin/rider-onboarding/QueueSessionExpired',
      'the board draws an in-page "Your session ended" card that replaces the list; the app answers a 401 with the console\u2019s one blocking dialog over the page it was on (drawn by the alerts and sessions boards), a flow the queue does not have',
    );
  });

  test('offline', async ({ page }) => {
    await openQueue(page, { list: FIVE });
    await expect(grid(page).getByText('Fatima Noor')).toBeVisible();
    await page.context().setOffline(true);
    await expect(page.getByText('You’re offline. Take next is paused.')).toBeVisible();
    await capture(page, { 1440: 'admin/rider-onboarding/QueueOffline' });
  });

  test('you hold a claim', async ({ page }) => {
    await openQueue(page, { list: (me) => [MUSA, heldByMe(me), YUSUF, HAFSA, OMAR] });
    await expect(page.getByTestId('ClaimStrip')).toBeVisible();
    await capture(page, { 1440: 'admin/rider-onboarding/QueueHoldingClaim' });
  });

  test('your claim ends in a minute', async ({ page }) => {
    await openQueue(page, { list: (me) => [MUSA, heldByMe(me, sep(28, 14, 33)), YUSUF, HAFSA, OMAR] });
    await expect(page.getByText('1 min left').first()).toBeVisible();
    await capture(page, { 1440: 'admin/rider-onboarding/QueueClaimEnding' });
  });

  test('your claim ended while on the queue', async ({ page }) => {
    await openQueue(page, { now: sep(28, 14, 34), list: (me) => [MUSA, heldByMe(me, sep(28, 14, 33)), YUSUF, HAFSA, OMAR] });
    await expect(page.getByText('Your claim on Fatima Noor ended at')).toBeVisible();
    await capture(page, { 1440: 'admin/rider-onboarding/QueueClaimEnded' });
  });

  test('take next while holding a claim', async ({ page }) => {
    await openQueue(page, {
      list: (me) => [MUSA, heldByMe(me), YUSUF, HAFSA, OMAR],
      take: (me) => application(FATIMA, { assigned_admin_id: me, review_lock_expires_at: sep(28, 15, 14) }),
    });
    await page.getByRole('button', { name: 'Take next' }).click();
    await expect(page.getByText('You already have Fatima Noor claimed')).toBeVisible();
    await capture(page, { 1440: 'admin/rider-onboarding/QueueTakeNextWhileHolding' });
  });

  test('take next is claiming', async ({ page }) => {
    await openQueue(page, { list: FIVE, take: 'never' });
    await expect(grid(page).getByText('Fatima Noor')).toBeVisible();
    await page.getByRole('button', { name: 'Take next' }).click();
    await expect(page.getByText('Claiming the oldest application…')).toBeVisible();
    await capture(page, { 1440: 'admin/rider-onboarding/QueueTakeNextPending' }, { settled: false });
  });

  test('take next failed', async ({ page }) => {
    await openQueue(page, { list: FIVE, take: 'error' });
    await expect(grid(page).getByText('Fatima Noor')).toBeVisible();
    await page.getByRole('button', { name: 'Take next' }).click();
    await expect(page.getByText('Take next didn’t work. Nothing was claimed.')).toBeVisible();
    await capture(page, { 1440: 'admin/rider-onboarding/QueueTakeNextFailed' });
  });

  test('take next found nothing', async ({ page }) => {
    // The first list has someone waiting, so Take next can be pressed; by the time it answers
    // nothing is left, and the list the page reloads is empty.
    let calls = 0;
    await openQueue(page, { listFor: () => (calls++ === 0 ? FIVE : []), take: () => null });
    await expect(grid(page).getByText('Fatima Noor')).toBeVisible();
    await page.getByRole('button', { name: 'Take next' }).click();
    await expect(page.getByText('Nothing to take: no applications are waiting')).toBeVisible();
    // Change the filter and back, which reloads the list without touching the notice.
    await page.getByRole('button', { name: /Onboarding state/ }).click();
    await page.getByRole('option', { name: 'Active' }).click();
    await page.getByRole('option', { name: 'Active' }).click();
    await page.keyboard.press('Escape');
    await expect(page.getByText('Nothing waiting for review')).toBeVisible();
    await capture(page, { 1440: 'admin/rider-onboarding/QueueDrained' });
  });

  test('take next found nothing, every row claimed by others', async ({ page }) => {
    await openQueue(page, { list: [MUSA, fatima({ assigned_admin_id: OTHER_REVIEWER, review_lock_expires_at: sep(28, 15, 2) })] });
    await expect(page.getByText('Nothing to take: the 2 waiting applications are claimed by other reviewers')).toBeVisible();
    await capture(page, { 1440: 'admin/rider-onboarding/QueueTakeNextAllClaimed' });
  });

  test('the state filter matches nothing', async ({ page }) => {
    await openQueue(page, { listFor: (states) => (states.includes('DOCUMENTS_REVIEW') ? FIVE : []) });
    await expect(grid(page).getByText('Fatima Noor')).toBeVisible();
    await page.getByRole('button', { name: /Onboarding state/ }).click();
    await page.getByRole('option', { name: 'Payout pending' }).click();
    await page.getByRole('option', { name: 'Documents review' }).click();
    await page.keyboard.press('Escape');
    await expect(page.getByText('No applications in Payout pending')).toBeVisible();
    await capture(page, { 1440: 'admin/rider-onboarding/QueueFiltered' });
  });

  test('the state filter is open on an option', async ({ page }) => {
    await openQueue(page, { list: FIVE });
    await expect(grid(page).getByText('Fatima Noor')).toBeVisible();
    await page.getByRole('button', { name: /Onboarding state/ }).click();
    await page.getByRole('option', { name: 'Documents rejected' }).click();
    await page.getByRole('option', { name: 'Payout pending' }).click();
    await expect(page.getByRole('listbox')).toBeVisible();
    await capture(page, { 1440: 'admin/rider-onboarding/QueueFilterOpen' });
  });

  test('keyboard focus on a row', async ({ page }) => {
    await openQueue(page, { list: FIVE });
    await expect(grid(page).getByText('Fatima Noor')).toBeVisible();
    await page.keyboard.press('Tab');
    await grid(page).getByRole('row', { name: /Fatima Noor/ }).focus();
    await capture(page, { 1440: 'admin/rider-onboarding/QueueRowFocus' });
  });

  test('more pages, no total', async ({ page }) => {
    // The page loads the next one by itself as soon as the end of the list is in view, so the
    // board's idle "Load more" button is never on screen: what is on screen is the load in flight.
    await openQueue(page, { list: [...FIVE, ...MORE], hasMore: true, more: 'never' });
    await expect(page.getByText('Loading more…')).toBeVisible();
    await declareUnpairable(
      page,
      'admin/rider-onboarding/QueuePaged',
      'the board draws a "Load more" button waiting to be pressed; the app has no such button and loads the next page by itself when the list end is in view, so this state is never on screen',
    );
  });

  test('loading more rows', async ({ page }) => {
    await openQueue(page, { list: [...FIVE, ...MORE], hasMore: true, more: 'never' });
    await expect(page.getByText('Loading more…')).toBeVisible();
    await capture(page, { 1440: 'admin/rider-onboarding/QueueLoadingMore' }, { settled: false });
  });

  test('loading more rows failed', async ({ page }) => {
    await openQueue(page, { list: [...FIVE, ...MORE], hasMore: true, more: 'error' });
    await expect(page.getByText("More didn't load.")).toBeVisible();
    await capture(page, { 1440: 'admin/rider-onboarding/QueueLoadMoreFailed' });
  });

  test('end of list', async ({ page }) => {
    await openQueue(page, { list: [...FIVE, ...MORE] });
    await expect(grid(page).getByText('Zainab Khan')).toBeVisible();
    await capture(page, { 1440: 'admin/rider-onboarding/QueueEndOfList' });
  });

  for (const [width, board] of [
    [1024, 'admin/rider-onboarding/QueueNarrow1024'],
    [1280, 'admin/rider-onboarding/QueueNarrow1280'],
  ] as const) {
    test(`${width} px`, async ({ page }, info) => {
      test.skip(info.project.metadata.viewport !== 'desktop', 'drawn at its own width: taken once, by the desktop project');
      await page.setViewportSize({ width, height: 900 });
      await openQueue(page, { list: FIVE });
      await expect(grid(page).getByText('Fatima Noor')).toBeVisible();
      await page.waitForLoadState('networkidle');
      await expect(page.getByText('Not built yet')).toHaveCount(0);
      await expectDesign(page, board);
    });
  }
});
