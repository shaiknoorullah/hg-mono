import { expect, test, type Page, type Route } from '@playwright/test';

import { declareUnpairable, expectDesignFor, type BoardFor } from './design';
import { E2E_MODE } from './mode';
import { routeLogin, signIn, type StaffRole } from './redesign-admin.support';

test.skip(E2E_MODE !== 'mock', 'written against the mock server; run with E2E_MODE=mock');

/**
 * The orders area of the redesigned admin console, each state captured for the design board it
 * must match (tools/e2e/README.md, "Design captures"): the orders list, the disputes list, the order
 * workspace and its cancel and reveal panels.
 *
 * Every response is a contract fixture, served by the mock server by scenario name
 * (`X-Mock-Scenario`), so a state is one the fixtures already describe: nothing is invented here.
 * The browser clock is the fixtures' own frozen clock, so a deadline in a fixture is as far ahead
 * as the fixture says. A state the fixtures cannot describe is not captured here; the pull request
 * lists each one with the reason.
 *
 * Boards are drawn at 1440 wide (two at 1280), so the tablet project takes no capture.
 */
const BASE = process.env.E2E_ADMIN_REDESIGN_URL ?? process.env.BASE_URL;
if (BASE) test.use({ baseURL: BASE });

const OR = 'admin/orders/';

/** The clock the contract fixtures are written against (contracts/fixtures/index.json, `frozen_clock`). */
const FROZEN_CLOCK = new Date('2026-08-10T18:42:11.412Z');

const LIST = /\/v1\/admin\/orders(\?.*)?$/;
const ORDER = /\/v1\/admin\/orders\/[^/?]+(\?.*)?$/;
const CANCEL = /\/v1\/admin\/orders\/[^/?]+\/cancel/;
const MOCK = process.env.E2E_MOCK_API_URL ?? 'http://localhost:4010';

/** Answers the request with the fixture `name`, as the mock server serves it. */
async function serve(route: Route, name: string): Promise<void> {
  const response = await route.fetch({ headers: { ...route.request().headers(), 'x-mock-scenario': name } });
  await route.fulfill({ response });
}
const fixture = (name: string) => (route: Route) => serve(route, name);
const never = () => new Promise<void>(() => undefined);

/** The id of the order a fixture describes, so the address names an order the list could hold. */
async function orderIdOf(page: Page, scenario: string): Promise<string> {
  const response = await page.request.get(`${MOCK}/v1/admin/orders/any?scenario=${scenario}`);
  return ((await response.json()) as { data: { id: string } }).data.id;
}

/** Milliseconds from the fixtures' clock to the deadline of the first row or order in state `state`. */
async function msToDeadline(page: Page, scenario: string, state: string): Promise<number> {
  const body = (await (await page.request.get(`${MOCK}/v1/admin/orders?scenario=${scenario}`)).json()) as {
    data: { state: string; deadline_at: string | null }[];
  };
  const row = body.data.find((r) => r.state === state && r.deadline_at);
  if (!row?.deadline_at) throw new Error(`no ${state} row with a deadline in ${scenario}`);
  return Date.parse(row.deadline_at) - FROZEN_CLOCK.getTime();
}

async function orderMsToDeadline(page: Page, scenario: string): Promise<number> {
  const body = (await (await page.request.get(`${MOCK}/v1/admin/orders/any?scenario=${scenario}`)).json()) as { data: { deadline_at: string | null } };
  if (!body.data.deadline_at) throw new Error(`${scenario} has no deadline`);
  return Date.parse(body.data.deadline_at) - FROZEN_CLOCK.getTime();
}

interface Setup {
  role?: StaffRole;
  /** Answers for `GET /v1/admin/orders`, by cursor: no cursor is the first page. */
  list?: (route: Route, cursor: string | null) => Promise<void>;
  /** Answers for `GET /v1/admin/orders/{id}`. */
  order?: (route: Route, revealed: boolean) => Promise<void>;
  cancel?: (route: Route) => Promise<void>;
  /** Move the browser clock from the fixtures' own, in ms. */
  clockShift?: number;
  /** Anything else to route before the page opens. */
  before?: (page: Page) => Promise<void>;
}

/** Signs in with the fixtures' clock and routes, then opens `hash`. */
async function open(page: Page, hash: string, setup: Setup = {}) {
  await routeLogin(page, setup.role ?? 'ADMIN');
  await page.clock.install({ time: new Date(FROZEN_CLOCK.getTime() + (setup.clockShift ?? 0)) });
  if (setup.list) {
    const list = setup.list;
    await page.route(LIST, (route) => list(route, new URL(route.request().url()).searchParams.get('cursor')));
  }
  if (setup.order) {
    const order = setup.order;
    await page.route(ORDER, (route) => order(route, new URL(route.request().url()).searchParams.get('reveal_pii') === 'true'));
  }
  if (setup.cancel) await page.route(CANCEL, setup.cancel);
  await setup.before?.(page);
  await page.goto('/');
  await signIn(page);
  await expect(page.locator('#app-bar-heading')).toBeVisible();
  await page.evaluate((h) => {
    window.location.hash = h;
  }, hash);
}

