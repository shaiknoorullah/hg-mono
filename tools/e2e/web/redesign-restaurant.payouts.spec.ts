import { expect, test, type Page, type Route } from '@playwright/test';

import { declareUnpairable, expectDesignFor, type BoardFor } from './design';
import { MOCK_API, MODE, openSignedIn } from './redesign-restaurant.support';
import { projectMeta } from './mode';

test.skip(MODE !== 'mock', 'written against the mock server; run with E2E_MODE=mock');

/**
 * The redesigned restaurant console's payouts pages (the payout account at /payouts, the history
 * at /payouts/history with a payout open beside it, contact support from a payout), each state
 * captured for the design board it must match (tools/e2e/README.md, "Design captures"). Boards
 * are drawn at 1440 wide; where a landscape-tablet board exists it is declared for 1024. Mock
 * mode: every state is served with `page.route` from the mock's own fixtures
 * (`restaurant_payout_history_every_state`, `connect_status_*`, `restaurant_profile_account_*`),
 * patched only where a board draws a state the fixtures do not (a payout with no reason, no count).
 *
 * Covered: the payout account (18 states), the history (7), one payout open (17), contact support
 * from a payout, the three tablet boards and the 320 px reflow board: 47 boards, each captured at
 * the width it is drawn for.
 *
 * Declared unpairable, with the reason on each: the page-composition and component boards that
 * the state boards are made of (`ScreenPayouts`, `ScreenPhone`, `PartPayoutTable`,
 * `PartPayoutDetail`).
 *
 * Not covered here, and why (the pull request lists them):
 *   - `PayoutDetail-ReversalLater` and `PayoutDetail-HalalAdjustment`: the contract carries no
 *     per-payout entries, reversal or adjustment lines to draw ([#909](https://github.com/shaiknoorullah/hg-mono/issues/909)).
 *   - `Payouts-LiveFailed` and `Payouts-LiveSending`: a payout changing while its panel is open
 *     needs a realtime push, which this spec does not drive yet.
 *   - The families that are not payouts screens: the orders strip over a payouts backdrop
 *     (`Orders-Strip-*`), the notifications bell (`Bell-*`), the side navigation (`Rail-*`),
 *     keyboard focus (`Focus-Visible`), and copies of the settings area's parts.
 *
 * Board ids are written out in full on purpose: tools/e2e/web/check-boards.mjs validates only
 * literal ids.
 */

const PAYOUTS_LIST = /\/v1\/restaurant\/payouts(\?|$)/;
const never = () => new Promise<void>(() => undefined);
const failing = (route: Route) =>
  route.fulfill({ status: 500, json: { error: { code: 'INTERNAL_ERROR', message: 'boom', request_id: 'req_e2e' } } });
const notFound = (route: Route) =>
  route.fulfill({ status: 404, json: { error: { code: 'NOT_FOUND', message: 'no payout account yet', request_id: 'req_e2e' } } });
const conflict = (route: Route) =>
  route.fulfill({ status: 409, json: { error: { code: 'STEP_NOT_AVAILABLE', message: 'not yet', request_id: 'req_e2e' } } });

interface Payout {
  id: string;
  state: string;
  period_start: string;
  period_end: string;
  amount_cents: number;
  [key: string]: unknown;
}

async function fixture<T = any>(page: Page, name: string): Promise<T> {
  const res = await page.request.get(`${MOCK_API}/__mock/scenarios/${name}`);
  return (await res.json()).data.payload;
}

interface Scene {
  /** A `connect_status_*` fixture, or how the call goes wrong. */
  connect?: string | 'none' | 'error' | 'never';
  /** A `restaurant_profile_account_*` fixture; the live account when left out. */
  profile?: string;
  /** The first page of the history. */
  payouts?: Payout[] | 'error' | 'never';
  /** Whether the first page has an older page behind it, and how that older page goes. */
  older?: 'none' | 'ok' | 'error' | 'never';
}

