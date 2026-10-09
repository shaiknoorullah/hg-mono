/**
 * Restaurant redesign WP4: the Live orders board (In progress list, order detail panel, Mark
 * ready, pickup code hand-off), the status bar (open state, Orders switch, Pause) and the
 * halal banners. Desktop 1440×900 and tablet 1024×768 (the `redesign` projects).
 *
 * Mock mode: the app talks to `pnpm mock` (:4010). Where a state needs data the stateless
 * mock cannot give, `page.route` answers instead and names the fixture it stands in for;
 * realtime events go through `page.routeWebSocket` (the mock's scripts target another
 * restaurant's channels).
 */
import { expect, test, type Page, type Route } from '@playwright/test';
import { MOCK_API, MODE, documentScrolls, openSignedIn } from './redesign-restaurant.support';

test.skip(MODE !== 'mock', 'WP4 board states are driven from fixtures in mock mode');

const SHOTS = process.env.WP4_SHOTS_DIR;

async function payload(page: Page, scenario: string) {
  const r = await page.request.get(`${MOCK_API}/__mock/scenarios/${scenario}`);
  return (await r.json()).data.payload;
}

async function shot(page: Page, name: string) {
  const vp = page.viewportSize()!.width >= 1280 ? 'desktop' : 'tablet';
  await page.screenshot({ path: test.info().outputPath(`${vp}-${name}.png`) });
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${vp}-${name}.png` });
}

async function expectNoDocumentScroll(page: Page) {
  const d = await documentScrolls(page);
  expect(d.scrollHeight).toBeLessThanOrEqual(d.innerHeight);
  expect(d.scrollWidth).toBeLessThanOrEqual(d.innerWidth);
}

/** Times relative to now, so lateness and "Ready by" read like a live kitchen. */
function minutesFromNow(m: number) {
  return new Date(Date.now() + m * 60_000).toISOString();
}

interface Board {
  preparing: any;
  late: any;
  ready: any;
  out: any;
  completed: any;
  delivered: any;
}

/**
 * A busy board built from the contract fixtures (restaurant_order_preparing, _ready_for_pickup,
 * _picked_up) plus a COMPLETED and a DELIVERED row (fixtures requested in #676) that the #601
 * guard must drop.
 */
async function busyBoard(page: Page): Promise<Board> {
  const prep = await payload(page, 'restaurant_order_preparing');
  const ready = await payload(page, 'restaurant_order_ready_for_pickup');
  const out = await payload(page, 'restaurant_order_picked_up');
  return {
    preparing: { ...prep, id: '11111111-1111-4111-8111-111111111111', code: 'K7L8', is_late: false, promised_ready_at: minutesFromNow(12), special_instructions: null },
    late: { ...prep, id: '22222222-2222-4222-8222-222222222222', code: 'K7M4', is_late: true, promised_ready_at: minutesFromNow(-4) },
    ready: { ...ready, id: '33333333-3333-4333-8333-333333333333', code: 'K7J1', ready_at: minutesFromNow(-3) },
    out: { ...out, id: '44444444-4444-4444-8444-444444444444', code: 'K7G5', ready_at: minutesFromNow(-20) },
    completed: { ...out, id: '55555555-5555-4555-8555-555555555555', code: 'DONE1', state: 'COMPLETED' },
    delivered: { ...out, id: '66666666-6666-4666-8666-666666666666', code: 'DONE2', state: 'DELIVERED' },
  };
}

async function routeBoard(page: Page, board: Board, overrides: Record<string, any> = {}) {
  const rows = [board.completed, board.preparing, board.out, board.late, board.delivered, board.ready];
  const byId = new Map(rows.map((o) => [o.id, { ...o, ...(overrides[o.id] ?? {}) }]));
  const listUrls: string[] = [];
  await page.route('**/v1/restaurant/orders?**', (route) => {
    listUrls.push(route.request().url());
    return route.fulfill({ json: { data: [...byId.values()], meta: { next_cursor: null, has_more: false } } });
  });
  await page.route(/\/v1\/restaurant\/orders\/[0-9a-f-]{36}$/, (route) => {
    const id = new URL(route.request().url()).pathname.split('/').pop()!;
    const o = byId.get(id);
    return o ? route.fulfill({ json: { data: o } }) : route.fulfill({ status: 404, json: { error: { code: 'NOT_FOUND', message: 'Not found', request_id: 'e2e' } } });
  });
  return { listUrls };
}

/** Realtime: answers the socket in the page and lets the test push events onto a channel. */
async function fakeSocket(page: Page) {
  let send: ((frame: object) => void) | null = null;
  let seq = 0;
  await page.routeWebSocket(/\/v1\/ws/, (ws) => {
    send = (frame) => ws.send(JSON.stringify(frame));
    ws.onMessage(() => {
      /* subscribe / resume / pong: nothing to answer */
    });
  });
  return {
    push: async (channel: string, type: string, data: object) => {
      await expect.poll(() => send !== null).toBe(true);
      seq += 1;
      send!({ v: 1, id: `e2e-${seq}`, seq, channel, type, ts: new Date().toISOString(), data });
    },
  };
}

test.describe('Live orders: In progress list', () => {
  test('busy board: guarded, sorted, counted; never scrolls the page', async ({ page }) => {
    const board = await busyBoard(page);
    const { listUrls } = await routeBoard(page, board);
    await openSignedIn(page, '/orders');

    const list = page.getByRole('region', { name: 'In progress' });
    await expect(list.getByRole('button', { name: 'K7J1', exact: true })).toBeVisible();
    // #601: the filter is always sent…
    expect(decodeURIComponent(listUrls[0]!)).toContain('state=PREPARING,READY_FOR_PICKUP,PICKED_UP,ARRIVED,DISPUTED');
    // …and the rows the server should not have sent are dropped.
    await expect(list.getByText('DONE1')).toHaveCount(0);
    await expect(list.getByText('DONE2')).toHaveCount(0);
    await expect(page.getByTestId('in-progress-counts')).toHaveText('Preparing 2 · Ready 1 · Out for delivery 1');

    // Ready first, then soonest ready time; out for delivery after the kitchen.
    const codes = await list.locator('[data-order-open]').allTextContents();
    expect(codes).toEqual(['K7J1', 'K7M4', 'K7L8', 'K7G5']);
    await expect(list.getByText('Out for delivery', { exact: true })).toBeVisible();

    // Status bar: open state from the server; no "Pause until closing" before #312.
    const bar = page.getByRole('region', { name: 'Service status' });
    await expect(bar.getByTestId('open-state-badge')).toHaveText('Open');
    await expect(bar.getByRole('switch', { name: 'Orders' })).toBeChecked();
    await bar.getByRole('button', { name: 'Pause' }).click();
    const menu = page.getByRole('menu', { name: 'Pause new orders' });
    await expect(menu.getByRole('menuitem')).toHaveText(['Pause for 15 minutes', 'Pause for 30 minutes', 'Pause for 1 hour']);
    await page.keyboard.press('Escape');

    await expectNoDocumentScroll(page);
    await shot(page, 'busy');
  });

  test('empty board says so', async ({ page }) => {
    await page.route('**/v1/restaurant/orders?**', (route) => route.fulfill({ json: { data: [], meta: { next_cursor: null, has_more: false } } }));
    await openSignedIn(page, '/orders');
    await expect(page.getByText('Nothing in progress')).toBeVisible();
    await expect(page.getByText('Orders you accept appear here, soonest ready time first. Ready orders stay until the rider picks them up.')).toBeVisible();
    await expectNoDocumentScroll(page);
    await shot(page, 'empty');
  });

  test('first load failure offers Try again and recovers', async ({ page }) => {
    let fail = true;
    await page.route('**/v1/restaurant/orders?**', (route) =>
      fail
        ? route.fulfill({ status: 500, json: { error: { code: 'INTERNAL_ERROR', message: 'boom', request_id: 'e2e' } } })
        : route.fulfill({ json: { data: [], meta: { next_cursor: null, has_more: false } } }),
    );
    await openSignedIn(page, '/orders');
    await expect(page.getByRole('heading', { name: 'We couldn’t load your orders' })).toBeVisible();
    await expectNoDocumentScroll(page);
    await shot(page, 'first-load-error');
    fail = false;
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByText('Nothing in progress')).toBeVisible();
  });
});

test.describe('Live orders: detail panel and Mark ready', () => {
  test('opens a preparing order, focuses its heading, Escape returns to the row', async ({ page }) => {
    const board = await busyBoard(page);
    await routeBoard(page, board);
    await openSignedIn(page, '/orders');
    const list = page.getByRole('region', { name: 'In progress' });
    await list.getByRole('button', { name: 'K7M4', exact: true }).click();

    const panel = page.getByRole('complementary', { name: 'Order K7M4 details' });
    await expect(panel.getByRole('heading', { name: 'K7M4' })).toBeFocused();
    await expect(panel.getByTestId('detail-badge')).toHaveText('Preparing · late');
    await expect(panel.getByText('You earn')).toBeVisible();
    const markReady = panel.getByRole('button', { name: 'Mark order K7M4 ready' });
    // Forest (DS secondary), never the orange primary.
    await expect(markReady).toHaveAttribute('data-variant', 'secondary');
    await expect(panel.getByText('Running late, or can’t finish this order?')).toBeVisible();
    await expect(list.getByText('Open', { exact: true })).toBeVisible();
    await expectNoDocumentScroll(page);
    await shot(page, 'detail-preparing');

    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);
    await expect(list.getByRole('button', { name: 'K7M4', exact: true })).toBeFocused();
  });

  test('Mark ready: a network failure keeps the Idempotency-Key for the retry', async ({ page }) => {
    const board = await busyBoard(page);
    await routeBoard(page, board);
    const ready = await payload(page, 'restaurant_order_ready_for_pickup');
    const keys: string[] = [];
    await page.route('**/v1/restaurant/orders/*/ready', (route: Route) => {
      keys.push(route.request().headers()['idempotency-key'] ?? '');
      if (keys.length === 1) return route.abort('failed');
      return route.fulfill({ json: { data: { ...board.preparing, ...ready, id: board.preparing.id, code: 'K7L8', state: 'READY_FOR_PICKUP', ready_at: new Date().toISOString() } } });
    });
    await openSignedIn(page, '/orders?order=' + board.preparing.id);
    const panel = page.getByRole('complementary', { name: 'Order K7L8 details' });
    await panel.getByRole('button', { name: 'Mark order K7L8 ready' }).click();
    await expect(panel.getByText('We couldn’t mark K7L8 ready')).toBeVisible();
    const list = page.getByRole('region', { name: 'In progress' });
    await expect(list.getByText('Not marked ready')).toBeVisible();
    await shot(page, 'mark-ready-failed');

    // The panel is open, so the list shows its narrow columns: retry from the panel's footer.
    await panel.getByRole('button', { name: 'Mark order K7L8 ready' }).click();
    await expect(panel.getByTestId('detail-badge')).toHaveText('Ready');
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBeTruthy();
    expect(keys[1]).toBe(keys[0]);
  });

  test('rider here: the hand-off line and the pickup code, or the code-error state', async ({ page }) => {
    const board = await busyBoard(page);
    const socket = await fakeSocket(page);
    // `pickup_code` arrives with PR #290; until then the view has none → code-error state.
    await routeBoard(page, board);
    await openSignedIn(page, '/orders');
    const list = page.getByRole('region', { name: 'In progress' });
    await expect(list.getByRole('button', { name: 'K7J1', exact: true })).toBeVisible();
    await expect(page.getByTestId('health-badge')).toHaveText('Live');

    await socket.push(`order:${board.ready.id}`, 'dispatch.state_changed', { order_id: board.ready.id, from: 'ASSIGNED', to: 'AT_RESTAURANT', at: new Date().toISOString() });
    await expect(list.getByText('Ready · rider here')).toBeVisible();
    await expect(list.getByText('Read the pickup code to the rider')).toBeVisible();

    await list.getByRole('button', { name: 'K7J1', exact: true }).click();
    const panel = page.getByRole('complementary', { name: 'Order K7J1 details' });
    const rider = board.ready.rider.display_name;
    await expect(panel.getByText(`Hand bag K7J1 to ${rider}`)).toBeVisible();
    const error = panel.getByTestId('pickup-code-error');
    await expect(error).toHaveAttribute('role', 'alert');
    await expect(error.getByText('We couldn’t load the pickup code')).toBeVisible();
    await expect(error.getByText('Still missing? Call support, they can read it to you.')).toBeVisible();
    await expectNoDocumentScroll(page);
    await panel.getByTestId('rider-box').scrollIntoViewIfNeeded();
    await shot(page, 'ready-rider-here-code-error');
  });

  test('rider here with a pickup code (#290 shape) shows it large', async ({ page }) => {
    const board = await busyBoard(page);
    const socket = await fakeSocket(page);
    await routeBoard(page, board, { [board.ready.id]: { pickup_code: '4827' } });
    await openSignedIn(page, '/orders');
    await expect(page.getByTestId('health-badge')).toHaveText('Live');
    await socket.push(`order:${board.ready.id}`, 'dispatch.state_changed', { order_id: board.ready.id, from: 'ASSIGNED', to: 'AT_RESTAURANT', at: new Date().toISOString() });
    const list = page.getByRole('region', { name: 'In progress' });
    await expect(list.getByText('Ready · rider here')).toBeVisible();
    await list.getByRole('button', { name: 'K7J1', exact: true }).click();
    const panel = page.getByRole('complementary', { name: 'Order K7J1 details' });
    await expect(panel.getByRole('group', { name: 'Pickup code 4 8 2 7' })).toBeVisible();
    await expect(panel.getByTestId('pickup-code-error')).toHaveCount(0);
    await panel.getByTestId('rider-box').scrollIntoViewIfNeeded();
    await shot(page, 'ready-rider-here');
  });
});

test.describe('Status bar and halal', () => {
  test('turning orders off confirms in the page, first focus on Keep accepting', async ({ page }) => {
    await page.route('**/v1/restaurant/orders?**', (route) => route.fulfill({ json: { data: [], meta: { next_cursor: null, has_more: false } } }));
    await openSignedIn(page, '/orders');
    const bar = page.getByRole('region', { name: 'Service status' });
    await bar.getByRole('switch', { name: 'Orders' }).click();
    const confirm = page.getByRole('group', { name: 'Stop accepting new orders?' });
    await expect(confirm.getByRole('button', { name: 'Keep accepting' })).toBeFocused();
    await expect(bar.getByRole('switch', { name: 'Orders' })).toBeChecked();
    await expectNoDocumentScroll(page);
    await shot(page, 'turn-off-confirm');
    await page.keyboard.press('Escape');
    await expect(confirm).toHaveCount(0);
  });

  test('expired certificate: slate banner, never danger', async ({ page }) => {
    const profile = await payload(page, 'restaurant_profile');
    const suspended = await payload(page, 'restaurant_open_state_closed_suspended');
    await page.route('**/v1/restaurant/profile', (route) =>
      route.fulfill({ json: { data: { ...profile, halal: { display_state: 'EXPIRED', certifying_body_name: profile.halal.certifying_body_name, expires_on: '2026-09-20' } } } }),
    );
    // Stands in for a CLOSED_SUSPENDED availability with the halal reason (fixture requested in #676).
    await page.route('**/v1/restaurant/availability', (route) => route.fulfill({ json: { data: { ...suspended, reason: 'Suspended: halal certificate expired' } } }));
    await page.route('**/v1/restaurant/orders?**', (route) => route.fulfill({ json: { data: [], meta: { next_cursor: null, has_more: false } } }));
    await openSignedIn(page, '/orders');
    const banner = page.getByTestId('banner-halal');
    await expect(banner.getByText('We can’t currently vouch for your halal certificate')).toBeVisible();
    await expect(banner).toHaveAttribute('data-tone', 'halal-expired');
    await expect(banner.getByText(/It expired on 20 September 2026/)).toBeVisible();
    const bar = page.getByRole('region', { name: 'Service status' });
    await expect(bar.getByTestId('open-state-reason')).toHaveText('Suspended: halal certificate expired');
    await expect(bar.getByRole('switch', { name: 'Orders' })).toBeDisabled();
    await expectNoDocumentScroll(page);
    await shot(page, 'cert-expired');
  });
});
