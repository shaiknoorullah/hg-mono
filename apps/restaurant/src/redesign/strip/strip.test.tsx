/**
 * WP3 — the new-order strip, accept, decline, sound and the go-live gate (manifest §3 WP3
 * DONE list; spec specs/wp3-strip.md). Every state is asserted by role and name against the
 * contract fixtures, served through the real redesign client by the fake API.
 *
 * Fixture notes (fixture requested in #676): the contract has no pending order with a live
 * deadline, no list holding non-pending rows, and no restaurant realtime frames for offer
 * expiry / withdrawal / another screen. These tests patch `restaurant_order_restaurant_pending`
 * and `restaurant_order_queue_busy`, and re-target `restaurant.order_offered` from
 * `realtime_order_restaurant_rejects` to the console's restaurant channel.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { FakeRealtimeSocket } from '@hg/ui-web/testing';
import { consoleRoutes, errorBody, fixture, installFakeApi, type Handler } from '../test/fakeApi';
import { renderRedesign } from '../test/render';
import { setRealtimeSocketFactoryForTests } from '../data/realtime';
import { POLL_MS } from './NewOrdersProvider';

// ── fakes ────────────────────────────────────────────────────────────────────────────────

class FakeAudio {
  static instances: FakeAudio[] = [];
  static plays = 0;
  static pauses = 0;
  static reject = false;
  src: string;
  preload = '';
  volume = 1;
  currentTime = 0;
  constructor(src = '') {
    this.src = src;
    FakeAudio.instances.push(this);
  }
  play(): Promise<void> {
    FakeAudio.plays += 1;
    return FakeAudio.reject ? Promise.reject(new DOMException('blocked', 'NotAllowedError')) : Promise.resolve();
  }
  pause(): void {
    FakeAudio.pauses += 1;
  }
}

beforeEach(() => {
  FakeAudio.instances = [];
  FakeAudio.plays = 0;
  FakeAudio.pauses = 0;
  FakeAudio.reject = false;
  vi.stubGlobal('Audio', FakeAudio);
});

afterEach(() => {
  cleanup();
  setRealtimeSocketFactoryForTests(undefined);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// ── fixtures ─────────────────────────────────────────────────────────────────────────────

const PROFILE_ID: string = fixture('restaurant_profile').id;

let seq = 0;
/** A pending order from the contract fixture, with a live deadline. */
function pending(code: string, secondsLeft: number, patch: Record<string, unknown> = {}) {
  seq += 1;
  const o = fixture('restaurant_order_restaurant_pending');
  return {
    ...o,
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
    code,
    deadline_at: new Date(Date.now() + secondsLeft * 1000).toISOString(),
    ...patch,
  };
}

type Order = ReturnType<typeof pending>;

function routesFor(orders: Order[], overrides: Record<string, Handler> = {}): Record<string, Handler> {
  const byId: Record<string, Handler> = {};
  for (const o of orders) byId[`GET /v1/restaurant/orders/${o.id}`] = { body: o };
  return consoleRoutes({
    'GET /v1/restaurant/availability': 'restaurant_open_state_open',
    'GET /v1/restaurant/orders': { body: orders },
    ...byId,
    ...overrides,
  });
}

function accepted(o: Order) {
  return { body: { ...fixture('restaurant_order_preparing'), id: o.id, code: o.code } };
}

const tileOf = (code: string) => document.querySelector<HTMLElement>(`[data-offer-tile][aria-label^="New order ${code}"]`);

async function findTile(code: string) {
  await waitFor(() => expect(tileOf(code)).not.toBeNull());
  return tileOf(code)!;
}

function key(el: Element, k: string) {
  fireEvent.keyDown(el, { key: k });
}

// ── strip states ─────────────────────────────────────────────────────────────────────────

describe('new-order strip', () => {
  it('asks only for RESTAURANT_PENDING and drops any other row the server sends (#601)', async () => {
    const live = pending('A7K2', 132);
    const preparing = { ...fixture('restaurant_order_preparing'), code: 'P9X1' };
    const completed = { ...pending('C0M1', 100), state: 'COMPLETED' };
    const api = installFakeApi(routesFor([live, preparing, completed]));
    await renderRedesign('/orders/history');
    await findTile('A7K2');
    expect(tileOf('P9X1')).toBeNull();
    expect(tileOf('C0M1')).toBeNull();
    const url = new URL(api.callsTo('GET /v1/restaurant/orders')[0]!.url);
    expect(url.searchParams.get('state')).toBe('RESTAURANT_PENDING');
    expect(screen.getByRole('region', { name: 'New orders, 1 waiting' })).toBeTruthy();
  });

  it('shows loading, then the empty card with the rule', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    installFakeApi(
      routesFor([], {
        'GET /v1/restaurant/orders': async () => {
          await gate;
          return { body: [] };
        },
      }),
    );
    await renderRedesign('/orders/history');
    expect(await screen.findByRole('status', { name: 'Loading new orders' })).toBeTruthy();
    release();
    expect(await screen.findByText('No new orders')).toBeTruthy();
    expect(screen.getByText('New orders ring and appear here. Each one stays until you accept, decline, or it times out.')).toBeTruthy();
    expect(screen.getByText('Each new order rings until it is answered or times out.')).toBeTruthy();
  });

  it('draws a live tile: code, earnings, summary, note, and the 72 px orange Accept', async () => {
    const o = pending('A7K2', 132, { customer: { display_name: 'Aisha K.', phone_masked: '+1 416 ••• 0123' } });
    installFakeApi(routesFor([o]));
    await renderRedesign('/orders/history');
    const tile = await findTile('A7K2');
    expect(tile.getAttribute('aria-label')).toMatch(/^New order A7K2, 2 minutes \d+ seconds? left, \$79\.87$/);
    expect(tile.getAttribute('aria-keyshortcuts')).toBe('A D Enter');
    expect(within(tile).getByText('Aisha K. · 3 items')).toBeTruthy();
    expect(within(tile).getByText('Customer note')).toBeTruthy();
    const accept = within(tile).getByRole('button', { name: 'Accept order A7K2, ready in 20 minutes' });
    expect(accept.textContent).toContain('Accept · 20 min');
    expect(accept.className).toContain('h-[72px]');
    expect(accept.getAttribute('data-variant')).toBe('primary');
    expect(within(tile).getByRole('button', { name: 'Decline order A7K2, choose a reason' })).toBeTruthy();
    expect(screen.getByText('Answer within 3 minutes. Soonest deadline first.')).toBeTruthy();
    // The rail counts it.
    expect(screen.getByRole('link', { name: 'Live orders, 1 new' })).toBeTruthy();
  });

  it('puts the soonest deadline first and a fourth order behind "+1 more"', async () => {
    const orders = [pending('A7K2', 132), pending('B3M9', 40), pending('C8T4', 15), pending('D2P6', 170)];
    installFakeApi(routesFor(orders));
    await renderRedesign('/orders/history');
    await findTile('C8T4');
    const labels = [...document.querySelectorAll('[data-offer-tile]')].map((t) => t.getAttribute('aria-label')!.split(',')[0]);
    expect(labels).toEqual(['New order C8T4', 'New order B3M9', 'New order A7K2']);
    expect(screen.getByRole('button', { name: 'Show 1 more new order' })).toBeTruthy();
    // Right arrow from the last tile in view brings the fourth in, focused.
    const a7 = tileOf('A7K2')!;
    act(() => a7.focus());
    key(a7, 'ArrowRight');
    await waitFor(() => expect(document.activeElement).toBe(tileOf('D2P6')));
    expect(screen.getByRole('button', { name: 'Show 1 earlier new order' })).toBeTruthy();
  });
});