/** Routes the calls the payouts pages make, then opens `path` signed in as the owner. */
async function open(page: Page, path: string, scene: Scene = {}) {
  const { connect = 'connect_status_complete', profile = 'restaurant_profile_account_live', payouts = [], older = 'none' } = scene;
  const profileBody = await fixture(page, profile);
  await page.route('**/v1/restaurant/profile', (route) => route.fulfill({ json: { data: profileBody } }));
  if (connect === 'none') await page.route('**/v1/connect/status', notFound);
  else if (connect === 'error') await page.route('**/v1/connect/status', failing);
  else if (connect === 'never') await page.route('**/v1/connect/status', never);
  else {
    const body = await fixture(page, connect);
    await page.route('**/v1/connect/status', (route) => route.fulfill({ json: { data: body } }));
  }
  const olderPage = (await fixture<Payout[]>(page, 'restaurant_payout_history_page_2')).slice(0, 3);
  await page.route(PAYOUTS_LIST, async (route) => {
    const cursor = new URL(route.request().url()).searchParams.get('cursor');
    if (cursor) {
      if (older === 'error') return failing(route);
      if (older === 'never') return never();
      return route.fulfill({ json: { data: olderPage, meta: { next_cursor: null, has_more: false, total: null } } });
    }
    if (payouts === 'error') return failing(route);
    if (payouts === 'never') return never();
    const more = older !== 'none';
    return route.fulfill({ json: { data: payouts, meta: { next_cursor: more ? 'older' : null, has_more: more, total: null } } });
  });
  await openSignedIn(page, path);
}

async function capture(page: Page, board: BoardFor, { settled = true } = {}) {
  // A call that never answers keeps the network busy for good: the loading state is captured as it is.
  if (settled) await page.waitForLoadState('networkidle');
  await expect(page.getByText('Not built yet')).toHaveCount(0);
  await expectDesignFor(page, board);
}

const EVERY = (page: Page) => fixture<Payout[]>(page, 'restaurant_payout_history_every_state');
const rowOf = (rows: Payout[], state: string) => rows.find((r) => r.state === state)!;

/** The history with one payout open beside it. */
async function openPayout(page: Page, state: string, scene: Scene = {}, patch: (p: Payout) => Payout = (p) => p) {
  const rows = (await EVERY(page)).map((r) => (r.state === state ? patch(r) : r));
  const id = rowOf(rows, state).id;
  await open(page, `/payouts/history?payout=${id}`, { payouts: rows, ...scene });
  await expect(page.getByTestId('payout-detail')).toBeVisible();
  return rows;
}

/** A week starting `ymd` (Toronto midnight), the way the server sends a payout's period. */
const week = (ymd: string) => {
  const start = new Date(`${ymd}T04:00:00Z`);
  return { period_start: start.toISOString(), period_end: new Date(start.getTime() + 7 * 86_400_000).toISOString() };
};

