import { expect, test, type Page, type Route } from '@playwright/test';

import { declareUnpairable, expectDesignFor, type BoardFor } from './design';
import { MODE, openSignedIn, scenarioPayload, torontoDateIn } from './redesign-restaurant.support';

test.skip(MODE !== 'mock', 'written against the mock server; run with E2E_MODE=mock');

/**
 * The redesigned restaurant console's Past orders page (`/orders/history`): the list with its
 * status chips and load more, every list state, and a past order open beside it. Each state is
 * captured for the design board it must match (tools/e2e/README.md, "Design captures"); the boards
 * are in the Live orders canvas and are drawn at 1440 wide.
 *
 * Mock mode: the list is answered with `page.route` the way a correct server answers it (the
 * `state` filter and the cursor applied), built from the mock's own restaurant order fixtures
 * (`restaurant_order_completed`, `_delivered`, `_resolved`, `_rejected`, `_cancelled`,
 * `_cancelled_after_accept`, `_disputed`) and patched to the codes, customers and times the
 * boards draw.
 *
 * Covered: all 13 History boards. Two are composite sheets of three boards drawn side by side
 * (`History-detail-cancelled-sheet`, `History-detail-other-sheet`): their states are visited and
 * asserted here, and one screenshot is declared unpairable with the reason.
 *
 * Approximated, because the contract carries no reason to draw (the pull request lists each):
 *   - `History-halal-upheld` and `History-halal-goodwill`: the order view has no refund reason, so
 *     both open as an ordinary resolved order ("Resolved", not "Resolved: halal concern").
 *   - `History-detail-other-sheet`: "timed out" and "withdrawn" cancelled orders read the same.
 *
 * Board ids are written out in full on purpose: tools/e2e/web/check-boards.mjs validates only
 * literal ids.
 */

const LIST = /\/v1\/restaurant\/orders\?/;
const ORDER = /\/v1\/restaurant\/orders\/[0-9a-f-]{36}$/;
const never = () => new Promise<void>(() => undefined);
const failing = (route: Route) =>
  route.fulfill({ status: 500, json: { error: { code: 'INTERNAL_ERROR', message: 'boom', request_id: 'req_e2e' } } });

type Order = Record<string, any> & { id: string; code: string; state: string };

/** The wall-clock time `h:m` on the restaurant's day `days` from today, as an ISO instant. */
function torontoAt(days: number, h: number, m: number): string {
  const [y, mo, d] = torontoDateIn(days).split('-').map(Number) as [number, number, number];
  let t = Date.UTC(y, mo - 1, d, h, m);
  const shown = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Toronto', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(t));
  const [sh, sm] = shown.split(':').map(Number) as [number, number];
  t += ((((h * 60 + m - (sh * 60 + sm) + 720) % 1440) + 1440) % 1440 - 720) * 60_000;
  return new Date(t).toISOString();
}

interface Spec {
  base: string;
  code: string;
  customer: string;
  /** Day offset and wall clock the order was placed at. */
  at: [number, number, number];
  items: number;
  /** Minutes taken and minutes promised, or null when it was never prepared. */
  prep: [number, number] | null;
  cents: number;
  accepted: boolean;
  state?: string;
}