// ── keyboard guard ───────────────────────────────────────────────────────────────────────

describe('keyboard: keys act only on the focused tile', () => {
  it('A with focus on the page, in a text field or on a button does not accept; on the tile it does', async () => {
    const o = pending('A7K2', 132);
    const api = installFakeApi(routesFor([o], { [`POST /v1/restaurant/orders/${o.id}/accept`]: accepted(o) }));
    await renderRedesign('/orders/history');
    const tile = await findTile('A7K2');

    key(document.body, 'a');
    const field = document.createElement('textarea');
    document.body.appendChild(field);
    act(() => field.focus());
    key(field, 'a');
    key(field, 'd');
    key(field, 'Enter');
    const acceptBtn = within(tile).getByRole('button', { name: /^Accept order A7K2/ });
    key(acceptBtn, 'a');
    await new Promise((r) => setTimeout(r, 50));
    expect(api.callsTo(`POST /v1/restaurant/orders/${o.id}/accept`)).toHaveLength(0);
    expect(screen.queryByRole('complementary')).toBeNull();
    field.remove();

    act(() => tile.focus());
    expect(within(tile).getByText('Selected')).toBeTruthy();
    key(tile, 'a');
    await waitFor(() => expect(api.callsTo(`POST /v1/restaurant/orders/${o.id}/accept`)).toHaveLength(1));
    const req = api.callsTo(`POST /v1/restaurant/orders/${o.id}/accept`)[0]!;
    expect(await req.json()).toEqual({ prep_eta_minutes: 20 });
    expect(req.headers.get('Idempotency-Key')).toBeTruthy();
    // Toast with the promised ready time (12-hour, restaurant timezone).
    expect(await screen.findByText('A7K2 accepted · ready by 2:51 pm')).toBeTruthy();
    expect(screen.getByText('It’s at the top of In progress.')).toBeTruthy();
    // No order left: focus goes to the "New orders" heading.
    await waitFor(() => expect(document.activeElement?.textContent).toBe('New orders'));
  });

  it('D opens decline and Enter opens the order, for the focused tile', async () => {
    const o = pending('A7K2', 132);
    installFakeApi(routesFor([o]));
    await renderRedesign('/orders/history');
    const tile = await findTile('A7K2');
    act(() => tile.focus());
    key(tile, 'Enter');
    const panel = await screen.findByRole('complementary', { name: 'Order A7K2 details' });
    await waitFor(() => expect(document.activeElement).toBe(within(panel).getByRole('heading', { name: 'A7K2' })));
    fireEvent.keyDown(panel, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('complementary')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(tileOf('A7K2')));
    key(tileOf('A7K2')!, 'd');
    expect(await screen.findByRole('heading', { name: 'Decline A7K2?' })).toBeTruthy();
    // D never completes a decline.
    expect(screen.getByRole('button', { name: 'Decline order, order A7K2' })).toBeTruthy();
  });

  it('when the focused order ends, focus moves to its note and the next A does nothing', async () => {
    const o = pending('A7K2', 132);
    const api = installFakeApi(
      routesFor([o], { [`POST /v1/restaurant/orders/${o.id}/accept`]: 'error_offer_expired' }),
    );
    await renderRedesign('/orders/history');
    const tile = await findTile('A7K2');
    act(() => tile.focus());
    key(tile, 'a');
    const note = await screen.findByText('Too late to accept');
    await waitFor(() => expect(document.activeElement).toBe(note));
    expect(screen.getByText('The 3 minutes ran out first. The customer was not charged.')).toBeTruthy();
    expect(screen.getByText('Leaves by itself in 60 s. Kept in History.')).toBeTruthy();
    key(note, 'a');
    await new Promise((r) => setTimeout(r, 50));
    expect(api.callsTo(`POST /v1/restaurant/orders/${o.id}/accept`)).toHaveLength(1);
    expect(tileOf('A7K2')!.getAttribute('aria-label')).toBe('New order A7K2, Timed out');
  });
});

// ── accept ───────────────────────────────────────────────────────────────────────────────

