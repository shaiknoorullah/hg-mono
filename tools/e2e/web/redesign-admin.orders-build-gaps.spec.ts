import { expect, test, type Page, type Route, type WebSocketRoute } from '@playwright/test';

import { E2E_MODE } from './mode';
import { captureBoard, signInAndOpen } from './redesign-admin.support';

test.skip(E2E_MODE !== 'mock', 'written against the mock server; run with E2E_MODE=mock');

/**
 * The `admin/orders` boards the app did not draw (issue 1005), each captured for its board
 * (tools/e2e/README.md, "Design captures"):
 *
 * - the orders list after Refresh (`OrdersRefreshed`) and the order workspace with its list folded
 *   (`OrderDetailListCollapsed`);
 * - the four ways live alerts stop arriving: a ticket that could not be minted, a channel refused as
 *   forbidden, a channel refused as invalid, and a session that ended (`reauth_required`).
 *
 * The orders come from contract fixtures, served by the mock server by scenario name. The four
 * live-alerts states are socket events the server would send, so the socket is replaced here and plays
 * the frames from `contracts/websocket.md` section 4.1 (`subscribe_error`, `reauth_required`).
 *
 * Not captured, because the app does not draw them: `OrderDetailIncident` and
 * `OrderDetailApprovalPending`, which need operations the contract does not have (see the pull request).
 *
 * Boards are drawn at 1440 wide, so the tablet project takes no capture.
 */
const BASE = process.env.E2E_ADMIN_REDESIGN_URL ?? process.env.BASE_URL;
if (BASE) test.use({ baseURL: BASE });

const OR = 'admin/orders/';
const MOCK = process.env.E2E_MOCK_API_URL ?? 'http://localhost:4010';
/** The clock the contract fixtures are written against (contracts/fixtures/index.json, `frozen_clock`). */
const FROZEN_CLOCK = new Date('2026-08-10T18:42:11.412Z');

const LIST = /\/v1\/admin\/orders(\?.*)?$/;
const ORDER = /\/v1\/admin\/orders\/[^/?]+(\?.*)?$/;

async function serve(route: Route, name: string): Promise<void> {
  const response = await route.fetch({ headers: { ...route.request().headers(), 'x-mock-scenario': name } });
  await route.fulfill({ response });
}

async function orderIdOf(page: Page, scenario: string): Promise<string> {
  const response = await page.request.get(`${MOCK}/v1/admin/orders/any?scenario=${scenario}`);
  return ((await response.json()) as { data: { id: string } }).data.id;
}

/**
 * Signs in with the fixtures' clock, then opens `hash`. The clock is installed before the first
 * navigation, which is the only part that differs from the shared `signInAndOpen`.
 */
async function open(page: Page, hash: string) {
  await page.clock.install({ time: FROZEN_CLOCK });
  await signInAndOpen(page, 'ADMIN', hash);
}

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.metadata.viewport === 'tablet', 'the boards are drawn at 1440 wide');
});

test.describe('redesigned admin · orders, the states the app did not draw (mock)', () => {
  test.use({ colorScheme: 'light' });

  test('orders, refreshed, one row changed', async ({ page }) => {
    // The first read has an order Preparing; the read after Refresh has the same order Ready for pickup.
    const body = (await (await page.request.get(`${MOCK}/v1/admin/orders?scenario=order_admin_list_every_state`)).json()) as {
      data: { id: string; state: string }[];
      meta: unknown;
    };
    const moved = body.data.find((r) => r.state === 'PREPARING')!.id;
    let reads = 0;
    await page.route(LIST, (route) => {
      reads += 1;
      const data = reads === 1 ? body.data : body.data.map((r) => (r.id === moved ? { ...r, state: 'READY_FOR_PICKUP' } : r));
      return route.fulfill({ json: { data, meta: body.meta } });
    });
    await open(page, '#/orders');
    await expect(page.getByText(/^List as of /)).toBeVisible();
    // Three minutes later, Refresh reads the list again.
    await page.clock.setSystemTime(new Date(FROZEN_CLOCK.getTime() + 3 * 60_000));
    await page.getByRole('button', { name: 'Refresh' }).click();
    await expect(page.getByText(/1 order changed\./)).toBeVisible();
    await captureBoard(page, { 1440: `${OR}OrdersRefreshed` });
  });

  test('order workspace, the list folded and the order widened', async ({ page }) => {
    const scenario = 'order_admin_view_picked_up';
    const id = await orderIdOf(page, scenario);
    await page.route(LIST, (route) => serve(route, 'order_admin_list_every_state'));
    await page.route(ORDER, (route) => serve(route, scenario));
    await open(page, `#/orders/${id}`);
    await expect(page.locator('#order-heading')).toBeVisible();
    await page.getByRole('button', { name: /^Collapse the .* list$/ }).click();
    await expect(page.getByRole('button', { name: /^Show the .* list$/ })).toBeVisible();
    await captureBoard(page, { 1440: `${OR}OrderDetailListCollapsed` });
  });
});