/** The rows the History board draws, by the order it lists them. */
const ROWS: Spec[] = [
  { base: 'delivered', code: 'K7C3', customer: 'Omar S.', at: [0, 18, 4], items: 1, prep: [15, 20], cents: 1850, accepted: true },
  { base: 'completed', code: 'K7B1', customer: 'Noor T.', at: [0, 18, 2], items: 1, prep: [16, 20], cents: 1749, accepted: true },
  { base: 'completed', code: 'K79Z', customer: 'Imran D.', at: [0, 17, 48], items: 4, prep: [24, 20], cents: 4120, accepted: true },
  { base: 'rejected', code: 'K79Q', customer: 'Ruqayya S.', at: [0, 17, 31], items: 2, prep: null, cents: 4998, accepted: false },
  { base: 'cancelled_after_accept', code: 'K78T', customer: 'Adam B.', at: [0, 17, 12], items: 3, prep: null, cents: 3897, accepted: true },
  { base: 'cancelled', code: 'K78C', customer: 'Hiba W.', at: [0, 17, 5], items: 3, prep: null, cents: 3897, accepted: false },
  { base: 'completed', code: 'K78M', customer: 'Leila F.', at: [0, 16, 55], items: 2, prep: [18, 20], cents: 2875, accepted: true },
  { base: 'disputed', code: 'K77X', customer: 'Yasin H.', at: [0, 16, 20], items: 2, prep: [21, 25], cents: 3310, accepted: true },
  { base: 'resolved', code: 'K76W', customer: 'Khalid A.', at: [0, 15, 2], items: 1, prep: [18, 20], cents: 2450, accepted: true },
  { base: 'resolved', code: 'K76A', customer: 'Salma N.', at: [-1, 21, 38], items: 2, prep: [19, 20], cents: 2250, accepted: true },
  { base: 'completed', code: 'K75R', customer: 'Hamza J.', at: [-1, 21, 5], items: 5, prep: [31, 25], cents: 5340, accepted: true },
  { base: 'cancelled', code: 'K75P', customer: 'Musa K.', at: [-1, 20, 50], items: 2, prep: null, cents: 3498, accepted: false },
  { base: 'completed', code: 'K75K', customer: 'Amina P.', at: [-1, 20, 41], items: 2, prep: [14, 15], cents: 2640, accepted: true },
  { base: 'completed', code: 'K74V', customer: 'Tariq M.', at: [-1, 20, 12], items: 3, prep: [22, 20], cents: 3185, accepted: true },
];

/** The two resolved orders the halal boards open (same state, same words: see the header). */
const HALAL: Spec[] = [
  { base: 'resolved', code: 'K74H', customer: 'Rahim D.', at: [-1, 19, 30], items: 1, prep: [18, 20], cents: 2450, accepted: true },
  { base: 'resolved', code: 'K74G', customer: 'Huda M.', at: [-1, 19, 12], items: 1, prep: [17, 20], cents: 1850, accepted: true },
];

async function build(page: Page, specs: Spec[]): Promise<Order[]> {
  const bases = new Map<string, Order>();
  for (const name of new Set(specs.map((s) => s.base))) bases.set(name, await scenarioPayload<Order>(page, `restaurant_order_${name}`));
  return specs.map((s, i) => {
    const o = structuredClone(bases.get(s.base)!);
    const placed = torontoAt(...s.at);
    const placedMs = Date.parse(placed);
    const lines = Array.from({ length: s.items }, (_, n) => ({ ...o.lines[0], line_no: n + 1, quantity: 1 }));
    return {
      ...o,
      id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
      code: s.code,
      customer: { ...o.customer, display_name: s.customer },
      placed_at: placed,
      accepted_at: s.accepted ? new Date(placedMs + 60_000).toISOString() : null,
      ready_at: s.prep ? new Date(placedMs + 60_000 + s.prep[0] * 60_000).toISOString() : null,
      promised_ready_at: s.prep ? new Date(placedMs + 60_000 + s.prep[1] * 60_000).toISOString() : null,
      is_late: false,
      delivery_address: s.accepted ? o.delivery_address : null,
      lines,
      money: { ...o.money, restaurant_net_cents: s.cents },
    } as Order;
  });
}

interface Scene {
  /** The first page; a promise that never settles, or an error. */
  rows?: Order[] | 'error' | 'never';
  /** How the page behind `next_cursor` goes. */
  older?: 'none' | 'ok' | 'error' | 'never';
  olderRows?: Order[];
}