/** `idle: false` for a state with a request that is meant to stay open: the page never goes idle. */
async function capture(page: Page, board: BoardFor, { idle = true }: { idle?: boolean } = {}) {
  await page.waitForLoadState(idle ? 'networkidle' : 'load');
  // A build older than the screen draws "Not built yet"; that is not the board's state.
  await expect(page.getByText('Not built yet')).toHaveCount(0);
  await expectDesignFor(page, board);
}

/** Scrolls the end of the list into view, which is what asks for the next page. */
const scrollToEnd = (page: Page) => page.locator('div.h-px[aria-hidden="true"]').first().scrollIntoViewIfNeeded();

const EVERY_STATE = fixture('order_admin_list_every_state');
/**
 * The open disputes the disputes boards list (`OrdersGrid`): four on the first page and, on the boards
 * that load the rest, two more behind it. [code, restaurant, halal state, items, first two item names,
 * total in cents, placed at (UTC), seconds to the dispute deadline]. The fixtures' disputed pages are 20 and 7
 * generated rows, which unit tests count; the captures take the boards' rows in the same shape.
 */
type Dispute = [string, string, string | null, number, string[], number, string, number];
const DISPUTES_FIRST: Dispute[] = [
  ['HG-9KD2WA', 'Zaytoun Grill', 'CERTIFIED', 1, ['Mixed grill platter'], 1749, '2026-09-28T20:12:00.000Z', 150000],
  ['HG-3KX7PB', 'Lahori Tandoor', 'CERTIFIED', 3, ['Chicken karahi', 'Naan'], 3874, '2026-09-28T01:03:00.000Z', 88000],
  ['HG-8PW3KC', 'Sham Shawarma', null, 2, ['Chicken shawarma plate', 'Hummus'], 2450, '2026-09-27T16:30:00.000Z', 41000],
  ['HG-6MH2QD', 'Anatolia Kebab House', 'EXPIRING_SOON', 1, ['Adana kebab plate'], 2199, '2026-09-26T22:47:00.000Z', 9000],
];
const DISPUTES_SECOND: Dispute[] = [
  ['HG-5KR2VE', 'Bismillah Kitchen', 'UNVERIFIED', 2, ['Haleem', 'Naan'], 2240, '2026-09-26T17:05:00.000Z', 120000],
  ['HG-1QZ9TA', 'Mandi Express', 'EXPIRED', 1, ['Lamb mandi'], 3299, '2026-09-25T23:40:00.000Z', 16000],
];
const HALAL_BODY = 'Halal Monitoring Authority (HMA Canada)';

/** `paged`: the first four have two more behind them; otherwise those four are every open dispute. */
async function boardDisputes(route: Route, cursor: string | null, paged = false): Promise<void> {
  const response = await route.fetch({ headers: { ...route.request().headers(), 'x-mock-scenario': 'order_admin_list_disputed_page_1' } });
  const body = (await response.json()) as { data: Record<string, any>[]; meta?: Record<string, unknown> };
  const rows = cursor ? DISPUTES_SECOND : DISPUTES_FIRST;
  const data = rows.map(([code, name, halal, count, names, total, placed, secs], i) => ({
    ...body.data[0],
    id: `0192b1c0-0000-7000-8000-${String(cursor ? 100 + i : i + 1).padStart(12, '0')}`,
    code,
    restaurant: {
      id: `0192b1c0-0000-7000-8000-${String(900 + code.charCodeAt(4)).padStart(12, '0')}`,
      name,
      logo_image_url: body.data[0]!.restaurant.logo_image_url,
      ...(halal ? { halal: { display_state: halal, certifying_body_name: halal === 'UNVERIFIED' ? null : HALAL_BODY, expires_on: halal === 'UNVERIFIED' ? null : '2027-03-09' } } : {}),
    },
    item_count: count,
    first_item_names: names,
    total_cents: total,
    placed_at: placed,
    deadline_at: new Date(FROZEN_CLOCK.getTime() + secs * 1000).toISOString(),
  }));
  const more = paged && !cursor;
  await route.fulfill({ response, json: { ...body, data, meta: { ...body.meta, next_cursor: more ? 'board-second-page' : null, has_more: more, total: null } } });
}
const DISPUTED_PAGES = (route: Route, cursor: string | null) => boardDisputes(route, cursor);
const DISPUTED_FIRST_OF_TWO = (route: Route, cursor: string | null) => boardDisputes(route, cursor, true);
const EMPTY = (route: Route) => route.fulfill({ json: { data: [], meta: { next_cursor: null, has_more: false } } });
const FAILS = (route: Route) => serve(route, 'error_internal_error');
const SESSION_ENDED = (route: Route) => serve(route, 'error_session_expired');

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.metadata.viewport === 'tablet', 'the boards are drawn at 1440 and 1280 wide');
});