test.describe('redesigned restaurant · payout account (mock)', () => {
  test.use({ colorScheme: 'light' });

  test('payouts on', async ({ page }) => {
    await open(page, '/payouts');
    await expect(page.getByTestId('payouts-account')).toHaveAttribute('data-mode', 'on');
    await capture(page, { 1440: 'restaurant/payouts/Main', 1024: 'restaurant/payouts/Tablet-Payouts' });
  });

  test('loading', async ({ page }) => {
    await open(page, '/payouts', { connect: 'never' });
    await expect(page.getByTestId('account-loading')).toBeVisible();
    await capture(page, { 1440: 'restaurant/payouts/Payouts-Loading' }, { settled: false });
  });

  test('the payout account does not load', async ({ page }) => {
    await open(page, '/payouts', { connect: 'error' });
    await expect(page.getByText('Couldn’t load your payout account')).toBeVisible();
    await capture(page, { 1440: 'restaurant/payouts/Payouts-ConnectError' });
  });

  test('no payout account yet', async ({ page }) => {
    await open(page, '/payouts', { connect: 'none' });
    await expect(page.getByTestId('banner-none')).toBeVisible();
    await capture(page, { 1440: 'restaurant/payouts/Payouts-NoAccount' });
  });

  test('the restaurant is not approved yet', async ({ page }) => {
    await open(page, '/payouts', { connect: 'none', profile: 'restaurant_profile_account_pending' });
    await expect(page.getByText('Payout setup opens once HalalGoes approves your documents.')).toBeVisible();
    await capture(page, { 1440: 'restaurant/payouts/Payouts-NotApprovedYet' });
  });

  test('setting up with Stripe', async ({ page }) => {
    await page.route('**/v1/connect/account', never);
    await open(page, '/payouts', { connect: 'none' });
    await page.getByRole('button', { name: 'Set up payouts with Stripe' }).click();
    await expect(page.getByRole('button', { name: 'Setting up with Stripe' })).toBeVisible();
    await capture(page, { 1440: 'restaurant/payouts/Payouts-NoAccount-Creating' }, { settled: false });
  });

  test('setup could not start', async ({ page }) => {
    await page.route('**/v1/connect/account', failing);
    await open(page, '/payouts', { connect: 'none' });
    await page.getByRole('button', { name: 'Set up payouts with Stripe' }).click();
    await expect(page.getByTestId('problem-create')).toBeVisible();
    await capture(page, { 1440: 'restaurant/payouts/Payouts-NoAccount-Error' });
  });

  test('on hold until Stripe has what it needs', async ({ page }) => {
    await open(page, '/payouts', { connect: 'connect_status_currently_due' });
    await expect(page.getByTestId('banner-held')).toBeVisible();
    await capture(page, { 1440: 'restaurant/payouts/Payouts-SetupIncomplete' });
  });

  test("Stripe's exact list in the panel", async ({ page }) => {
    await open(page, '/payouts', { connect: 'connect_status_past_due' });
    await page.getByRole('button', { name: 'See Stripe’s exact list' }).first().click();
    await expect(page.getByTestId('stripe-list-panel')).toBeVisible();
    await capture(page, { 1440: 'restaurant/payouts/Payouts-SetupList' });
  });

  test('Stripe needs something by a date, payouts still on', async ({ page }) => {
    await open(page, '/payouts', { connect: 'connect_status_due_with_deadline' });
    await expect(page.getByTestId('banner-due-soon')).toBeVisible();
    await capture(page, { 1440: 'restaurant/payouts/Payouts-DueSoon' });
  });

  test('opening Stripe', async ({ page }) => {
    await page.route('**/v1/connect/onboarding-link', never);
    await open(page, '/payouts', { connect: 'connect_status_currently_due' });
    await page.getByRole('button', { name: 'Finish payout setup in Stripe' }).click();
    await capture(page, { 1440: 'restaurant/payouts/Payouts-StripeOpening' }, { settled: false });
  });

  test('Stripe could not be opened', async ({ page }) => {
    await page.route('**/v1/connect/onboarding-link', failing);
    await open(page, '/payouts', { connect: 'connect_status_currently_due' });
    await page.getByRole('button', { name: 'Finish payout setup in Stripe' }).click();
    await expect(page.getByTestId('problem-link')).toBeVisible();
    await capture(page, { 1440: 'restaurant/payouts/Payouts-StripeError' });
  });

  test('setup is not available yet', async ({ page }) => {
    await page.route('**/v1/connect/onboarding-link', conflict);
    await open(page, '/payouts', { connect: 'connect_status_currently_due' });
    await page.getByRole('button', { name: 'Finish payout setup in Stripe' }).click();
    await expect(page.getByTestId('problem-step-na')).toBeVisible();
    await capture(page, { 1440: 'restaurant/payouts/Payouts-Stripe409' });
  });

  test('back from Stripe, still checking', async ({ page }) => {
    await open(page, '/payouts/return', { connect: 'connect_status_pending_verification' });
    await expect(page.getByTestId('banner-checking')).toBeVisible();
    await capture(page, { 1440: 'restaurant/payouts/Payouts-StripeReturn-Checking' });
  });

  test('back from Stripe, payouts are on', async ({ page }) => {
    await open(page, '/payouts/return', { connect: 'connect_status_complete' });
    await expect(page.getByTestId('banner-on')).toBeVisible();
    await capture(page, { 1440: 'restaurant/payouts/Payouts-StripeReturn-On' });
  });

  test('back from Stripe, still needs something', async ({ page }) => {
    await open(page, '/payouts/return', { connect: 'connect_status_currently_due' });
    await expect(page.getByTestId('banner-held')).toBeVisible();
    await capture(page, { 1440: 'restaurant/payouts/Payouts-StripeReturn-Still' });
  });

  test('account suspended', async ({ page }) => {
    await open(page, '/payouts', { profile: 'restaurant_profile_account_suspended' });
    await expect(page.getByTestId('banner-restricted')).toBeVisible();
    await capture(page, { 1440: 'restaurant/payouts/Payouts-Suspended' });
  });

  test('account banned', async ({ page }) => {
    await open(page, '/payouts', { profile: 'restaurant_profile_account_banned' });
    await expect(page.getByTestId('banner-restricted')).toBeVisible();
    await capture(page, { 1440: 'restaurant/payouts/Payouts-Banned' });
  });
});

