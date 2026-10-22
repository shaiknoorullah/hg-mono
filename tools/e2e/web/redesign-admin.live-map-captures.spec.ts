import { expect, test, type Page, type Route } from '@playwright/test';

import { expectDesignFor } from './design';
import { E2E_MODE } from './mode';
import { routeLogin, signIn, type StaffRole } from './redesign-admin.support';

test.skip(E2E_MODE !== 'mock', 'written against the mock server; run with E2E_MODE=mock');

/**
 * The live map pane of the order workspace, one capture per state board (`admin/orders/LiveMap*`,
 * seventeen boards; the pane's own reference sheet, `LiveMapPane`, is the same drawing at 760 wide
 * and is not captured separately). Each state is made the way it happens: a position that stopped,
 * a socket that dropped, the network going away, a session ending, a map that never arrives.
 *
 * Contract fixtures describe an order and its dispatch but carry no coordinates, so each capture
 * serves the named fixture with the coordinates the contract defines (`restaurant_location`,
 * `rider_location`, the revealed address's latitude and longitude) added, and nothing else changed.
 * The numbers are this file's own, not copied from a fixture.
 *
 * No tiles: the build these run against sets `VITE_HG_MAP_FLAT`, which draws the map as one flat
 * sunken field with the pins on it, which is what the boards draw. A capture therefore never depends
 * on Mapbox being reachable, and needs no token. What the field cannot reproduce is the pins' place:
 * the boards put each pin at a fixed pixel, a real map puts it where its coordinates are. That
 * region is declared in the pull request, not tuned.
 *
 * Boards are drawn at 1440 wide, so the tablet project takes no capture.
 */
const BASE = process.env.E2E_ADMIN_REDESIGN_URL ?? process.env.BASE_URL;
if (BASE) test.use({ baseURL: BASE });

const OR = 'admin/orders/';
const MOCK = process.env.E2E_MOCK_API_URL ?? 'http://localhost:4010';
const FROZEN_CLOCK = new Date('2026-08-10T18:42:11.412Z');

const LIST = /\/v1\/admin\/orders(\?.*)?$/;
const ORDER = /\/v1\/admin\/orders\/[^/?]+(\?.*)?$/;
const MAPBOX_CHUNK = /mapbox-gl[^/]*\.js(\?.*)?$/;

type Json = Record<string, unknown>;

/** The fixture `name` as the mock serves it, unwrapped to the order. */
async function fixtureOrder(page: Page, name: string): Promise<{ order: Json; envelope: Json }> {
  const response = await page.request.get(`${MOCK}/v1/admin/orders/any?scenario=${name}`);
  const envelope = (await response.json()) as Json;
  return { order: envelope['data'] as Json, envelope };
}

const REST = { latitude: 43.7262, longitude: -79.2701 };
const HOME = { latitude: 43.7349, longitude: -79.2552 };
const MIDWAY = { latitude: 43.7296, longitude: -79.2648 };

const fix = (secondsAgo: number, at = MIDWAY, heading: number | null = 45) => ({
  ...at,
  heading_deg: heading,
  accuracy_m: 6,
  recorded_at: new Date(FROZEN_CLOCK.getTime() - secondsAgo * 1000).toISOString(),
  is_coarse: false,
});

interface Scene {
  /** The fixture the order starts from. */
  base: string;
  /** Changes to the order, after the coordinates below. */
  with?: (order: Json, borrowed: { rider: Json; address: Json }) => Json;
  /** Left out of the response. */
  without?: string[];
  role?: StaffRole;
}

/** The order for a scene: the fixture, the coordinates, the changes. */
async function orderFor(page: Page, scene: Scene): Promise<{ order: Json; envelope: Json }> {
  const { order, envelope } = await fixtureOrder(page, scene.base);
  const rider = ((await fixtureOrder(page, 'order_admin_view_picked_up')).order['rider'] ?? {}) as Json;
  const address = ((await fixtureOrder(page, 'order_admin_view_pii_revealed')).order['delivery_address'] ?? {}) as Json;
  let next: Json = { ...order, restaurant_location: REST, destination_location: HOME };
  if (scene.with) next = scene.with(next, { rider, address });
  for (const key of scene.without ?? []) delete next[key];
  return { order: next, envelope: { ...envelope, data: next } };
}

/** A rider on the way to the restaurant, with a position `ago` seconds old. */
const withRider =
  (dispatch: string, ago: number, at = MIDWAY) =>
  (order: Json, b: { rider: Json }): Json => ({ ...order, rider: b.rider, dispatch_state: dispatch, rider_location: fix(ago, at) });