/** Routes the list the way a correct server answers it (state filter, cursor), then opens `path`. */
async function open(page: Page, path: string, { rows = [], older = 'none', olderRows = [] }: Scene = {}) {
  const all = Array.isArray(rows) ? rows : [];
  const byId = new Map([...all, ...olderRows].map((o) => [o.id, o]));
  await page.route(LIST, async (route) => {
    const url = new URL(route.request().url());
    const wanted = (url.searchParams.get('state') ?? '').split(',').filter(Boolean);
    // The strip's pending-list read shares this route: nothing is waiting here.
    if (wanted.includes('RESTAURANT_PENDING')) return route.fulfill({ json: { data: [], meta: { next_cursor: null, has_more: false } } });
    const keep = (list: Order[]) => list.filter((o) => wanted.length === 0 || wanted.includes(o.state));
    if (url.searchParams.get('cursor')) {
      if (older === 'error') return failing(route);
      if (older === 'never') return never();
      return route.fulfill({ json: { data: keep(olderRows), meta: { next_cursor: null, has_more: false } } });
    }
    if (rows === 'error') return failing(route);
    if (rows === 'never') return never();
    const more = older !== 'none';
    return route.fulfill({ json: { data: keep(all), meta: { next_cursor: more ? 'older' : null, has_more: more } } });
  });
  await page.route(ORDER, (route) => {
    const o = byId.get(new URL(route.request().url()).pathname.split('/').pop()!);
    return o ? route.fulfill({ json: { data: o } }) : route.fulfill({ status: 404, json: { error: { code: 'NOT_FOUND', message: 'Not found', request_id: 'req_e2e' } } });
  });
  await openSignedIn(page, path);
}

async function capture(page: Page, board: BoardFor, { settled = true } = {}) {
  // A call that never answers keeps the network busy for good: the loading state is captured as it is.
  if (settled) await page.waitForLoadState('networkidle');
  await expect(page.getByText('Not built yet')).toHaveCount(0);
  await expectDesignFor(page, board);
}

const byCode = (rows: Order[], code: string) => rows.find((o) => o.code === code)!;

test.describe('redesigned restaurant · past orders list (mock)', () => {
  test.use({ colorScheme: 'light' });

  test('every status, with older orders to load', async ({ page }) => {
    await open(page, '/orders/history', { rows: await build(page, ROWS), older: 'ok', olderRows: await build(page, [ROWS[2]!]) });
    await expect(page.getByRole('button', { name: 'Load more' })).toBeVisible();
    await capture(page, { 1440: 'restaurant/live-orders/History' });
  });

  test('loading', async ({ page }) => {
    await open(page, '/orders/history', { rows: 'never' });
    await expect(page.getByTestId('past-orders')).toHaveAttribute('data-state', 'loading');
    await capture(page, { 1440: 'restaurant/live-orders/History-loading' }, { settled: false });
  });

  test('first run, nothing yet', async ({ page }) => {
    await open(page, '/orders/history', { rows: [] });
    await expect(page.getByTestId('past-orders-empty')).toBeVisible();
    await capture(page, { 1440: 'restaurant/live-orders/History-empty' });
  });

  test('the list does not load', async ({ page }) => {
    await open(page, '/orders/history', { rows: 'error' });
    await expect(page.getByText(/We couldn’t load past orders/)).toBeVisible();
    await capture(page, { 1440: 'restaurant/live-orders/History-error' });
  });

  test('a status is reloading', async ({ page }) => {
    await open(page, '/orders/history?status=CANCELLED', { rows: 'never' });
    await expect(page.getByRole('button', { name: 'Cancelled' })).toHaveAttribute('aria-pressed', 'true');
    await capture(page, { 1440: 'restaurant/live-orders/History-filter-loading' }, { settled: false });
  });

  test('no order has the chosen status', async ({ page }) => {
    await open(page, '/orders/history?status=RESOLVED', { rows: [] });
    await expect(page.getByText('No resolved orders')).toBeVisible();
    await capture(page, { 1440: 'restaurant/live-orders/History-filtered-empty' });
  });

  test('loading older orders', async ({ page }) => {
    await open(page, '/orders/history', { rows: await build(page, ROWS), older: 'never' });
    await page.getByRole('button', { name: 'Load more' }).click();
    await capture(page, { 1440: 'restaurant/live-orders/History-loading-more' }, { settled: false });
  });

  test('older orders do not load', async ({ page }) => {
    await open(page, '/orders/history', { rows: await build(page, ROWS), older: 'error' });
    await page.getByRole('button', { name: 'Load more' }).click();
    await expect(page.getByText('We couldn’t load older orders. The ones above are up to date.')).toBeVisible();
    await capture(page, { 1440: 'restaurant/live-orders/History-load-more-failed' });
  });
});