test.describe('redesigned admin · orders list (mock)', () => {
  test.use({ colorScheme: 'light' });

  test('orders, still loading', async ({ page }) => {
    await open(page, '#/orders', { list: never });
    await expect(page.getByText('Loading orders').first()).toBeVisible();
    await capture(page, { 1440: `${OR}OrdersLoading` }, { idle: false });
  });

  test('orders, none yet', async ({ page }) => {
    await open(page, '#/orders', { list: EMPTY });
    await expect(page.getByText('No orders yet')).toBeVisible();
    await capture(page, { 1440: `${OR}OrdersEmpty` });
  });

  test('orders, the list does not load', async ({ page }) => {
    await open(page, '#/orders', { list: FAILS });
    await expect(page.getByText('Orders didn’t load')).toBeVisible();
    await capture(page, { 1440: `${OR}OrdersError` });
  });

  test('orders, the end of the list', async ({ page }) => {
    await open(page, '#/orders', { list: EVERY_STATE });
    await expect(page.getByText('That’s every order for these filters.')).toBeVisible();
    await capture(page, { 1440: `${OR}OrdersEndOfList` });
  });

  test('orders, as a support agent', async ({ page }) => {
    await open(page, '#/orders', { role: 'SUPPORT_AGENT', list: EVERY_STATE });
    await expect(page.getByText('That’s every order for these filters.')).toBeVisible();
    await capture(page, { 1440: `${OR}OrdersSupport` });
  });

  test('orders, filtered by an account id', async ({ page }) => {
    await open(page, '#/orders?account_id=0191fa11-7c20-7e55-a1d0-2b8e41c99e04', { role: 'SUPPORT_AGENT', list: EVERY_STATE });
    await expect(page.getByText('That’s every order for these filters.')).toBeVisible();
    await capture(page, { 1440: `${OR}OrdersAccountFilter` });
  });

  test('orders, the Still running preset', async ({ page }) => {
    await open(page, '#/orders?view=running', { list: EVERY_STATE });
    await expect(page.getByText('That’s every order for these filters.')).toBeVisible();
    await capture(page, { 1440: `${OR}OrdersStillRunning` });
  });

  test('orders, filters that match nothing', async ({ page }) => {
    await open(page, '#/orders?state=DELIVERED&placed_from=2026-09-01&placed_to=2026-09-02', { list: EMPTY });
    await expect(page.getByText('No orders match these filters')).toBeVisible();
    await capture(page, { 1440: `${OR}OrdersFilteredEmpty` });
  });

  test('orders, no order has the code', async ({ page }) => {
    await open(page, '#/orders?code=HG-8F3K2Q', { list: EMPTY });
    await expect(page.getByText('No order matches HG-8F3K2Q')).toBeVisible();
    await capture(page, { 1440: `${OR}OrdersNoMatch` });
  });

  test('orders, a code in the wrong shape', async ({ page }) => {
    await open(page, '#/orders', { list: EVERY_STATE });
    await expect(page.getByText('That’s every order for these filters.')).toBeVisible();
    await page.getByLabel('Order code').fill('HG-8F3K2I');
    await capture(page, { 1440: `${OR}OrdersCodeInvalid` });
  });

  test('orders, more are loading', async ({ page }) => {
    await open(page, '#/orders', {
      list: (route, cursor) => (cursor ? never() : serve(route, 'order_admin_list_disputed_page_1')),
    });
    await expect(page.getByText('More load as you scroll.')).toBeVisible();
    await scrollToEnd(page);
    await expect(page.getByText('Loading more…').first()).toBeVisible();
    await capture(page, { 1440: `${OR}OrdersLoadingMore` }, { idle: false });
  });

  test('orders, loading more failed', async ({ page }) => {
    await open(page, '#/orders', {
      list: (route, cursor) => (cursor ? serve(route, 'error_internal_error') : serve(route, 'order_admin_list_disputed_page_1')),
    });
    await expect(page.getByText('More load as you scroll.')).toBeVisible();
    await scrollToEnd(page);
    await expect(page.getByText(/More orders didn’t load/)).toBeVisible();
    await capture(page, { 1440: `${OR}OrdersLoadMoreFailed` });
  });

  test('orders, offline', async ({ page }) => {
    await open(page, '#/orders', { list: EVERY_STATE });
    await expect(page.getByText('That’s every order for these filters.')).toBeVisible();
    await page.context().setOffline(true);
    await expect(page.getByText('You’re offline.')).toBeVisible();
    await capture(page, { 1440: `${OR}OrdersOffline` });
  });

  test('orders, session ended, list kept', async ({ page }) => {
    let ended = false;
    await open(page, '#/orders', { list: (route) => (ended ? SESSION_ENDED(route) : serve(route, 'order_admin_list_every_state')) });
    await expect(page.getByText('That’s every order for these filters.')).toBeVisible();
    ended = true;
    await page.getByRole('button', { name: 'Refresh' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await capture(page, { 1440: `${OR}OrdersSessionEnded` });
  });

  test('orders, a deadline has passed and the server has not moved the order', async ({ page }) => {
    // Thirty seconds past the restaurant's deadline: the clock moves, the data does not.
    const ms = await msToDeadline(page, 'order_admin_list_every_state', 'RESTAURANT_PENDING');
    await open(page, '#/orders?view=running', { list: EVERY_STATE, clockShift: ms + 30_000 });
    await expect(page.getByText('That’s every order for these filters.')).toBeVisible();
    await capture(page, { 1440: `${OR}OrdersOverdue` });
  });

  test('orders, 180 s window critical, reduced motion', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    // Ten seconds before the restaurant's deadline, inside the last tenth of its window.
    const ms = await msToDeadline(page, 'order_admin_list_every_state', 'RESTAURANT_PENDING');
    await open(page, '#/orders?view=running', { list: EVERY_STATE, clockShift: ms - 10_000 });
    await expect(page.getByText('That’s every order for these filters.')).toBeVisible();
    await capture(page, { 1440: `${OR}OrdersCriticalReducedMotion` });
  });

  test('orders, skip link focused', async ({ page }) => {
    await open(page, '#/orders', { list: EVERY_STATE });
    await expect(page.getByText('That’s every order for these filters.')).toBeVisible();
    // The skip link is the first tab stop; focus it as the first Tab press does.
    await page.getByText('Skip to main content').focus();
    await expect(page.getByText('Skip to main content')).toBeFocused();
    await capture(page, { 1440: `${OR}OrdersSkipLink` });
  });

  test('orders, 200% text zoom has no single-page comparison', async ({ page }) => {
    await open(page, '#/orders', { list: EVERY_STATE });
    await expect(page.getByText('That’s every order for these filters.')).toBeVisible();
    await declareUnpairable(page, `${OR}OrdersZoom200`, 'drawn as the 720 px layout of a 200% zoom; the 1440 px capture is not that layout');
  });

  test.describe('at 1280 wide', () => {
    test.use({ viewport: { width: 1280, height: 900 } });
    test('orders, 1280 px', async ({ page }) => {
      await open(page, '#/orders', { list: EVERY_STATE });
      await expect(page.getByText('That’s every order for these filters.')).toBeVisible();
      await capture(page, { 1280: `${OR}OrdersGrid1280` });
    });
  });
});

test.describe('redesigned admin · disputes list (mock)', () => {
  test.use({ colorScheme: 'light' });

  test('disputes, none open', async ({ page }) => {
    await open(page, '#/disputes', { list: EMPTY });
    await expect(page.getByText('No open disputes')).toBeVisible();
    await capture(page, { 1440: `${OR}DisputesClear` });
  });

  test('disputes, the list does not load', async ({ page }) => {
    await open(page, '#/disputes', { list: FAILS });
    await expect(page.getByText('Disputes didn’t load')).toBeVisible();
    await capture(page, { 1440: `${OR}DisputesError` });
  });

  test('disputes, soonest deadline first', async ({ page }) => {
    await open(page, '#/disputes', { list: DISPUTED_PAGES });
    await expect(page.getByText(/That’s every open dispute/)).toBeVisible();
    await capture(page, { 1440: `${OR}DisputesOpen` });
  });

  test('disputes, end of the list', async ({ page }) => {
    await open(page, '#/disputes', { list: DISPUTED_PAGES });
    await expect(page.getByText(/That’s every open dispute/)).toBeVisible();
    await capture(page, { 1440: `${OR}DisputesEndOfList` });
  });

  test('disputes, as a support agent', async ({ page }) => {
    await open(page, '#/disputes', { role: 'SUPPORT_AGENT', list: DISPUTED_PAGES });
    await expect(page.getByText(/That’s every open dispute/)).toBeVisible();
    await capture(page, { 1440: `${OR}DisputesSupport` });
  });

  test('disputes, still loading', async ({ page }) => {
    await open(page, '#/disputes', { list: never });
    await expect(page.getByText('Loading disputes').first()).toBeVisible();
    await capture(page, { 1440: `${OR}DisputesLoading` }, { idle: false });
  });

  test('disputes, the rest are loading', async ({ page }) => {
    await open(page, '#/disputes', { list: (route, cursor) => (cursor ? never() : DISPUTED_FIRST_OF_TWO(route, cursor)) });
    await expect(page.getByText(/Loading the rest of the open disputes/)).toBeVisible();
    await capture(page, { 1440: `${OR}DisputesLoadingMore` }, { idle: false });
  });

  test('disputes, loading the rest failed', async ({ page }) => {
    await open(page, '#/disputes', { list: (route, cursor) => (cursor ? serve(route, 'error_internal_error') : DISPUTED_FIRST_OF_TWO(route, cursor)) });
    await expect(page.getByText(/aren’t in deadline order/)).toBeVisible();
    await capture(page, { 1440: `${OR}DisputesLoadMoreFailed` });
  });

  test('disputes, no dispute has the code', async ({ page }) => {
    await open(page, '#/disputes?code=HG-8F3K2Q', { list: EMPTY });
    await expect(page.getByText('No disputed order matches HG-8F3K2Q')).toBeVisible();
    await capture(page, { 1440: `${OR}DisputesNoMatch` });
  });

  test('disputes, a code in the wrong shape', async ({ page }) => {
    await open(page, '#/disputes', { list: DISPUTED_PAGES });
    await expect(page.getByText(/That’s every open dispute/)).toBeVisible();
    await page.getByLabel('Order code').fill('HG-8F3K2I');
    await capture(page, { 1440: `${OR}DisputesCodeInvalid` });
  });

  test('disputes, offline', async ({ page }) => {
    await open(page, '#/disputes', { list: DISPUTED_PAGES });
    await expect(page.getByText(/That’s every open dispute/)).toBeVisible();
    await page.context().setOffline(true);
    await expect(page.getByText('You’re offline.')).toBeVisible();
    await capture(page, { 1440: `${OR}DisputesOffline` });
  });

  test('disputes, session ended, list kept', async ({ page }) => {
    let ended = false;
    await open(page, '#/disputes', {
      list: (route, cursor) => (ended ? SESSION_ENDED(route) : DISPUTED_PAGES(route, cursor)),
    });
    await expect(page.getByText(/That’s every open dispute/)).toBeVisible();
    ended = true;
    await page.getByRole('button', { name: 'Refresh' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await capture(page, { 1440: `${OR}DisputesSessionEnded` });
  });
});

/** An order opened from the list, answered by the fixture `scenario`. */
async function openOrder(page: Page, scenario: string, setup: Omit<Setup, 'list' | 'order'> & { order?: Setup['order'] } = {}) {
  const id = await orderIdOf(page, scenario);
  await open(page, `#/orders/${id}`, { list: EVERY_STATE, order: fixture(scenario), ...setup });
}

/** `[board, fixture]` for each order state a fixture describes. */
const DETAIL: ReadonlyArray<readonly [string, string, string]> = [
  ['OrderDetailCreated', 'order_admin_view_created', 'created'],
  ['OrderDetailAuthorized', 'order_admin_view_authorized', 'authorised'],
  ['OrderDetailPending', 'order_admin_view_restaurant_pending', 'waiting for the restaurant'],
  ['OrderDetailPrepSearching', 'order_admin_view_preparing', 'preparing, searching for a rider'],
  ['OrderDetailReadyAssigned', 'order_admin_view_ready_for_pickup', 'ready, rider assigned'],
  ['OrderDetailPickedUp', 'order_admin_view_picked_up', 'picked up'],
  ['OrderDetailArrived', 'order_admin_view_arrived', 'rider arrived'],
  ['OrderDetailDeliveredPlain', 'order_admin_view_delivered', 'delivered, no refunds'],
  ['OrderDetailCompleted', 'order_admin_view_completed', 'completed'],
  ['CancelledByCustomer', 'order_admin_view_cancelled', 'cancelled by the customer'],
  ['OrderDetailRejected', 'order_admin_view_rejected', 'rejected by the restaurant'],
  ['OrderDetailDisputed', 'order_admin_view_disputed', 'disputed by the customer after completion'],
  ['OrderDetailResolved', 'order_admin_view_resolved', 'resolved by support'],
  ['OrderDetailChargeback', 'order_admin_view_chargeback', 'card chargeback'],
  ['OrderDetailResidual', 'order_admin_view_ledger_residual', 'ledger does not balance'],
  ['OrderDetailRevealed', 'order_admin_view_pii_revealed', 'delivery address revealed'],
  // The states #1006 added fixtures for (https://github.com/shaiknoorullah/hg-mono/issues/1006). Each is a
  // state the order machine can reach; the fixture names the transition that gets an order there.
  ['OrderDetailFailed', 'order_admin_view_failed', 'payment failed'],
  ['OrderDetailCancelled', 'order_admin_view_cancelled_after_acceptance', 'cancelled after acceptance, refunded in full'],
  ['CancelledNoRider', 'order_admin_view_cancelled_no_rider', 'cancelled by the system, no rider found'],
  ['CancelledPaymentExpired', 'order_admin_view_cancelled_payment_expired', 'cancelled by the system, payment not confirmed'],
  ['CancelledRestaurantClosed', 'order_admin_view_cancelled_restaurant_closed', 'cancelled by the system, restaurant closed'],
  ['CancelledTimeout', 'order_admin_view_cancelled_timeout', 'cancelled by the system, restaurant did not answer'],
  ['OrderDetailDelivered', 'order_admin_view_delivered_refund_failed', 'delivered, a refund failed, settlement held'],
  ['OrderDetailDeliveredSettled', 'order_admin_view_delivered_refund_settled', 'delivered, refund settled'],
  ['OrderDetailDisputedDelivered', 'order_admin_view_disputed_delivered', 'disputed after delivery, before settling'],
  ['OrderDetailDisputedMid', 'order_admin_view_disputed_mid_delivery', 'disputed by support mid-delivery'],
  ['OrderDetailDisputedRestaurant', 'order_admin_view_disputed_restaurant', 'disputed by the restaurant before pickup'],
  ['OrderDetailHalalConcern', 'order_admin_view_halal_concern_refund', 'halal concern refund requested'],
  ['OrderDetailRefundStates', 'order_admin_view_refund_states', 'refund rows in every state'],
  ['OrderDetailLedgerBatches', 'order_admin_view_ledger_batches', 'ledger batches'],
  ['OrderDetailNoRider', 'order_admin_view_ready_no_rider', 'ready, no rider found'],
  ['OrderDetailPrepPending', 'order_admin_view_preparing_dispatch_pending', 'preparing, dispatch about to search'],
  ['OrderDetailReadyAtRestaurant', 'order_admin_view_ready_at_restaurant', 'ready, rider at the restaurant'],
  ['OrderDetailReadyOffered', 'order_admin_view_ready_offered', 'ready, offered to a rider'],
  ['OrderDetailReadySearching', 'order_admin_view_ready_searching', 'ready, searching for a rider'],
  ['OrderDetailRearmed', 'order_admin_view_preparing_rearmed', 'preparing, deadline re-armed after an overrun'],
  ['OrderDetailUnassigned', 'order_admin_view_ready_unassigned', 'ready, the rider dropped it'],
  ['OrderDetailResolvedAuto', 'order_admin_view_resolved_auto', 'resolved automatically at the last deadline'],
];

test.describe('redesigned admin · order workspace (mock)', () => {
  test.use({ colorScheme: 'light' });

  for (const [board, scenario, label] of DETAIL) {
    test(`order, ${label}`, async ({ page }) => {
      await openOrder(page, scenario);
      await expect(page.locator('#order-heading')).toBeVisible();
      await capture(page, { 1440: `${OR}${board}` });
    });
  }

  test('order, as a support agent', async ({ page }) => {
    await openOrder(page, 'order_admin_view_preparing', { role: 'SUPPORT_AGENT' });
    await expect(page.locator('#order-heading')).toBeVisible();
    await capture(page, { 1440: `${OR}OrderDetailSupport` });
  });

  test('order, a disputed order as a support agent', async ({ page }) => {
    await openOrder(page, 'order_admin_view_disputed', { role: 'SUPPORT_AGENT' });
    await expect(page.locator('#order-heading')).toBeVisible();
    await capture(page, { 1440: `${OR}OrderDetailDisputedSupport` });
  });

  test('order, still loading', async ({ page }) => {
    await openOrder(page, 'order_admin_view_preparing', { order: never });
    await expect(page.getByText(/^Loading order/).first()).toBeVisible();
    await capture(page, { 1440: `${OR}OrderDetailLoading` }, { idle: false });
  });

  test('order, the order does not load', async ({ page }) => {
    await openOrder(page, 'order_admin_view_preparing', { order: fixture('error_internal_error') });
    await expect(page.getByText("This order didn't load")).toBeVisible();
    await capture(page, { 1440: `${OR}OrderDetailError` });
  });

  test('order, no order has the id', async ({ page }) => {
    await openOrder(page, 'order_admin_view_preparing', { order: fixture('error_not_found') });
    await expect(page.getByText('No order has this id')).toBeVisible();
    await capture(page, { 1440: `${OR}OrderDetailNotFound` });
  });

  test('order, offline', async ({ page }) => {
    await openOrder(page, 'order_admin_view_preparing');
    await expect(page.locator('#order-heading')).toBeVisible();
    await page.context().setOffline(true);
    await expect(page.getByText('You’re offline.')).toBeVisible();
    await capture(page, { 1440: `${OR}OrderDetailOffline` });
  });

  test('order, waiting for the restaurant with the window critical', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const ms = await orderMsToDeadline(page, 'order_admin_view_restaurant_pending');
    await openOrder(page, 'order_admin_view_restaurant_pending', { clockShift: ms - 10_000 });
    await expect(page.locator('#order-heading')).toBeVisible();
    await capture(page, { 1440: `${OR}OrderDetailPendingCritical` });
  });

  test('order, the window has passed and the server has not moved it', async ({ page }) => {
    const ms = await orderMsToDeadline(page, 'order_admin_view_restaurant_pending');
    await openOrder(page, 'order_admin_view_restaurant_pending', { clockShift: ms + 30_000 });
    await expect(page.locator('#order-heading')).toBeVisible();
    await capture(page, { 1440: `${OR}OrderDetailOverdue` });
  });

  test('order, 200% text zoom has no single-page comparison', async ({ page }) => {
    await openOrder(page, 'order_admin_view_preparing');
    await expect(page.locator('#order-heading')).toBeVisible();
    await declareUnpairable(page, `${OR}OrderDetailZoom200`, 'drawn as the 720 px layout of a 200% zoom; the 1440 px capture is not that layout');
  });

  test.describe('at 1280 wide', () => {
    test.use({ viewport: { width: 1280, height: 900 } });
    test('order, 1280 px', async ({ page }) => {
      await openOrder(page, 'order_admin_view_preparing');
      await expect(page.locator('#order-heading')).toBeVisible();
      await capture(page, { 1280: `${OR}OrderDetail1280` });
    });
  });
});

/** What the panel's form was filled with, as the board draws it. */
const DRAFT = {
  before: 'Customer called: ordered to the wrong address.',
  after: 'Kitchen confirmed by phone it can’t finish the order before 7:30 pm.',
};
const CASE_ID = '0192c3f0-7b1e-7c4a-9d2e-5f8a1b3c4d6e';

async function openCancel(page: Page, scenario: string, setup: Omit<Setup, 'list' | 'order'> = {}) {
  await openOrder(page, scenario, setup);
  await expect(page.locator('#order-heading')).toBeVisible();
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: /Cancel order/ }).click();
  await expect(page.getByText(/^Cancel order HG-/)).toBeVisible();
}