const PICKED_UP = (ago: number) => ({ base: 'order_admin_view_picked_up', with: (o: Json) => ({ ...o, rider_location: fix(ago) }) });

interface Open {
  scene: Scene;
  /** The socket: `open` answers like a live one; `drops` closes it at once and again on every retry. */
  socket?: 'open' | 'drops';
  /** Add to the page before it opens. */
  before?: (page: Page) => Promise<void>;
}

/** Signs in, opens the order and presses Live map. Returns the route that serves the order. */
async function openMap(page: Page, o: Open, serveOrder?: (route: Route, order: Json) => Promise<void>) {
  const { order, envelope } = await orderFor(page, o.scene);
  await routeLogin(page, o.scene.role ?? 'ADMIN');
  await page.clock.install({ time: FROZEN_CLOCK });
  await page.route(LIST, async (route) => {
    const response = await route.fetch({ headers: { ...route.request().headers(), 'x-mock-scenario': 'order_admin_list_every_state' } });
    await route.fulfill({ response });
  });
  let current = envelope;
  await page.route(ORDER, async (route) => {
    if (serveOrder) return serveOrder(route, current['data'] as Json);
    return route.fulfill({ json: current });
  });
  // One stand-in for the realtime socket, so the connection reads the way the board needs.
  await page.route('**/v1/realtime/ticket', (route) =>
    route.fulfill({ json: { data: { ticket: 'e2e-stand-in', websocket_url: 'ws://localhost:4010/v1/ws', expires_at: '2026-08-10T18:43:11.412Z' } } }),
  );
  await page.routeWebSocket(/\/v1\/ws/, (ws) => {
    if ((o.socket ?? 'open') === 'drops') ws.close({ code: 1011, reason: 'e2e: the connection drops' });
  });
  await o.before?.(page);
  await page.goto('/');
  await signIn(page);
  await expect(page.locator('#app-bar-heading')).toBeVisible();
  await page.evaluate((h) => {
    window.location.hash = h;
  }, `#/orders/${String(order['id'])}`);
  await expect(page.locator('#order-heading')).toBeVisible();
  await page.getByRole('button', { name: 'Live map' }).click();
  await expect(page.getByTestId('LiveMapPane')).toBeVisible();
  return {
    /** Serve a different order from now on. */
    replace: (next: Json) => {
      current = { ...current, data: next };
    },
  };
}

/** The map has drawn (or failed, or is still arriving): the pane says which. */
const phase = (page: Page, expected: string) => expect(page.locator('[data-phase]').first()).toHaveAttribute('data-phase', expected);

async function capture(page: Page, board: string, { idle = true }: { idle?: boolean } = {}) {
  await page.waitForLoadState(idle ? 'networkidle' : 'load');
  await expect(page.getByText('Not built yet')).toHaveCount(0);
  await expectDesignFor(page, { 1440: `${OR}${board}` });
}

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.metadata.viewport === 'tablet', 'the boards are drawn at 1440 wide');
});