test.describe('redesigned restaurant · payout history (mock)', () => {
  test.use({ colorScheme: 'light' });

  test('every state, with older payouts to load', async ({ page }) => {
    await open(page, '/payouts/history', { payouts: await EVERY(page), older: 'ok' });
    await expect(page.getByRole('button', { name: 'Load more' })).toBeVisible();
    await capture(page, { 1440: 'restaurant/payouts/Payouts-History', 1024: 'restaurant/payouts/Tablet-PayoutsHistory' });
  });

  test('none yet', async ({ page }) => {
    await open(page, '/payouts/history', { payouts: [] });
    await expect(page.getByTestId('payouts-empty')).toBeVisible();
    await capture(page, { 1440: 'restaurant/payouts/Payouts-Empty' });
  });

  test('the history does not load', async ({ page }) => {
    await open(page, '/payouts/history', { payouts: 'error' });
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
    await capture(page, { 1440: 'restaurant/payouts/Payouts-Error' });
  });

  test('loading', async ({ page }) => {
    await open(page, '/payouts/history', { payouts: 'never' });
    await expect(page.getByTestId('payouts-history')).toHaveAttribute('data-state', 'loading');
    await capture(page, { 1440: 'restaurant/payouts/Payouts-HistoryLoading' }, { settled: false });
  });

  test('loading older payouts', async ({ page }) => {
    await open(page, '/payouts/history', { payouts: await EVERY(page), older: 'never' });
    await page.getByRole('button', { name: 'Load more' }).click();
    await capture(page, { 1440: 'restaurant/payouts/Payouts-LoadMore' }, { settled: false });
  });

  test('older payouts do not load', async ({ page }) => {
    await open(page, '/payouts/history', { payouts: await EVERY(page), older: 'error' });
    await page.getByRole('button', { name: 'Load more' }).click();
    await expect(page.getByText(/Couldn’t load more payouts/)).toBeVisible();
    await capture(page, { 1440: 'restaurant/payouts/Payouts-LoadMoreError' });
  });

  test('the end of the list', async ({ page }) => {
    await open(page, '/payouts/history', { payouts: await EVERY(page), older: 'ok' });
    await page.getByRole('button', { name: 'Load more' }).click();
    await expect(page.getByText('That’s every payout so far.')).toBeVisible();
    await capture(page, { 1440: 'restaurant/payouts/Payouts-End' });
  });
});

