/**
 * Restaurant redesign WP3: the new-order strip, accept, decline, sound and the go-live gate
 * (manifest §3 WP3, §6 row WP3). Runs at desktop 1440×900 and tablet 1024×768, flag on.
 *
 * Mock mode: the mock is stateless and its pending list carries the fixtures' frozen (past)
 * deadlines, so the pending orders are answered here with `page.route`, built from the
 * contract fixtures `restaurant_order_queue_busy` / `restaurant_order_restaurant_pending`
 * with deadlines moved to now (fixture request: live-deadline pending orders, #676). Accept
 * answers from `restaurant_order_preparing`, errors from `error_capture_failed`.
 */
import { expect, test, type Page, type Request, type TestInfo } from '@playwright/test';
import { copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { MOCK_API, documentScrolls, openSignedIn } from './redesign-restaurant.support';

const SHOTS = process.env.WP3_SHOTS_DIR;

async function shot(page: Page, info: TestInfo, state: string) {
  const file = info.outputPath(`${state}.png`);
  await page.screenshot({ path: file });
  if (SHOTS) {
    mkdirSync(SHOTS, { recursive: true });
    copyFileSync(file, join(SHOTS, `${info.project.name}-${state}.png`));
  }
}

async function fixturePayload(page: Page, name: string) {
  const res = await page.request.get(`${MOCK_API}/__mock/scenarios/${name}`);
  return (await res.json()).data.payload;
}

interface Pending {
  code: string;
  secondsLeft: number;
  name?: string;
  net?: number;
  note?: string | null;
}

const CODES: Pending[] = [
  { code: 'A7K2', secondsLeft: 132, name: 'Aisha K.', net: 3769, note: 'No onions in the wrap, please.' },
  { code: 'B3M9', secondsLeft: 40, name: 'Omar S.', net: 2210, note: null },
  { code: 'C8T4', secondsLeft: 15, name: 'Fatima R.', net: 5697, note: 'Ring twice.' },
  { code: 'D2P6', secondsLeft: 170, name: 'Yusra M.', net: 1450, note: null },
];

/** Answers the pending list and each order from the contract fixture, with live deadlines. */
async function servePending(page: Page, pending: Pending[]) {
  const base = await fixturePayload(page, 'restaurant_order_restaurant_pending');
  const preparing = await fixturePayload(page, 'restaurant_order_preparing');
  const now = Date.now();
  const orders = pending.map((p, i) => ({
    ...structuredClone(base),
    id: `00000000-0000-4000-8000-00000000000${i + 1}`,
    code: p.code,
    deadline_at: new Date(now + p.secondsLeft * 1000).toISOString(),
    customer: { display_name: p.name ?? 'Aisha K.', phone_masked: '+1 416 ••• 0123' },
    special_instructions: p.note ?? null,
    money: { ...base.money, restaurant_net_cents: p.net ?? base.money.restaurant_net_cents },
  }));
  const calls = { accept: [] as Request[], reject: [] as Request[], availability: [] as Request[] };
  let acceptStatus: { status: number; body: unknown } | null = null;
  await page.route(/\/v1\/restaurant\/orders(\?.*)?$/, (route) =>
    route.request().method() === 'GET'
      ? route.fulfill({ json: { data: orders, meta: { next_cursor: null, has_more: false, limit: 50 } } })
      : route.fallback(),
  );
  await page.route(/\/v1\/restaurant\/orders\/[^/]+$/, (route) => {
    const id = route.request().url().split('/').pop()!.split('?')[0];
    const order = orders.find((o) => o.id === id);
    return order ? route.fulfill({ json: { data: order } }) : route.fallback();
  });
  await page.route(/\/v1\/restaurant\/orders\/[^/]+\/accept$/, (route) => {
    calls.accept.push(route.request());
    const id = route.request().url().split('/').slice(-2)[0];
    const order = orders.find((o) => o.id === id)!;
    if (acceptStatus) return route.fulfill({ status: acceptStatus.status, json: acceptStatus.body });
    return route.fulfill({
      json: { data: { ...preparing, id, code: order.code, promised_ready_at: new Date(Date.now() + 20 * 60_000).toISOString() } },
    });
  });
  await page.route(/\/v1\/restaurant\/orders\/[^/]+\/reject$/, (route) => {
    calls.reject.push(route.request());
    return route.fallback();
  });
  await page.route(/\/v1\/restaurant\/menu\/items\/[^/]+\/availability$/, (route) => {
    calls.availability.push(route.request());
    return route.fallback();
  });
  return {
    orders,
    calls,
    failAccept: (status: number, body: unknown) => {
      acceptStatus = { status, body };
    },
  };
}

/** /orders → go-live gate → History (a quiet page, so the strip is what's on screen). */
async function goLive(page: Page, info: TestInfo) {
  await page.context().grantPermissions(['notifications']);
  await openSignedIn(page, '/orders');
  const gate = page.getByRole('region', { name: 'Turn on order sound and go live' });
  await expect(gate).toBeVisible();
  // The strip is hidden behind the gate on this page.
  await expect(page.getByTestId('new-order-strip')).toHaveCount(0);
  await shot(page, info, 'gate');
  await page.getByRole('button', { name: 'Turn on sound and go live' }).click();
  await expect(gate).toHaveCount(0);
  await page.getByTestId('console-rail').getByRole('link', { name: /^History/ }).click();
}

async function noDocumentScroll(page: Page) {
  const m = await documentScrolls(page);
  expect(m.scrollHeight, 'document must not scroll vertically').toBeLessThanOrEqual(m.innerHeight);
  expect(m.scrollWidth, 'document must not scroll horizontally').toBeLessThanOrEqual(m.innerWidth);
}

const tile = (page: Page, code: string) => page.locator(`[data-offer-tile][aria-label^="New order ${code}"]`);

test.describe('restaurant redesign · new-order strip', () => {
  test('go-live gate: notifications denied offers to go live without them', async ({ page }, info) => {
    await servePending(page, []);
    await page.context().clearPermissions();
    await page.addInitScript(() => {
      // Headless Chromium has no prompt; make the browser answer "Block".
      Object.defineProperty(Notification, 'permission', { get: () => 'denied' });
      Notification.requestPermission = () => Promise.resolve('denied');
    });
    await openSignedIn(page, '/orders');
    await page.getByRole('button', { name: 'Turn on sound and go live' }).click();
    await expect(page.getByText('Step 2: notifications are blocked')).toBeVisible();
    await shot(page, info, 'gate-notif-denied');
    await page.getByRole('button', { name: 'Go live without notifications' }).click();
    await expect(page.getByTestId('go-live-gate')).toHaveCount(0);
    await expect(page.getByTestId('new-order-strip')).toBeVisible();
    await noDocumentScroll(page);
  });

  test('empty strip after going live', async ({ page }, info) => {
    await servePending(page, []);
    await goLive(page, info);
    const strip = page.getByTestId('new-order-strip');
    await expect(strip.getByText('No new orders')).toBeVisible();
    await expect(strip.getByText('Each new order rings until it is answered or times out.')).toBeVisible();
    await shot(page, info, 'empty');
    await noDocumentScroll(page);
  });

  test('one offer: tile, accept with the A key on the focused tile only', async ({ page }, info) => {
    const api = await servePending(page, CODES.slice(0, 1));
    await goLive(page, info);
    const a7 = tile(page, 'A7K2');
    await expect(a7).toBeVisible();
    await expect(a7.getByRole('button', { name: 'Accept order A7K2, ready in 20 minutes' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'New orders, 1 waiting' })).toBeVisible();
    // Accept is the 72 px orange button.
    const box = await a7.getByRole('button', { name: /^Accept order A7K2/ }).boundingBox();
    expect(Math.round(box!.height)).toBe(72);
    await shot(page, info, 'offer-one');
    await noDocumentScroll(page);

    // A stray key with focus elsewhere does nothing.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press('a');
    await page.waitForTimeout(300);
    expect(api.calls.accept).toHaveLength(0);

    // Focus the tile, press A: accepted with the prep time only.
    await a7.focus();
    await expect(a7.getByText('Selected')).toBeVisible();
    await shot(page, info, 'offer-keyboard');
    await page.keyboard.press('a');
    await expect(page.getByTestId('hg-toast').getByText(/^A7K2 accepted · ready by \d{1,2}:\d{2} (am|pm)$/)).toBeVisible();
    expect(api.calls.accept).toHaveLength(1);
    expect(api.calls.accept[0]!.postDataJSON()).toEqual({ prep_eta_minutes: 20 });
    expect(api.calls.accept[0]!.headers()['idempotency-key']).toBeTruthy();
    await shot(page, info, 'offer-accepted');
  });

  test('offers sort soonest first; a fourth waits behind the overflow control', async ({ page }, info) => {
    await servePending(page, CODES);
    await goLive(page, info);
    const group = page.getByRole('group', { name: /^New orders, soonest deadline first/ });
    // Three in full at 1440; on the tablet two fit beside the overflow control.
    const inFull = info.project.name === 'tablet' ? 2 : 3;
    await expect(group.locator('[data-offer-tile]')).toHaveCount(inFull);
    const order = await group.locator('[data-offer-tile]').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')!.split(',')[0]));
    expect(order).toEqual(['New order C8T4', 'New order B3M9', 'New order A7K2'].slice(0, inFull));
    const more = 4 - inFull;
    await expect(page.getByRole('button', { name: `Show ${more} more new ${more === 1 ? 'order' : 'orders'}` })).toBeVisible();
    await shot(page, info, 'offer-four-overflow');
    await noDocumentScroll(page);
    // Every Accept in view is fully inside the strip.
    const area = (await group.boundingBox())!;
    for (const b of await group.getByRole('button', { name: /^Accept order/ }).all()) {
      const r = (await b.boundingBox())!;
      expect(r.x + r.width).toBeLessThanOrEqual(area.x + area.width + 0.5);
    }
    // Right arrow walks to the fourth order; the strip scrolls so it is in full.
    await tile(page, 'C8T4').focus();
    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
    await expect(tile(page, 'D2P6')).toBeFocused();
    await expect(page.getByRole('button', { name: /^Show \d earlier new order/ })).toBeVisible();
    const d2 = (await tile(page, 'D2P6').getByRole('button', { name: /^Accept order D2P6/ }).boundingBox())!;
    expect(d2.x + d2.width).toBeLessThanOrEqual(area.x + area.width + 0.5);
    await shot(page, info, 'offer-four-focus');
  });

  test('Enter opens the offer in the panel; Escape returns focus to the tile', async ({ page }, info) => {
    await servePending(page, CODES.slice(0, 2));
    await goLive(page, info);
    await tile(page, 'A7K2').focus();
    await page.keyboard.press('Enter');
    const panel = page.getByRole('complementary', { name: 'Order A7K2 details' });
    await expect(panel).toBeVisible();
    await expect(panel.getByRole('heading', { name: 'A7K2' })).toBeFocused();
    await expect(panel.getByText('Phone number and full address appear after you accept.')).toBeVisible();
    await expect(panel.getByText('+1 416 ••• 0123')).toHaveCount(0);
    await expect(page.getByText('2 new orders waiting')).toBeVisible();
    await panel.getByRole('button', { name: 'More prep time for order A7K2' }).click();
    await expect(panel.getByRole('button', { name: 'Accept order A7K2, ready in 25 minutes' })).toBeVisible();
    await shot(page, info, 'detail-pending');
    await noDocumentScroll(page);
    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);
    await expect(tile(page, 'A7K2')).toBeFocused();
  });

  test('decline with "Something else" requires a 20-character note and sends it (#604)', async ({ page }, info) => {
    const api = await servePending(page, CODES.slice(0, 1));
    await goLive(page, info);
    await tile(page, 'A7K2').focus();
    await page.keyboard.press('d');
    const panel = page.getByRole('complementary', { name: 'Order A7K2 details' });
    await expect(panel.getByRole('heading', { name: 'Decline A7K2?' })).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Keep order', exact: true })).toBeFocused();
    // No reason: the group error, nothing sent.
    await panel.getByRole('button', { name: 'Decline order, order A7K2' }).click();
    await expect(panel.getByText('Choose a reason to decline')).toBeVisible();
    await shot(page, info, 'decline-no-reason');
    await panel.getByRole('radio', { name: 'Something else' }).click();
    const note = panel.getByRole('textbox', { name: /Add detail/ });
    await note.fill('Out of rice');
    await panel.getByRole('button', { name: 'Decline order, order A7K2' }).click();
    await expect(panel.getByText('Write at least 20 characters.')).toBeVisible();
    await shot(page, info, 'decline-other');
    expect(api.calls.reject).toHaveLength(0);
    await note.fill('Out of rice for the biryani tonight');
    await panel.getByRole('button', { name: 'Decline order, order A7K2' }).click();
    await expect(page.getByTestId('hg-toast').getByText('A7K2 declined')).toBeVisible();
    expect(api.calls.reject).toHaveLength(1);
    expect(api.calls.reject[0]!.postDataJSON()).toEqual({ reason_code: 'OTHER', note: 'Out of rice for the biryani tonight' });
    expect(api.calls.reject[0]!.headers()['idempotency-key']).toBeTruthy();
    await shot(page, info, 'declined-toast');
  });

  test('decline an unavailable item, then mark it out of stock', async ({ page }, info) => {
    const api = await servePending(page, CODES.slice(0, 1));
    await goLive(page, info);
    await tile(page, 'A7K2').getByRole('button', { name: 'Decline order A7K2, choose a reason' }).click();
    const panel = page.getByRole('complementary', { name: 'Order A7K2 details' });
    await panel.getByRole('radio', { name: 'An item is unavailable' }).click();
    await panel.getByRole('checkbox', { name: '1 × Chicken Biryani' }).click();
    await shot(page, info, 'decline-item-unavailable');
    await panel.getByRole('button', { name: 'Decline order, order A7K2' }).click();
    await expect(page.getByTestId('hg-toast').getByText('A7K2 declined')).toBeVisible();
    expect(api.calls.reject[0]!.postDataJSON()).toEqual({
      reason_code: 'ITEM_UNAVAILABLE',
      unavailable_menu_item_ids: ['e3723319-f51b-42f0-a693-8c9eb954bb0f'],
    });
    expect(api.calls.availability).toHaveLength(1);
    expect(api.calls.availability[0]!.postDataJSON()).toEqual({ availability_state: 'OUT_OF_STOCK', out_of_stock_until: null });
  });

  test('capture failed keeps a danger outcome tile until removed', async ({ page }, info) => {
    const api = await servePending(page, CODES.slice(0, 1));
    const err = await fixturePayload(page, 'error_capture_failed');
    api.failAccept(409, err);
    await goLive(page, info);
    await tile(page, 'A7K2').getByRole('button', { name: /^Accept order A7K2/ }).click();
    const out = page.locator('[data-offer-tile][aria-label="New order A7K2, Cancelled"]');
    await expect(out).toBeVisible();
    await expect(out.getByText('Payment didn’t go through')).toBeVisible();
    await expect(out.getByText('Stays until you remove it. Kept in History.')).toBeVisible();
    await shot(page, info, 'offer-capture-failed');
    await out.getByRole('button', { name: 'Remove order A7K2 from new orders' }).click();
    await expect(out).toHaveCount(0);
  });
});