test.describe('redesigned restaurant · a past order open (mock)', () => {
  test.use({ colorScheme: 'light' });

  /** The list with one order open beside it, under the chip that order sits in. */
  async function openOrder(page: Page, code: string, status: string | null, scene: Partial<Scene> = {}) {
    const rows = await build(page, [...ROWS, ...HALAL]);
    const id = byCode(rows, code).id;
    await open(page, `/orders/history?${status ? `status=${status}&` : ''}order=${id}`, { rows, ...scene });
    await expect(page.getByTestId('history-detail')).toBeVisible();
    await expect(page.getByTestId('history-detail').getByRole('heading', { name: code })).toBeVisible();
    return rows;
  }

  test('delivered, payment settling', async ({ page }) => {
    await openOrder(page, 'K7C3', 'DELIVERED');
    await expect(page.getByText('Delivered · payment settling')).toBeVisible();
    await capture(page, { 1440: 'restaurant/live-orders/History-delivered' });
  });

  test('resolved: a halal concern with a goodwill refund is drawn as an ordinary resolved order', async ({ page }) => {
    // The order view carries no refund reason, so goodwill and upheld cannot be told apart from a
    // plain resolved order (the pull request lists the gap). Both boards are declared against it.
    await openOrder(page, 'K74G', 'RESOLVED');
    await expect(page.getByText('Support closed the customer’s report')).toBeVisible();
    await capture(page, { 1440: 'restaurant/live-orders/History-halal-goodwill' });
  });

  test('resolved: a halal concern upheld is drawn the same way', async ({ page }) => {
    await openOrder(page, 'K74H', 'RESOLVED');
    await expect(page.getByText('Support closed the customer’s report')).toBeVisible();
    await capture(page, { 1440: 'restaurant/live-orders/History-halal-upheld' });
  });

  test('cancelled after accept, payment failed, delivery problem resolved (one sheet of three boards)', async ({ page }) => {
    await openOrder(page, 'K78T', 'CANCELLED');
    await expect(page.getByText('Cancelled after you accepted')).toBeVisible();
    await expect(page.getByText('You didn’t need to hand anything over.')).toBeVisible();
    await expect(page.getByTestId('history-detail').getByText('Payout open')).toBeVisible();
    await declareUnpairable(
      page,
      'restaurant/live-orders/History-detail-cancelled-sheet',
      'A sheet of three boards side by side (4480 px wide), one screenshot of one state cannot match it',
    );
  });

  test('payment failed at accept: cancelled before it was accepted', async ({ page }) => {
    await openOrder(page, 'K78C', 'CANCELLED');
    await expect(page.getByText('Cancelled before it was accepted')).toBeVisible();
    await expect(page.getByText('Nothing was prepared. The customer was not charged.')).toBeVisible();
    await expect(page.getByTestId('not-charged')).toContainText('Not charged');
  });

  test('delivery problem resolved', async ({ page }) => {
    await openOrder(page, 'K76W', 'RESOLVED');
    await expect(page.getByTestId('history-badge')).toContainText('Resolved');
    await expect(page.getByText('The outcome and any change to your payout come from support.')).toBeVisible();
  });

  test('resolved, timed out, withdrawn (one sheet of three boards)', async ({ page }) => {
    await openOrder(page, 'K76A', 'RESOLVED');
    await expect(page.getByText('Support closed the customer’s report')).toBeVisible();
    await declareUnpairable(
      page,
      'restaurant/live-orders/History-detail-other-sheet',
      'A sheet of three boards side by side (4480 px wide), one screenshot of one state cannot match it',
    );
  });

  test('a declined order, not charged', async ({ page }) => {
    await openOrder(page, 'K79Q', null);
    await expect(page.getByTestId('history-note')).toHaveText('Declined');
    await expect(page.getByTestId('not-charged')).toContainText('Not charged');
    await expect(page.getByText('The customer was not charged. This order stays in History.')).toBeVisible();
  });

  test('a disputed order, payout open', async ({ page }) => {
    await openOrder(page, 'K77X', 'DISPUTED');
    await expect(page.getByText('The customer reported a problem')).toBeVisible();
    await expect(page.getByText('Open issue. It moves to Resolved when support closes it.')).toBeVisible();
  });
});