test.describe('redesigned restaurant · one payout (mock)', () => {
  test.use({ colorScheme: 'light' });

  const states: [string, string, string][] = [
    ['accruing', 'DRAFT', 'restaurant/payouts/PayoutDetail-Draft'],
    ['ready to send', 'READY', 'restaurant/payouts/PayoutDetail-Ready'],
    ['sending to Stripe', 'TRANSFERRING', 'restaurant/payouts/PayoutDetail-Sending'],
    ['sent to Stripe', 'TRANSFERRED', 'restaurant/payouts/PayoutDetail-SentToStripe'],
    ['on hold', 'HELD', 'restaurant/payouts/PayoutDetail-OnHold'],
    ['failed', 'FAILED', 'restaurant/payouts/PayoutDetail-Failed'],
  ];
  // The board ids are literal in the table above and below; the loop only runs them.
  for (const [name, state, board] of states) {
    test(name, async ({ page }) => {
      await openPayout(page, state);
      await capture(page, { 1440: board });
    });
  }

  test('paid', async ({ page }) => {
    await openPayout(page, 'PAID');
    await capture(page, { 1440: 'restaurant/payouts/PayoutDetail-Paid', 1024: 'restaurant/payouts/Tablet-PayoutDetail' });
  });

  test('paid, no order count', async ({ page }) => {
    await openPayout(page, 'PAID', {}, ({ entry_count: _count, ...rest }) => rest as Payout);
    await expect(page.getByText('Not given').first()).toBeVisible();
    await capture(page, { 1440: 'restaurant/payouts/PayoutDetail-PaidNoCount' });
  });

  test('failed, no reason', async ({ page }) => {
    await openPayout(page, 'FAILED', {}, (p) => ({ ...p, failure_message: null }));
    await expect(page.getByTestId('why-failed')).toBeVisible();
    await capture(page, { 1440: 'restaurant/payouts/PayoutDetail-FailedNoReason' });
  });

  test('on hold, no reason', async ({ page }) => {
    await openPayout(page, 'HELD', {}, (p) => ({ ...p, hold_reason: null }));
    await expect(page.getByTestId('hold-reason')).toHaveAttribute('data-recorded', 'false');
    await capture(page, { 1440: 'restaurant/payouts/PayoutDetail-OnHoldNoReason' });
  });

  test('on hold, account suspended', async ({ page }) => {
    await openPayout(page, 'HELD', { profile: 'restaurant_profile_account_suspended' }, (p) => ({ ...p, ...week('2026-09-07') }));
    await capture(page, { 1440: 'restaurant/payouts/PayoutDetail-OnHoldSuspended' });
  });

  test('on hold, account banned', async ({ page }) => {
    await openPayout(page, 'HELD', { profile: 'restaurant_profile_account_banned' }, (p) => ({ ...p, ...week('2026-09-07') }));
    await capture(page, { 1440: 'restaurant/payouts/PayoutDetail-OnHoldBanned' });
  });

  test('on hold for Stripe setup, earlier week', async ({ page }) => {
    await openPayout(page, 'HELD', { connect: 'connect_status_currently_due' }, (p) => ({ ...p, ...week('2026-08-31') }));
    await expect(page.getByTestId('held-setup')).toBeVisible();
    await capture(page, { 1440: 'restaurant/payouts/PayoutDetail-OnHoldSetup-Aug31' });
  });

  test('on hold for Stripe setup', async ({ page }) => {
    await openPayout(page, 'HELD', { connect: 'connect_status_currently_due' }, (p) => ({ ...p, ...week('2026-09-07') }));
    await expect(page.getByTestId('held-setup')).toBeVisible();
    await capture(page, { 1440: 'restaurant/payouts/PayoutDetail-OnHoldSetup-Sep7' });
  });

  test('opening a saved link, still looking for the payout', async ({ page }) => {
    await open(page, '/payouts/history?payout=00000000-0000-4000-8000-000000000000', { payouts: await EVERY(page), older: 'never' });
    await expect(page.getByTestId('payout-searching')).toBeVisible();
    await capture(page, { 1440: 'restaurant/payouts/PayoutDetail-DeepLinkLoading' }, { settled: false });
  });

  test('the payout could not be found', async ({ page }) => {
    await open(page, '/payouts/history?payout=00000000-0000-4000-8000-000000000000', { payouts: await EVERY(page) });
    await expect(page.getByTestId('payout-not-found')).toBeVisible();
    await capture(page, { 1440: 'restaurant/payouts/PayoutDetail-NotFound' });
  });

  test('the payout could not be loaded', async ({ page }) => {
    await open(page, '/payouts/history?payout=00000000-0000-4000-8000-000000000000', { payouts: await EVERY(page), older: 'error' });
    await expect(page.getByTestId('payout-load-error')).toBeVisible();
    await capture(page, { 1440: 'restaurant/payouts/PayoutDetail-LoadError' });
  });

  test('contact support about a payout', async ({ page }) => {
    await openPayout(page, 'FAILED');
    await page.getByRole('button', { name: 'Contact support' }).click();
    await expect(page.getByTestId('payout-support-panel')).toBeVisible();
    await capture(page, { 1440: 'restaurant/payouts/Support-Payout' });
  });
});