test.describe('redesigned admin · live map (mock)', () => {
  test.use({ colorScheme: 'light' });

  test('live, the kitchen is cooking and the rider is on the way to it', async ({ page }) => {
    await openMap(page, { scene: { base: 'order_admin_view_preparing', with: withRider('ASSIGNED', 8) } });
    await phase(page, 'ready');
    await expect(page.getByText('Live', { exact: true })).toBeVisible();
    await capture(page, 'LiveMap');
  });

  test('live, as a support agent', async ({ page }) => {
    await openMap(page, { scene: { base: 'order_admin_view_preparing', with: withRider('ASSIGNED', 8), role: 'SUPPORT_AGENT' } });
    await phase(page, 'ready');
    await capture(page, 'LiveMapSupport');
  });

  test('stale, the rider’s phone stopped sending four minutes ago', async ({ page }) => {
    await openMap(page, { scene: PICKED_UP(240) });
    await phase(page, 'ready');
    await expect(page.getByText('may not be where the rider is now')).toBeVisible();
    await capture(page, 'LiveMapStale');
  });

  test('reconnecting, the socket dropped and the picture is held', async ({ page }) => {
    await openMap(page, { scene: PICKED_UP(17), socket: 'drops' });
    await phase(page, 'ready');
    await expect(page.getByText('Your connection is reconnecting.')).toBeVisible();
    await capture(page, 'LiveMapReconnecting');
  });

  test('offline, this computer lost the network', async ({ page }) => {
    await openMap(page, { scene: PICKED_UP(17) });
    await phase(page, 'ready');
    await page.context().setOffline(true);
    await expect(page.getByText('You’re offline.').first()).toBeVisible();
    await capture(page, 'LiveMapOffline');
  });

  test('session ended while watching', async ({ page }) => {
    let ended = false;
    await openMap(
      page,
      { scene: PICKED_UP(17), socket: 'drops' },
      async (route, order) => {
        if (!ended) return route.fulfill({ json: { data: order } });
        const response = await route.fetch({ headers: { ...route.request().headers(), 'x-mock-scenario': 'error_session_expired' } });
        return route.fulfill({ response });
      },
    );
    await phase(page, 'ready');
    ended = true;
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 30_000 });
    await capture(page, 'LiveMapSessionEnded');
  });

  test('the order is delivered while watching', async ({ page }) => {
    const delivered = (await fixtureOrder(page, 'order_admin_view_delivered')).order;
    const watch = await openMap(page, { scene: PICKED_UP(17), socket: 'drops' });
    await phase(page, 'ready');
    watch.replace({ ...delivered, restaurant_location: REST, destination_location: HOME, rider: delivered['rider'], rider_location: fix(300) });
    await expect(page.getByText('while you were watching.')).toBeVisible({ timeout: 30_000 });
    await capture(page, 'LiveMapStateChanged');
  });

  test('loading, the map has not arrived', async ({ page }) => {
    await openMap(page, {
      scene: { base: 'order_admin_view_preparing', with: withRider('ASSIGNED', 8) },
      before: (p) => p.route(MAPBOX_CHUNK, () => new Promise<void>(() => undefined)),
    });
    await phase(page, 'loading');
    await capture(page, 'LiveMapLoading', { idle: false });
  });

  test('error, the map engine did not load', async ({ page }) => {
    await openMap(page, {
      scene: { base: 'order_admin_view_preparing', with: withRider('ASSIGNED', 8) },
      before: (p) => p.route(MAPBOX_CHUNK, (route) => route.abort()),
    });
    await phase(page, 'error');
    await capture(page, 'LiveMapError');
  });

  test('no rider yet', async ({ page }) => {
    await openMap(page, { scene: { base: 'order_admin_view_ready_for_pickup', with: (o) => ({ ...o, rider: null, dispatch_state: 'SEARCHING', rider_location: null }) } });
    await phase(page, 'ready');
    await capture(page, 'LiveMapNoRider');
  });

  test('a rider with no position yet', async ({ page }) => {
    await openMap(page, { scene: { base: 'order_admin_view_preparing', with: (o, b) => ({ ...o, rider: b.rider, dispatch_state: 'ASSIGNED', rider_location: null }) } });
    await phase(page, 'ready');
    await capture(page, 'LiveMapNoPing');
  });

  test('a revealed address that has no map location', async ({ page }) => {
    await openMap(page, {
      scene: {
        base: 'order_admin_view_preparing',
        with: (o, b) => ({
          ...withRider('ASSIGNED', 8)(o, b),
          pii_revealed: true,
          destination_location: null,
          delivery_address: { ...b.address, latitude: null, longitude: null },
        }),
      },
    });
    await phase(page, 'ready');
    await capture(page, 'LiveMapNoDestination');
  });

  test('a restaurant with no map location', async ({ page }) => {
    await openMap(page, { scene: { base: 'order_admin_view_preparing', with: (o, b) => ({ ...withRider('ASSIGNED', 8)(o, b), restaurant_location: null }) } });
    await phase(page, 'ready');
    await capture(page, 'LiveMapNoRestaurant');
  });

  test('the rider is at the restaurant', async ({ page }) => {
    await openMap(page, { scene: { base: 'order_admin_view_ready_for_pickup', with: withRider('AT_RESTAURANT', 12, REST) } });
    await phase(page, 'ready');
    await capture(page, 'LiveMapAtRestaurant');
  });

  test('the rider has arrived', async ({ page }) => {
    await openMap(page, { scene: { base: 'order_admin_view_arrived', with: withRider('AT_CUSTOMER', 12, HOME) } });
    await phase(page, 'ready');
    await capture(page, 'LiveMapArrived');
  });

  test('disputed while the rider still has the order', async ({ page }) => {
    await openMap(page, { scene: { base: 'order_admin_view_disputed', with: withRider('CARRYING', 17) } });
    await phase(page, 'ready');
    await capture(page, 'LiveMapDisputed');
  });

  test('finished, nothing to follow', async ({ page }) => {
    await openMap(page, { scene: { base: 'order_admin_view_completed', with: (o) => ({ ...o, rider_location: null }) } });
    await phase(page, 'ready');
    await capture(page, 'LiveMapFinished');
  });
});