async function fillCancel(page: Page, reason: string, text: string, caseId: string) {
  await page.getByLabel('Reason').selectOption({ label: reason });
  await page.getByLabel('What happened').fill(text);
  if (caseId) await page.getByLabel('Case id').fill(caseId);
}

test.describe('redesigned admin · cancel and reveal panels (mock)', () => {
  test.use({ colorScheme: 'light' });

  test('cancel, created, nothing authorised', async ({ page }) => {
    await openCancel(page, 'order_admin_view_created');
    await capture(page, { 1440: `${OR}CancelCreated` });
  });

  test('cancel, payment authorised', async ({ page }) => {
    await openCancel(page, 'order_admin_view_authorized');
    await capture(page, { 1440: `${OR}CancelAuthorized` });
  });

  test('cancel before acceptance', async ({ page }) => {
    await openCancel(page, 'order_admin_view_restaurant_pending');
    await capture(page, { 1440: `${OR}CancelProposed` });
  });

  test('cancel before acceptance, as a support agent', async ({ page }) => {
    await openCancel(page, 'order_admin_view_restaurant_pending', { role: 'SUPPORT_AGENT' });
    await capture(page, { 1440: `${OR}CancelSupportBefore` });
  });

  test('cancel after acceptance', async ({ page }) => {
    await openCancel(page, 'order_admin_view_preparing');
    await capture(page, { 1440: `${OR}CancelAfterProposed` });
  });

  test('cancel after acceptance, as a support agent', async ({ page }) => {
    await openOrder(page, 'order_admin_view_preparing', { role: 'SUPPORT_AGENT' });
    await expect(page.locator('#order-heading')).toBeVisible();
    await page.getByRole('button', { name: 'More actions' }).click();
    await page.getByRole('menuitem', { name: /Cancel order/ }).click();
    await expect(page.getByText('Only an admin can cancel after the restaurant accepts').first()).toBeVisible();
    await capture(page, { 1440: `${OR}CancelSupportBlocked` });
  });

  test('cancel, sending', async ({ page }) => {
    await openCancel(page, 'order_admin_view_preparing', { cancel: never });
    await fillCancel(page, 'Cancelled by support', DRAFT.after, CASE_ID);
    await page.getByRole('button', { name: 'Cancel order', exact: true }).click();
    await capture(page, { 1440: `${OR}CancelSubmitting` }, { idle: false });
  });

  test('cancel, the food was marked ready first', async ({ page }) => {
    await openCancel(page, 'order_admin_view_preparing', { cancel: fixture('error_order_admin_cancel_illegal_transition') });
    await fillCancel(page, 'Cancelled by support', DRAFT.after, CASE_ID);
    await page.getByRole('button', { name: 'Cancel order', exact: true }).click();
    await expect(page.getByText('The order moved while you were cancelling')).toBeVisible();
    await capture(page, { 1440: `${OR}CancelConflict` });
  });

  test('cancel, too many requests', async ({ page }) => {
    await openCancel(page, 'order_admin_view_preparing', { cancel: fixture('error_order_admin_cancel_rate_limited') });
    await fillCancel(page, 'Cancelled by support', DRAFT.after, CASE_ID);
    await page.getByRole('button', { name: 'Cancel order', exact: true }).click();
    await expect(page.getByText('Too many requests in a short time')).toBeVisible();
    await capture(page, { 1440: `${OR}CancelRateLimited` });
  });

  test('cancel, fields need fixing', async ({ page }) => {
    await openCancel(page, 'order_admin_view_preparing');
    await fillCancel(page, 'Cancelled by support', 'Late', '');
    await page.getByRole('button', { name: 'Cancel order', exact: true }).click();
    await capture(page, { 1440: `${OR}CancelFieldErrors` });
  });

  test('cancel, no answer', async ({ page }) => {
    await openCancel(page, 'order_admin_view_preparing', { cancel: (route) => route.abort('timedout') });
    await fillCancel(page, 'Cancelled by support', DRAFT.after, CASE_ID);
    await page.getByRole('button', { name: 'Cancel order', exact: true }).click();
    await expect(page.getByText('We can’t tell yet whether the order was cancelled')).toBeVisible();
    await capture(page, { 1440: `${OR}CancelTimeout` });
  });

  test('cancel, session ended, draft kept', async ({ page }) => {
    await openCancel(page, 'order_admin_view_preparing', { cancel: fixture('error_session_expired') });
    await fillCancel(page, 'Cancelled by support', DRAFT.after, CASE_ID);
    await page.getByRole('button', { name: 'Cancel order', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await capture(page, { 1440: `${OR}ReauthKeepsDraft` });
  });

  // What `cancelOrderAdmin` answers with: the page draws the order the server returned, with the result above it.
  const CANCEL_RESULTS: ReadonlyArray<{ board: string; before: string; result: string; reason: string; text: string; role?: StaffRole; label: string }> = [
    {
      board: 'CancelResultVoid',
      before: 'order_admin_view_restaurant_pending',
      result: 'order_admin_view_cancel_result_void',
      reason: 'Customer asked to cancel',
      text: DRAFT.before,
      label: 'an admin cancels before acceptance, authorisation voided',
    },
    {
      board: 'CancelResultVoidSupport',
      before: 'order_admin_view_restaurant_pending',
      result: 'order_admin_view_cancel_result_void_support',
      reason: 'Customer asked to cancel',
      text: DRAFT.before,
      role: 'SUPPORT_AGENT',
      label: 'a support agent cancels before acceptance, authorisation voided',
    },
    {
      board: 'CancelResultRefund',
      before: 'order_admin_view_preparing',
      result: 'order_admin_view_cancel_result_refund',
      reason: 'Cancelled by support',
      text: DRAFT.after,
      label: 'an admin cancels after acceptance, refund issued',
    },
  ];

  for (const { board, before, result, reason, text, role, label } of CANCEL_RESULTS) {
    test(`cancel result, ${label}`, async ({ page }) => {
      await openCancel(page, before, { cancel: fixture(result), ...(role ? { role } : {}) });
      await fillCancel(page, reason, text, CASE_ID);
      await page.getByRole('button', { name: 'Cancel order', exact: true }).click();
      await expect(page.getByText(/^Cancelled\. (Refund issued|Authorisation voided)\.$/)).toBeVisible();
      await capture(page, { 1440: `${OR}${board}` });
    });
  }

  test('reveal, the justification panel', async ({ page }) => {
    await openOrder(page, 'order_admin_view_preparing');
    await page.getByRole('button', { name: /Reveal address/ }).click();
    await page.getByLabel('Why do you need it?').fill('Rider can’t find the building. Customer called support.');
    await capture(page, { 1440: `${OR}RevealPii` });
  });

  for (const [board, label, answer, expectText, reason] of [
    ['RevealLoading', 'loading', never, 'Loading the order again with the address.', 'Rider can’t find the building. Customer called support.'],
    ['RevealFailed', 'failed', (route: Route) => route.abort('timedout'), "The address didn't load", 'Rider can’t find the building. Customer called support.'],
    ['RevealRateLimited', 'too many requests', fixture('error_order_admin_cancel_rate_limited'), 'Too many requests in a short time', 'Rider can’t find the building. Customer called support.'],
    ['RevealTooShort', 'reason too short', fixture('error_validation_failed'), 'Write at least', 'Lost'],
  ] as const) {
    test(`reveal, ${label}`, async ({ page }) => {
      await openOrder(page, 'order_admin_view_preparing', {
        order: (route, revealed) => (revealed ? answer(route) : serve(route, 'order_admin_view_preparing')),
      });
      await page.getByRole('button', { name: /Reveal address/ }).click();
      await page.getByLabel('Why do you need it?').fill(reason);
      await page.getByRole('button', { name: 'Reveal address', exact: true }).click();
      await expect(page.getByText(expectText).first()).toBeVisible();
      await capture(page, { 1440: `${OR}${board}` }, { idle: board !== 'RevealLoading' });
    });
  }
});

/**
 * Live alerts takes its states from the realtime socket. The mock plays a realtime fixture over
 * the socket when the ticket's `websocket_url` names it (`?scenario=`), so a state is driven by a
 * fixture here too: a socket that plays nothing, one that plays the alerts script, one that is
 * closed after the alerts arrive, and a ticket that is never answered.
 */
async function openAlerts(page: Page, role: StaffRole, opts: { script?: string; ticket?: (route: Route) => Promise<void>; drop?: boolean } = {}) {
  if (opts.ticket) await page.route('**/v1/realtime/ticket', opts.ticket);
  let sockets = 0;
  // The page's socket is bridged to the mock's, with the fixture named on the address.
  await page.routeWebSocket(/\/v1\/ws/, (ws) => {
    sockets += 1;
    // A dropped connection stays down: the first socket is closed once the script has played.
    if (opts.drop && sockets > 1) return void ws.close();
    const address = new URL(ws.url());
    if (opts.script) address.searchParams.set('scenario', opts.script);
    const server = new WebSocket(address.toString());
    const waiting: (string | Buffer)[] = [];
    ws.onMessage((message) => (server.readyState === WebSocket.OPEN ? server.send(message) : waiting.push(message)));
    server.onopen = () => waiting.splice(0).forEach((m) => server.send(m));
    server.onmessage = (event) => ws.send(typeof event.data === 'string' ? event.data : Buffer.from(event.data as ArrayBuffer));
    server.onclose = () => ws.close();
    if (opts.drop) setTimeout(() => ws.close(), 6000);
  });
  await open(page, '#/alerts', { role });
}

test.describe('redesigned admin · live alerts (mock)', () => {
  test.use({ colorScheme: 'light' });

  test('live alerts, none yet', async ({ page }) => {
    await openAlerts(page, 'ADMIN');
    await expect(page.getByText('No recent alerts')).toBeVisible();
    await capture(page, { 1440: `${OR}LiveAlertsEmpty` });
  });

  test('live alerts, connecting for the first time', async ({ page }) => {
    await openAlerts(page, 'ADMIN', { ticket: never });
    await expect(page.getByText('Opening the live connection.').first()).toBeVisible();
    await capture(page, { 1440: `${OR}LiveAlertsConnecting` }, { idle: false });
  });

  test('live alerts, as a support agent', async ({ page }) => {
    await openAlerts(page, 'SUPPORT_AGENT', { script: 'realtime_admin_ops_alerts' });
    await expect(page.getByText(/A chargeback was opened/)).toBeVisible();
    await capture(page, { 1440: `${OR}LiveAlertsSupport` });
  });

  test('live alerts, the connection dropped', async ({ page }) => {
    await openAlerts(page, 'ADMIN', { script: 'realtime_admin_ops_alerts', drop: true });
    await expect(page.getByText(/A chargeback was opened/)).toBeVisible();
    await expect(page.getByText('Reconnecting').first()).toBeVisible({ timeout: 40_000 });
    await capture(page, { 1440: `${OR}LiveAlertsReconnecting` });
  });

  test('live alerts, a critical alert arrives while focus is in the table', async ({ page }) => {
    await openAlerts(page, 'ADMIN', { script: 'realtime_admin_ops_all' });
    await expect(page.getByText(/webhook was refused/).first()).toBeVisible();
    // Held while the pointer or focus is in the list: rest the pointer on it.
    await page.mouse.move(760, 520);
    await expect(page.getByText(/new alerts? (is|are) waiting|new alerts?\./).first()).toBeVisible({ timeout: 30_000 });
    await capture(page, { 1440: `${OR}LiveAlertsArriving` });
  });
});