test.describe('redesigned restaurant · payouts at phone width (mock)', () => {
  test.use({ colorScheme: 'light', viewport: { width: 320, height: 1000 } });

  test('the payout account, one column', async ({ page }) => {
    test.skip(projectMeta().viewport !== 'desktop', 'one capture at 320 px, not one per project');
    await open(page, '/payouts');
    await expect(page.getByTestId('payouts-account')).toHaveAttribute('data-mode', 'on');
    await capture(page, { 320: 'restaurant/payouts/Reflow-Payouts-320' });
    // The page itself never scrolls sideways at this width.
    const wide = await page.evaluate(() => document.scrollingElement!.scrollWidth - window.innerWidth);
    expect(wide).toBeLessThanOrEqual(0);
  });

  test('the history is stacked rows, and a payout opens over the whole pane', async ({ page }) => {
    test.skip(projectMeta().viewport !== 'desktop', 'one run at 320 px, not one per project');
    const rows = await EVERY(page);
    await open(page, '/payouts/history', { payouts: rows });
    const list = page.getByRole('list', { name: 'Payouts, newest first' });
    await expect(list.getByRole('listitem')).toHaveCount(rows.length);
    await expect(page.getByRole('grid')).toHaveCount(0);
    await list.getByRole('button').first().click();
    const panel = page.getByTestId('payout-panel');
    await expect(panel).toBeVisible();
    const box = await panel.boundingBox();
    expect(box!.x + box!.width).toBeLessThanOrEqual(320);
    // The history beside it is hidden, not squeezed.
    await expect(list).toBeHidden();
    const wide = await page.evaluate(() => document.scrollingElement!.scrollWidth - window.innerWidth);
    expect(wide).toBeLessThanOrEqual(0);
  });
});

test.describe('redesigned restaurant · payouts, boards that cannot be compared (mock)', () => {
  test.use({ colorScheme: 'light' });

  test('the composition and component boards', async ({ page }) => {
    test.skip(projectMeta().viewport !== 'desktop', 'declared once, at 1440');
    await open(page, '/payouts/history', { payouts: await EVERY(page) });
    await expect(page.getByTestId('payouts-table')).toBeVisible();
    await declareUnpairable(
      page,
      'restaurant/payouts/ScreenPayouts',
      'a host component, drawn 1 by 1: every Payouts-* and PayoutDetail-* board imports it with one variant, so the variants are compared and the host has no screen of its own',
    );
    await declareUnpairable(
      page,
      'restaurant/payouts/ScreenPhone',
      'a host component with no fixed size: the phone boards (Reflow-Payouts-320) import it with one screen name and a width, so those are compared instead',
    );
    await declareUnpairable(
      page,
      'restaurant/payouts/PartPayoutTable',
      'a component board: the payout table drawn alone with its variants, without the page around it; the history boards that compose it are compared instead',
    );
    await declareUnpairable(
      page,
      'restaurant/payouts/PartPayoutDetail',
      'a component board: the payout panel body drawn alone with its states (a 1 by 1 host); the PayoutDetail-* boards that compose it are compared instead',
    );
  });
});