describe('accept', () => {
  it('retries with the SAME Idempotency-Key after a failure, and never sends accepted_note', async () => {
    const o = pending('B3M9', 100);
    const route = `POST /v1/restaurant/orders/${o.id}/accept`;
    const api = installFakeApi(routesFor([o], { [route]: { status: 503, body: errorBody('SERVICE_UNAVAILABLE') } }));
    await renderRedesign('/orders/history');
    const tile = await findTile('B3M9');
    fireEvent.click(within(tile).getByRole('button', { name: 'Accept order B3M9, ready in 20 minutes' }));
    expect(await within(tile).findByText('Couldn’t confirm. Still waiting for you.')).toBeTruthy();
    const retry = within(tile).getByRole('button', { name: 'Try accept again, order B3M9, ready in 20 minutes' });
    api.set(route, accepted(o));
    fireEvent.click(retry);
    expect(await screen.findByText('B3M9 accepted · ready by 2:51 pm')).toBeTruthy();
    const calls = api.callsTo(route);
    expect(calls).toHaveLength(2);
    const [k1, k2] = calls.map((c) => c.headers.get('Idempotency-Key'));
    expect(k1).toBeTruthy();
    expect(k2).toBe(k1);
    for (const c of calls) expect(await c.json()).toEqual({ prep_eta_minutes: 20 });
  });

  it('shows "Confirming with HalalGoes" while sending, with Decline disabled', async () => {
    const o = pending('A7K2', 120);
    let release: () => void = () => {};
    const wait = new Promise<void>((r) => (release = r));
    installFakeApi(
      routesFor([o], {
        [`POST /v1/restaurant/orders/${o.id}/accept`]: async () => {
          await wait;
          return accepted(o);
        },
      }),
    );
    await renderRedesign('/orders/history');
    const tile = await findTile('A7K2');
    fireEvent.click(within(tile).getByRole('button', { name: /^Accept order A7K2/ }));
    expect(await within(tile).findByText('Confirming with HalalGoes. Don’t tap again.')).toBeTruthy();
    expect(within(tile).getByRole('button', { name: /^Decline order A7K2/ }).getAttribute('aria-disabled')).toBe('true');
    release();
    await waitFor(() => expect(tileOf('A7K2')).toBeNull());
  });

  it('409 CAPTURE_FAILED keeps a danger "Cancelled" tile until removed', async () => {
    const o = pending('A7K2', 120);
    installFakeApi(routesFor([o], { [`POST /v1/restaurant/orders/${o.id}/accept`]: 'error_capture_failed' }));
    await renderRedesign('/orders/history');
    const tile = await findTile('A7K2');
    fireEvent.click(within(tile).getByRole('button', { name: /^Accept order A7K2/ }));
    expect(await screen.findByText('Payment didn’t go through')).toBeTruthy();
    expect(screen.getByText('Don’t prepare this order. The customer was not charged.')).toBeTruthy();
    expect(screen.getByText('Stays until you remove it. Kept in History.')).toBeTruthy();
    expect(tileOf('A7K2')!.getAttribute('aria-label')).toBe('New order A7K2, Cancelled');
    fireEvent.click(screen.getByRole('button', { name: 'Remove order A7K2 from new orders' }));
    await waitFor(() => expect(tileOf('A7K2')).toBeNull());
  });

  it('accepts from the panel at the stepped prep time (1..120, steps of 5), with no phone shown', async () => {
    const o = pending('A7K2', 120);
    const route = `POST /v1/restaurant/orders/${o.id}/accept`;
    const api = installFakeApi(routesFor([o], { [route]: accepted(o) }));
    await renderRedesign(`/orders/history?panel=offer&order=${o.id}`);
    const panel = await screen.findByRole('complementary', { name: 'Order A7K2 details' });
    await within(panel).findByText('Phone number and full address appear after you accept.');
    expect(within(panel).queryByText(/•••/)).toBeNull();
    expect(within(panel).getByText('Please leave it on the mat, not the shoe rack.')).toBeTruthy();
    expect(within(panel).getByText('You earn')).toBeTruthy();
    const less = within(panel).getByRole('button', { name: 'Less prep time for order A7K2' });
    for (const expected of [15, 10, 5, 1]) {
      fireEvent.click(less);
      expect(within(panel).getByRole('status', { name: `Ready in ${expected} minutes` })).toBeTruthy();
    }
    expect(less.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(within(panel).getByRole('button', { name: 'More prep time for order A7K2' }));
    fireEvent.click(within(panel).getByRole('button', { name: 'Accept order A7K2, ready in 5 minutes' }));
    await waitFor(() => expect(api.callsTo(route)).toHaveLength(1));
    expect(await api.callsTo(route)[0]!.json()).toEqual({ prep_eta_minutes: 5 });
    await waitFor(() => expect(screen.queryByRole('complementary')).toBeNull());
  });
});

// ── decline ──────────────────────────────────────────────────────────────────────────────

describe('decline', () => {
  it('needs a reason: nothing preselected, Keep order first, the group error moves focus', async () => {
    const o = pending('A7K2', 120);
    const api = installFakeApi(routesFor([o]));
    await renderRedesign(`/orders/history?panel=decline&order=${o.id}`);
    const panel = await screen.findByRole('complementary', { name: 'Order A7K2 details' });
    await waitFor(() => expect(document.activeElement).toBe(within(panel).getByRole('button', { name: 'Keep order' })));
    const radios = within(panel).getAllByRole('radio');
    expect(radios.map((r) => r.getAttribute('aria-checked'))).toEqual(Array(7).fill('false'));
    expect(within(panel).getAllByRole('radio').map((r) => r.closest('div')!.textContent)).toEqual([
      'An item is unavailable',
      'Kitchen is too busy',
      'We are closing soon',
      'Equipment isn’t working',
      'Delivery address is too far',
      'The order looks suspicious',
      'Something else',
    ]);
    fireEvent.click(within(panel).getByRole('button', { name: 'Decline order, order A7K2' }));
    expect(await within(panel).findByText('Choose a reason to decline')).toBeTruthy();
    // Focus moves into the reason group (Radix hands it to the first radio).
    expect(document.activeElement?.closest('[role="radiogroup"]')).toBe(within(panel).getByRole('radiogroup'));
    expect(api.callsTo(`POST /v1/restaurant/orders/${o.id}/reject`)).toHaveLength(0);
  });

  it('"Something else" shows a note, requires 20+ characters, and sends it as rejectOrder.note (#604)', async () => {
    const o = pending('A7K2', 120);
    const route = `POST /v1/restaurant/orders/${o.id}/reject`;
    const api = installFakeApi(routesFor([o], { [route]: { status: 503, body: errorBody('SERVICE_UNAVAILABLE') } }));
    await renderRedesign(`/orders/history?panel=decline&order=${o.id}`);
    const panel = await screen.findByRole('complementary', { name: 'Order A7K2 details' });
    expect(within(panel).queryByRole('textbox')).toBeNull();
    fireEvent.click(within(panel).getByRole('radio', { name: 'Something else' }));
    const note = within(panel).getByRole('textbox', { name: 'Add detail (20 to 500 characters)' });
    fireEvent.change(note, { target: { value: 'Out of rice tonight' } });
    expect(within(panel).getByText('19 of 500 · 1 more to go')).toBeTruthy();
    fireEvent.click(within(panel).getByRole('button', { name: 'Decline order, order A7K2' }));
    expect(await within(panel).findByText('Write at least 20 characters.')).toBeTruthy();
    expect(note.getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(note);
    expect(api.callsTo(route)).toHaveLength(0);

    const text = 'Out of rice tonight, sorry';
    fireEvent.change(note, { target: { value: text } });
    fireEvent.click(within(panel).getByRole('button', { name: 'Decline order, order A7K2' }));
    expect(await within(panel).findByText('We couldn’t send the decline')).toBeTruthy();
    // The decline went out under this form's key: its body is locked for the retry (a new
    // reason under the same key would be IDEMPOTENCY_KEY_REUSE).
    expect((note as HTMLTextAreaElement).disabled).toBe(true);
    expect(within(panel).getByRole('radio', { name: 'Kitchen is too busy' }).hasAttribute('disabled')).toBe(true);
    const retry = within(panel).getByRole('button', { name: 'Try decline again, order A7K2' });
    api.set(route, 'restaurant_order_rejected');
    fireEvent.click(retry);
    expect(await screen.findByText('A7K2 declined')).toBeTruthy();
    expect(screen.getByText('The customer was not charged. It’s in History.')).toBeTruthy();
    const calls = api.callsTo(route);
    expect(calls).toHaveLength(2);
    for (const c of calls) expect(await c.json()).toEqual({ reason_code: 'OTHER', note: text });
    // One key for this decline, made when the form opened, reused on the retry.
    expect(calls[0]!.headers.get('Idempotency-Key')).toBeTruthy();
    expect(calls[1]!.headers.get('Idempotency-Key')).toBe(calls[0]!.headers.get('Idempotency-Key'));
    await waitFor(() => expect(tileOf('A7K2')).toBeNull());
  });

  it('item unavailable: sends the ticked items, then marks them out of stock; a failure there never un-declines', async () => {
    const o = pending('A7K2', 120);
    const reject = `POST /v1/restaurant/orders/${o.id}/reject`;
    const biryani = o.lines[0].menu_item_id as string;
    const put = `PUT /v1/restaurant/menu/items/${biryani}/availability`;
    const api = installFakeApi(routesFor([o], { [reject]: 'restaurant_order_rejected', [put]: 'error_menu_locked' }));
    await renderRedesign(`/orders/history?panel=decline&order=${o.id}`);
    const panel = await screen.findByRole('complementary', { name: 'Order A7K2 details' });
    fireEvent.click(within(panel).getByRole('radio', { name: 'An item is unavailable' }));
    expect(within(panel).getByRole('group', { name: 'Which items are unavailable?' })).toBeTruthy();
    fireEvent.click(within(panel).getByRole('checkbox', { name: '1 × Chicken Biryani' }));
    expect(within(panel).getByRole('checkbox', { name: /Also mark the ticked items out of stock until closing/ }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(within(panel).getByRole('button', { name: 'Decline order, order A7K2' }));
    expect(
      await screen.findByText('Order declined. We couldn’t mark Chicken Biryani out of stock, so customers can still order it.'),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open Menu' })).toBeTruthy();
    expect(await api.callsTo(reject)[0]!.json()).toEqual({ reason_code: 'ITEM_UNAVAILABLE', unavailable_menu_item_ids: [biryani] });
    expect(await api.callsTo(put)[0]!.json()).toEqual({ availability_state: 'OUT_OF_STOCK', out_of_stock_until: null });
    expect(api.callsTo(reject)).toHaveLength(1);
  });

  it('409 OFFER_EXPIRED on decline shows "Too late to decline" and the timed-out tile', async () => {
    const o = pending('A7K2', 120);
    installFakeApi(routesFor([o], { [`POST /v1/restaurant/orders/${o.id}/reject`]: 'error_offer_expired' }));
    await renderRedesign(`/orders/history?panel=decline&order=${o.id}`);
    const panel = await screen.findByRole('complementary', { name: 'Order A7K2 details' });
    fireEvent.click(within(panel).getByRole('radio', { name: 'Kitchen is too busy' }));
    fireEvent.click(within(panel).getByRole('button', { name: 'Decline order, order A7K2' }));
    expect(await screen.findByText('Too late to decline')).toBeTruthy();
    expect(
      screen.getByText('The 3 minutes ran out before the decline was sent. The order timed out and the customer was not charged.'),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Back to new orders' }));
    expect(await screen.findByText('Nobody answered in 3 minutes')).toBeTruthy();
  });
});

// ── realtime and polling ─────────────────────────────────────────────────────────────────

function offeredFrame(id: string, code: string, secondsLeft: number, n: number) {
  const frame = fixture('realtime_order_restaurant_rejects').find((e: { type: string }) => e.type === 'restaurant.order_offered');
  const deadline = new Date(Date.now() + secondsLeft * 1000).toISOString();
  return {
    id: `evt-${n}`,
    seq: n,
    channel: `restaurant:${PROFILE_ID}`,
    type: 'restaurant.order_offered',
    data: { ...frame.data, order_id: id, code, deadline_at: deadline, expires_at: deadline },
  };
}

async function withSocket(orders: Order[], overrides: Record<string, Handler> = {}) {
  let sock: FakeRealtimeSocket | null = null;
  setRealtimeSocketFactoryForTests((url) => (sock = new FakeRealtimeSocket(url)));
  const api = installFakeApi(routesFor(orders, { 'POST /v1/realtime/ticket': 'realtime_ticket', ...overrides }));
  await renderRedesign('/orders/history');
  await waitFor(() => expect(sock).not.toBeNull());
  act(() => sock!.open());
  return { api, sock: () => sock! };
}

describe('realtime', () => {
  it('a new order rings in without taking focus; a re-sort keeps focus on the same order', async () => {
    const a = pending('A7K2', 150);
    const newcomer = pending('B3M9', 40);
    const { sock } = await withSocket([a], { [`GET /v1/restaurant/orders/${newcomer.id}`]: { body: newcomer } });
    const tile = await findTile('A7K2');
    act(() => tile.focus());
    act(() => sock().push(offeredFrame(newcomer.id, 'B3M9', 40, 1)));
    await findTile('B3M9');
    // Sorted first, but focus stays on A7K2.
    const labels = [...document.querySelectorAll('[data-offer-tile]')].map((t) => t.getAttribute('aria-label')!.split(',')[0]);
    expect(labels).toEqual(['New order B3M9', 'New order A7K2']);
    expect(document.activeElement).toBe(tileOf('A7K2'));
    await waitFor(() => expect(screen.getByTestId('announcer-polite').textContent).toMatch(/^New order B3M9, 3 items, (39|40) seconds to answer\.$/), {
      timeout: 4000,
    });
    // Filled from getRestaurantOrder: the earnings arrive.
    await waitFor(() => expect(tileOf('B3M9')!.getAttribute('aria-label')).toMatch(/\$79\.87$/));
  });

  it('shows the frame before the order view arrives (Offer-loading), and Accept already works', async () => {
    const o = pending('D2P6', 170);
    const route = `POST /v1/restaurant/orders/${o.id}/accept`;
    const { api, sock } = await withSocket([], {
      [`GET /v1/restaurant/orders/${o.id}`]: () => new Promise(() => {}),
      [route]: accepted(o),
    });
    act(() => sock().push(offeredFrame(o.id, 'D2P6', 170, 1)));
    const tile = await findTile('D2P6');
    expect(within(tile).getByText('Ayesha · 3 items')).toBeTruthy();
    expect(within(tile).getByText('Loading the rest of this order…')).toBeTruthy();
    expect(tile.getAttribute('aria-label')).not.toMatch(/\$/);
    fireEvent.click(within(tile).getByRole('button', { name: 'Accept order D2P6, ready in 20 minutes' }));
    await waitFor(() => expect(api.callsTo(route)).toHaveLength(1));
  });

  it('expired, withdrawn and payment-failed frames become outcome tiles', async () => {
    const [a, b, c] = [pending('A7K2', 120), pending('B3M9', 100), pending('C8T4', 90)];
    const { sock } = await withSocket([a, b, c]);
    await findTile('C8T4');
    act(() => {
      sock().push({ id: 'e1', seq: 1, channel: `restaurant:${PROFILE_ID}`, type: 'restaurant.order_offer_expired', data: { order_id: a.id, reason: 'timeout' } });
      sock().push({ id: 'e2', seq: 2, channel: `restaurant:${PROFILE_ID}`, type: 'restaurant.order_offer_withdrawn', data: { order_id: b.id, reason: 'customer_cancelled' } });
      sock().push({ id: 'e3', seq: 3, channel: `restaurant:${PROFILE_ID}`, type: 'restaurant.order_offer_withdrawn', data: { order_id: c.id, reason: 'payment_failed' } });
    });
    expect(await screen.findByText('Nobody answered in 3 minutes')).toBeTruthy();
    expect(screen.getByText('Customer cancelled')).toBeTruthy();
    expect(screen.getByText('The payment failed before you answered, so the order was withdrawn.')).toBeTruthy();
    expect(tileOf('B3M9')!.getAttribute('aria-label')).toBe('New order B3M9, Withdrawn');
    expect(screen.getByRole('region', { name: 'New orders' })).toBeTruthy();
  });

  it('accepted or declined on another screen: removed, with a toast that names the reason', async () => {
    const [a, b] = [pending('A7K2', 120), pending('B3M9', 100)];
    const { sock } = await withSocket([a, b]);
    await findTile('A7K2');
    act(() => {
      sock().push({ id: 'e1', seq: 1, channel: `restaurant:${PROFILE_ID}`, type: 'restaurant.order_accepted', data: { order_id: a.id, accepted_by: 'x', prep_eta_minutes: 20 } });
      sock().push({ id: 'e2', seq: 2, channel: `restaurant:${PROFILE_ID}`, type: 'restaurant.order_rejected', data: { order_id: b.id, rejected_by: 'x', reason_code: 'KITCHEN_AT_CAPACITY' } });
    });
    expect(await screen.findByText('A7K2 was accepted on another screen')).toBeTruthy();
    expect(screen.getByText('It’s in progress. Nothing else to do here.')).toBeTruthy();
    expect(screen.getByText('B3M9 was declined on another screen')).toBeTruthy();
    expect(screen.getByText('Reason given: Kitchen is too busy. The customer was not charged. It’s in History.')).toBeTruthy();
    await waitFor(() => expect(tileOf('A7K2')).toBeNull());
    expect(tileOf('B3M9')).toBeNull();
  });

  it('polls the pending list every 10 s while the socket is not open', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const api = installFakeApi(routesFor([]));
    await renderRedesign('/orders/history');
    await screen.findByText('No new orders');
    const before = api.callsTo('GET /v1/restaurant/orders').length;
    const o = pending('N3W1', 150);
    api.set('GET /v1/restaurant/orders', { body: [o] });
    api.set(`GET /v1/restaurant/orders/${o.id}`, { body: o });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_MS);
    });
    await findTile('N3W1');
    expect(api.callsTo('GET /v1/restaurant/orders').length).toBe(before + 1);
  });
});

// ── sound and the go-live gate ───────────────────────────────────────────────────────────

describe('go-live gate and sound', () => {
  it('gates /orders until the gesture: chime, notifications, wake lock; the switch is untouched', async () => {
    const wake = vi.fn(async () => ({ release: async () => {} }));
    Object.defineProperty(navigator, 'wakeLock', { value: { request: wake }, configurable: true });
    const requestPermission = vi.fn(async () => 'granted' as const);
    vi.stubGlobal('Notification', Object.assign(function Notification() {}, { permission: 'default', requestPermission }));
    const o = pending('A7K2', 150);
    const api = installFakeApi(routesFor([o], { [`POST /v1/restaurant/orders/${o.id}/accept`]: accepted(o) }));
    await renderRedesign('/orders');
    expect(await screen.findByRole('heading', { name: 'Turn on order sound and go live' })).toBeTruthy();
    expect(screen.getByText('Keep this screen open and on. If it closes or sleeps, new orders stop reaching you within 5 minutes.')).toBeTruthy();
    // The strip is hidden behind the gate, and nothing rings yet.
    expect(screen.queryByTestId('new-order-strip')).toBeNull();
    expect(FakeAudio.plays).toBe(0);

    fireEvent.click(screen.getByRole('button', { name: 'Turn on sound and go live' }));
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Turn on order sound and go live' })).toBeNull());
    expect(requestPermission).toHaveBeenCalledTimes(1);
    expect(wake).toHaveBeenCalledWith('screen');
    expect(api.callsTo('PATCH /v1/restaurant/availability')).toHaveLength(0);
    // One loop rings while the order waits…
    await findTile('A7K2');
    await waitFor(() => expect(FakeAudio.plays).toBeGreaterThanOrEqual(3)); // test chime + arm + first ring
    const loop = FakeAudio.instances.find((a) => a.src.startsWith('data:audio/wav;base64,'));
    expect(loop).toBeTruthy();
    // …and stops when it is accepted.
    const pausesBefore = FakeAudio.pauses;
    fireEvent.click(within(tileOf('A7K2')!).getByRole('button', { name: /^Accept order A7K2/ }));
    await waitFor(() => expect(tileOf('A7K2')).toBeNull());
    await waitFor(() => expect(FakeAudio.pauses).toBeGreaterThan(pausesBefore));
    delete (navigator as unknown as { wakeLock?: unknown }).wakeLock;
  });

  it('notifications blocked: says so, and offers to go live without them', async () => {
    vi.stubGlobal(
      'Notification',
      Object.assign(function Notification() {}, { permission: 'denied', requestPermission: vi.fn(async () => 'denied' as const) }),
    );
    installFakeApi(routesFor([]));
    await renderRedesign('/orders');
    fireEvent.click(await screen.findByRole('button', { name: 'Turn on sound and go live' }));
    expect(await screen.findByText('Step 2: notifications are blocked')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Check notifications again' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Go live without notifications' }));
    await waitFor(() => expect(screen.queryByTestId('go-live-gate')).toBeNull());
    expect(await screen.findByText('No new orders')).toBeTruthy();
  });

  it('a refused play() shows "Sound is blocked", and Turn sound back on re-arms', async () => {
    FakeAudio.reject = true;
    const o = pending('A7K2', 150);
    installFakeApi(routesFor([o]));
    await renderRedesign('/orders');
    fireEvent.click(await screen.findByRole('button', { name: 'Turn on sound and go live' }));
    expect(await screen.findByText('Sound is blocked')).toBeTruthy();
    expect(screen.getByText('Your browser stopped the order sound. New orders won’t ring until sound is back on.')).toBeTruthy();
    FakeAudio.reject = false;
    fireEvent.click(screen.getByRole('button', { name: 'Turn sound back on' }));
    await waitFor(() => expect(screen.queryByText('Sound is blocked')).toBeNull());
  });
});