/** A server -> client control frame (`contracts/websocket.md`, section 2: `seq: 0`, no channel). */
function control(type: string, data: unknown): string {
  return JSON.stringify({ id: `01TESTCONTROL${type.toUpperCase().replace(/\W/g, '').padEnd(13, '0').slice(0, 13)}`, seq: 0, channel: '', type, v: 1, ts: FROZEN_CLOCK.toISOString(), data });
}

/**
 * A socket that answers a `subscribe` to `admin:ops` with `reply`, and sends `afterOpen` once it is open.
 * The ticket is the mock's own.
 */
async function openAlertsWith(page: Page, opts: { onSubscribe?: (ws: WebSocketRoute, channel: string) => void; afterOpen?: (ws: WebSocketRoute) => void; ticket?: (route: Route) => Promise<void> }) {
  if (opts.ticket) await page.route('**/v1/realtime/ticket', opts.ticket);
  await page.routeWebSocket(/\/v1\/ws/, (ws) => {
    ws.send(control('hello', { account_id: '00000000-0000-4000-8000-000000000000', roles: [], session_id: '00000000-0000-4000-8000-000000000001', allowed_channels: ['admin:ops'], server_time: FROZEN_CLOCK.toISOString(), heartbeat_s: 25, protocol: 1 }));
    ws.onMessage((message) => {
      const frame = JSON.parse(String(message)) as { type?: string; channel?: string };
      if (frame.type === 'subscribe' && frame.channel) opts.onSubscribe?.(ws, frame.channel);
    });
    opts.afterOpen?.(ws);
  });
  await open(page, '#/alerts');
}

test.describe('redesigned admin · live alerts, when they stop arriving (mock)', () => {
  test.use({ colorScheme: 'light' });

  test('live alerts, the connection ticket failed', async ({ page }) => {
    await openAlertsWith(page, { ticket: (route) => serve(route, 'error_internal_error') });
    // Five failed attempts in a row, each after its backoff.
    for (let i = 0; i < 6; i += 1) {
      await page.clock.fastForward('00:20');
      await page.waitForTimeout(150);
    }
    await expect(page.getByRole('heading', { name: 'Live alerts didn’t start' })).toBeVisible();
    await captureBoard(page, { 1440: `${OR}LiveAlertsTicketFailed` });
  });

  test('live alerts, the channel is refused as forbidden', async ({ page }) => {
    await openAlertsWith(page, {
      onSubscribe: (ws, channel) => ws.send(control('subscribe_error', { channel, code: 'forbidden', message: 'Not allowed.' })),
    });
    await expect(page.getByRole('heading', { name: 'This account can’t receive live alerts' })).toBeVisible();
    await captureBoard(page, { 1440: `${OR}LiveAlertsForbidden` });
  });

  test('live alerts, the channel is refused as invalid', async ({ page }) => {
    await openAlertsWith(page, {
      onSubscribe: (ws, channel) => ws.send(control('subscribe_error', { channel, code: 'invalid_channel', message: 'No such channel.' })),
    });
    await expect(page.getByRole('heading', { name: 'Live alerts couldn’t start' })).toBeVisible();
    await captureBoard(page, { 1440: `${OR}LiveAlertsInvalidChannel` });
  });

  test('live alerts, the session ended', async ({ page }) => {
    await openAlertsWith(page, {
      onSubscribe: (ws) => ws.send(control('reauth_required', { deadline: new Date(FROZEN_CLOCK.getTime() + 60_000).toISOString() })),
    });
    await expect(page.getByRole('dialog', { name: 'Sign in again to keep receiving alerts' })).toBeVisible();
    await captureBoard(page, { 1440: `${OR}LiveAlertsSessionEnded` });
  });
});