describe('the strip on Live orders', () => {
  it('after going live, /orders shows the strip above the page, and A accepts the focused tile there too', async () => {
    const o = pending('A7K2', 150);
    const api = installFakeApi(routesFor([o], { [`POST /v1/restaurant/orders/${o.id}/accept`]: accepted(o) }));
    await renderRedesign('/orders', { live: true });
    const tile = await findTile('A7K2');
    // The gate is gone and the strip is the strip landmark, above the page body.
    expect(screen.queryByTestId('go-live-gate')).toBeNull();
    expect(document.getElementById('new-orders')!.contains(tile)).toBe(true);
    act(() => tile.focus());
    fireEvent.keyDown(tile, { key: 'a' });
    await waitFor(() => expect(api.callsTo(`POST /v1/restaurant/orders/${o.id}/accept`)).toHaveLength(1));
  });
});

// ── open state, compact row, connection, ended panels ────────────────────────────────────

const frameOn = (n: number, type: string, data: Record<string, unknown>) => ({
  id: `x-${type}-${n}`,
  seq: n,
  channel: `restaurant:${PROFILE_ID}`,
  type,
  data,
});

describe('strip around the board', () => {
  it('rule line and empty card follow the open state', async () => {
    const o = pending('A7K2', 120);
    installFakeApi(routesFor([o], { 'GET /v1/restaurant/availability': 'restaurant_open_state_paused' }));
    await renderRedesign('/orders/history');
    expect(await screen.findByText('Paused. These arrived before the pause and still need an answer.')).toBeTruthy();
    cleanup();
    installFakeApi(routesFor([], { 'GET /v1/restaurant/availability': 'restaurant_open_state_paused' }));
    await renderRedesign('/orders/history');
    expect(await screen.findByText('Paused until 2:32 pm')).toBeTruthy();
    expect(screen.getByText('New orders resume at 2:32 pm. Orders in progress still need finishing.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Resume now' })).toBeTruthy();
    cleanup();
    installFakeApi(routesFor([pending('B3M9', 100)], { 'GET /v1/restaurant/availability': 'restaurant_open_state_closed_toggle' }));
    await renderRedesign('/orders/history');
    expect(await screen.findByText('Arrived before you turned orders off. Each keeps its full 3 minutes.')).toBeTruthy();
  });

  it('with an offer open in the panel the strip is one compact row; Show all closes the panel', async () => {
    const [a, b] = [pending('A7K2', 120), pending('B3M9', 40)];
    installFakeApi(routesFor([a, b]));
    await renderRedesign(`/orders/history?panel=offer&order=${a.id}`);
    expect(await screen.findByText('2 new orders waiting')).toBeTruthy();
    expect(screen.getByText('A7K2 is open in the panel. Also waiting: B3M9 (timer shown).')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Show all 2 new orders' }));
    await waitFor(() => expect(screen.queryByRole('complementary')).toBeNull());
    await findTile('A7K2');
    await findTile('B3M9');
  });

  it('while reconnecting, Accept still works and says so; the success toast says the connection is coming back', async () => {
    const o = pending('A7K2', 120);
    const route = `POST /v1/restaurant/orders/${o.id}/accept`;
    const { api, sock } = await withSocket([o], { [route]: { status: 503, body: errorBody('SERVICE_UNAVAILABLE') } });
    const tile = await findTile('A7K2');
    act(() => sock().drop(1006));
    expect(await within(tile).findByText('Accept still works while reconnecting')).toBeTruthy();
    fireEvent.click(within(tile).getByRole('button', { name: /^Accept order A7K2/ }));
    expect(await within(tile).findByText('Couldn’t reach HalalGoes. Still waiting.')).toBeTruthy();
    api.set(route, accepted(o));
    fireEvent.click(within(tile).getByRole('button', { name: 'Try accept again, order A7K2, ready in 20 minutes' }));
    expect(await screen.findByText('A7K2 accepted')).toBeTruthy();
    expect(screen.getByText('It’s in progress. The live connection is still coming back.')).toBeTruthy();
  });

  it('offline, and offline with the API down too (Reconnect to accept)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const o = pending('A7K2', 170);
    const { api, sock } = await withSocket([o]);
    const tile = await findTile('A7K2');
    act(() => sock().drop(4400));
    expect(await within(tile).findByText('Offline: accept may fail')).toBeTruthy();
    api.set('GET /v1/restaurant/orders', { status: 503, body: errorBody('SERVICE_UNAVAILABLE') });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_MS);
    });
    expect(await within(tile).findByText('Can’t reach HalalGoes')).toBeTruthy();
    const accept = within(tile).getByRole('button', { name: 'Reconnect to accept, order A7K2, ready in 20 minutes' });
    expect(accept.getAttribute('aria-disabled')).toBe('true');
  });

  it('an order that ends while its panel is open keeps focus in the panel, with the reason', async () => {
    const o = pending('A7K2', 120);
    const { sock } = await withSocket([o]);
    await findTile('A7K2');
    fireEvent.click(within(tileOf('A7K2')!).getByText('A7K2'));
    const panel = await screen.findByRole('complementary', { name: 'Order A7K2 details' });
    act(() => sock().push(frameOn(1, 'restaurant.order_offer_withdrawn', { order_id: o.id, reason: 'customer_cancelled' })));
    expect(await within(panel).findByText('The customer cancelled')).toBeTruthy();
    const back = within(panel).getByRole('button', { name: 'Back to new orders' });
    await waitFor(() => expect(document.activeElement).toBe(back));
    expect(within(panel).getByText('Not charged')).toBeTruthy();
    expect(within(panel).queryByText('HalalGoes commission')).toBeNull();
    expect(within(panel).queryByRole('button', { name: /^Accept order/ })).toBeNull();
  });

  it('decline form: a new order rings meanwhile, then the open order times out', async () => {
    const [a, b] = [pending('A7K2', 120), pending('B3M9', 40)];
    const { sock } = await withSocket([a], { [`GET /v1/restaurant/orders/${b.id}`]: { body: b } });
    await findTile('A7K2');
    fireEvent.click(within(tileOf('A7K2')!).getByRole('button', { name: 'Decline order A7K2, choose a reason' }));
    const panel = await screen.findByRole('complementary', { name: 'Order A7K2 details' });
    act(() => sock().push(offeredFrame(b.id, 'B3M9', 40, 1)));
    expect(await within(panel).findByText(/^New order B3M9 just arrived · 0:(39|40) left$/)).toBeTruthy();
    expect(within(panel).getByText('It’s ringing in the strip above. Finish here, or choose Keep order to go back to it.')).toBeTruthy();
    act(() => sock().push(frameOn(2, 'restaurant.order_offer_expired', { order_id: a.id, reason: 'timeout' })));
    expect(await within(panel).findByText('Timed out while you were declining')).toBeTruthy();
    expect(within(panel).getByText('The decline window closed on its own. The customer was not charged.')).toBeTruthy();
  });

  it('a timeout with one missed order in a row warns before auto-off', async () => {
    const o = pending('A7K2', 120);
    const open = fixture('restaurant_open_state_open');
    const { sock } = await withSocket([o], { 'GET /v1/restaurant/availability': { body: { ...open, missed_order_count: 1 } } });
    await findTile('A7K2');
    act(() => sock().push(frameOn(1, 'restaurant.order_offer_expired', { order_id: o.id, reason: 'timeout' })));
    expect(await screen.findByText('1 order timed out')).toBeTruthy();
    expect(screen.getByText('One more in a row and new orders will stop until you turn them back on.')).toBeTruthy();
  });
});

// ── review fixes: stray keys, lost responses, own frames ─────────────────────────────────

const ACCEPT = (o: Order) => `POST /v1/restaurant/orders/${o.id}/accept`;
const settle = () => new Promise((r) => setTimeout(r, 50));

describe('a removal never puts focus on another live order', () => {
  it('the focused order accepted on another screen: focus goes to the heading, and A accepts nothing', async () => {
    const [a, b] = [pending('A7K2', 120), pending('B3M9', 150)];
    const { api, sock } = await withSocket([a, b], { [ACCEPT(a)]: accepted(a), [ACCEPT(b)]: accepted(b) });
    const tile = await findTile('A7K2');
    act(() => tile.focus());
    act(() => sock().push(frameOn(1, 'restaurant.order_accepted', { order_id: a.id, accepted_by: 'x', prep_eta_minutes: 20 })));
    await waitFor(() => expect(tileOf('A7K2')).toBeNull());
    await waitFor(() => expect(document.activeElement?.textContent).toBe('New orders'));
    key(document.activeElement!, 'a');
    await settle();
    expect(api.callsTo(ACCEPT(b))).toHaveLength(0);
    expect(api.callsTo(ACCEPT(a))).toHaveLength(0);
    expect(tileOf('B3M9')).not.toBeNull();
  });

  it('the focused outcome tile leaving after 60 s: focus goes to the heading, and A accepts nothing', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const [a, b] = [pending('A7K2', 120), pending('B3M9', 170)];
    const { api, sock } = await withSocket([a, b], { [ACCEPT(b)]: accepted(b) });
    const tile = await findTile('A7K2');
    act(() => tile.focus());
    act(() => sock().push(frameOn(1, 'restaurant.order_offer_expired', { order_id: a.id, reason: 'timeout' })));
    const note = await screen.findByText('Nobody answered in 3 minutes');
    await waitFor(() => expect(document.activeElement).toBe(note));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(61_000);
    });
    await waitFor(() => expect(tileOf('A7K2')).toBeNull());
    await waitFor(() => expect(document.activeElement?.textContent).toBe('New orders'));
    key(document.activeElement!, 'a');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    expect(api.callsTo(ACCEPT(b))).toHaveLength(0);
  });

  it('after the user’s own accept, focus moves on to the next order', async () => {
    const [a, b] = [pending('A7K2', 120), pending('B3M9', 150)];
    installFakeApi(routesFor([a, b], { [ACCEPT(a)]: accepted(a) }));
    await renderRedesign('/orders/history');
    const tile = await findTile('A7K2');
    act(() => tile.focus());
    key(tile, 'a');
    await waitFor(() => expect(tileOf('A7K2')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(tileOf('B3M9')));
  });
});

describe('an accept whose response is lost', () => {
  it('a 5xx re-reads the order first: accepted and paid shows as accepted, never as a failure', async () => {
    const o = pending('A7K2', 120);
    installFakeApi(
      routesFor([o], {
        [ACCEPT(o)]: { status: 502, body: errorBody('SERVICE_UNAVAILABLE') },
        [`GET /v1/restaurant/orders/${o.id}`]: accepted(o),
      }),
    );
    await renderRedesign('/orders/history');
    const tile = await findTile('A7K2');
    fireEvent.click(within(tile).getByRole('button', { name: /^Accept order A7K2/ }));
    expect(await screen.findByText('A7K2 accepted · ready by 2:51 pm')).toBeTruthy();
    expect(screen.queryByText('Couldn’t confirm. Still waiting for you.')).toBeNull();
    expect(screen.queryByText('A7K2 was accepted on another screen')).toBeNull();
    await waitFor(() => expect(tileOf('A7K2')).toBeNull());
  });

  it('the order_accepted frame that beat a lost response counts as this screen’s accept', async () => {
    const o = pending('A7K2', 120);
    let push: (f: unknown) => void = () => {};
    const { sock } = await withSocket([o], {
      [ACCEPT(o)]: async () => {
        push(frameOn(1, 'restaurant.order_accepted', { order_id: o.id, accepted_by: 'me', prep_eta_minutes: 20 }));
        await settle();
        return { status: 503, body: errorBody('SERVICE_UNAVAILABLE') };
      },
      // The re-read cannot reach the server either: the frame alone settles it.
      [`GET /v1/restaurant/orders/${o.id}`]: { status: 503, body: errorBody('SERVICE_UNAVAILABLE') },
    });
    push = (f) => act(() => sock().push(f as never));
    const tile = await findTile('A7K2');
    fireEvent.click(within(tile).getByRole('button', { name: /^Accept order A7K2/ }));
    expect(await screen.findByText('A7K2 accepted')).toBeTruthy();
    expect(screen.queryByText('A7K2 was accepted on another screen')).toBeNull();
    expect(screen.queryByText('Couldn’t confirm. Still waiting for you.')).toBeNull();
  });

  it('an accept-failed order is re-read at its deadline: accepted is never called a timeout', async () => {
    const o = pending('A7K2', 2);
    const api = installFakeApi(routesFor([o], { [ACCEPT(o)]: { status: 503, body: errorBody('SERVICE_UNAVAILABLE') } }));
    await renderRedesign('/orders/history');
    const tile = await findTile('A7K2');
    fireEvent.click(within(tile).getByRole('button', { name: /^Accept order A7K2/ }));
    expect(await within(tile).findByText('Couldn’t confirm. Still waiting for you.')).toBeTruthy();
    // The accept had gone through; only its response was lost.
    api.set(`GET /v1/restaurant/orders/${o.id}`, accepted(o));
    expect(await screen.findByText('A7K2 accepted · ready by 2:51 pm', undefined, { timeout: 4000 })).toBeTruthy();
    expect(screen.queryByText('Nobody answered in 3 minutes')).toBeNull();
  });

  it('locks the prep time once an accept has gone out under its key', async () => {
    const o = pending('A7K2', 120);
    const api = installFakeApi(routesFor([o], { [ACCEPT(o)]: { status: 503, body: errorBody('SERVICE_UNAVAILABLE') } }));
    await renderRedesign(`/orders/history?panel=offer&order=${o.id}`);
    const panel = await screen.findByRole('complementary', { name: 'Order A7K2 details' });
    fireEvent.click(await within(panel).findByRole('button', { name: 'Accept order A7K2, ready in 20 minutes' }));
    expect(await within(panel).findByText('We couldn’t confirm this order')).toBeTruthy();
    expect(within(panel).getByRole('button', { name: 'Less prep time for order A7K2' }).getAttribute('aria-disabled')).toBe('true');
    expect(within(panel).getByRole('button', { name: 'More prep time for order A7K2' }).getAttribute('aria-disabled')).toBe('true');
    api.set(ACCEPT(o), accepted(o));
    fireEvent.click(within(panel).getByRole('button', { name: 'Try accept again, order A7K2, ready in 20 minutes' }));
    await waitFor(() => expect(api.callsTo(ACCEPT(o))).toHaveLength(2));
    const calls = api.callsTo(ACCEPT(o));
    expect(calls[1]!.headers.get('Idempotency-Key')).toBe(calls[0]!.headers.get('Idempotency-Key'));
    for (const c of calls) expect(await c.json()).toEqual({ prep_eta_minutes: 20 });
  });
});

describe('a decline from this screen', () => {
  it('its own order_rejected frame arriving first is not "declined on another screen"', async () => {
    const o = pending('A7K2', 120);
    const route = `POST /v1/restaurant/orders/${o.id}/reject`;
    let push: (f: unknown) => void = () => {};
    const { sock } = await withSocket([o], {
      [route]: async () => {
        push(frameOn(1, 'restaurant.order_rejected', { order_id: o.id, rejected_by: 'me', reason_code: 'KITCHEN_AT_CAPACITY' }));
        await settle();
        return { body: fixture('restaurant_order_rejected') };
      },
    });
    push = (f) => act(() => sock().push(f as never));
    await findTile('A7K2');
    fireEvent.click(within(tileOf('A7K2')!).getByRole('button', { name: 'Decline order A7K2, choose a reason' }));
    const panel = await screen.findByRole('complementary', { name: 'Order A7K2 details' });
    fireEvent.click(within(panel).getByRole('radio', { name: 'Kitchen is too busy' }));
    fireEvent.click(within(panel).getByRole('button', { name: 'Decline order, order A7K2' }));
    expect(await screen.findByText('A7K2 declined')).toBeTruthy();
    expect(screen.queryByText('A7K2 was declined on another screen')).toBeNull();
  });
});
