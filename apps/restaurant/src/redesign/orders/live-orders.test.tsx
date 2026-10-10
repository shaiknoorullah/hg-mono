/**
 * WP4 — Live orders screen (wp4 spec §1, §4, §5): the In progress list against the contract
 * fixtures, the detail panel's states, Mark ready (Idempotency-Key reused on retry; 409
 * refetches), the pickup-code hand-off, and the #601 pin.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { FakeRealtimeSocket } from '@hg/ui-web/testing';
import { consoleRoutes, errorBody, fixture, installFakeApi, type Handler } from '../test/fakeApi';
import { renderRedesign } from '../test/render';
import { noteAcceptedHere } from './acceptedHere';
import type { Order } from './model';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const ids = {
  prep: '11111111-1111-4111-8111-111111111111',
  late: '22222222-2222-4222-8222-222222222222',
  ready: '33333333-3333-4333-8333-333333333333',
  out: '44444444-4444-4444-8444-444444444444',
  done: '55555555-5555-4555-8555-555555555555',
  delivered: '66666666-6666-4666-8666-666666666666',
  pending: '77777777-7777-4777-8777-777777777777',
};
const inMinutes = (m: number) => new Date(Date.now() + m * 60_000).toISOString();

function board() {
  const prep = fixture('restaurant_order_preparing');
  const ready = fixture('restaurant_order_ready_for_pickup');
  const out = fixture('restaurant_order_picked_up');
  return {
    prep: { ...prep, id: ids.prep, code: 'K7L8', is_late: false, promised_ready_at: inMinutes(12), special_instructions: null },
    late: { ...prep, id: ids.late, code: 'K7M4', is_late: true, promised_ready_at: inMinutes(-4) },
    ready: { ...ready, id: ids.ready, code: 'K7J1', ready_at: inMinutes(-3) },
    out: { ...out, id: ids.out, code: 'K7G5', ready_at: inMinutes(-20) },
    // Fixtures requested in #676 (COMPLETED / DELIVERED restaurant views): the #601 guard drops them.
    done: { ...out, id: ids.done, code: 'DONE1', state: 'COMPLETED' },
    delivered: { ...out, id: ids.delivered, code: 'DONE2', state: 'DELIVERED' },
    pending: { ...fixture('restaurant_order_restaurant_pending'), id: ids.pending, code: 'A7K2' },
  };
}

type Board = ReturnType<typeof board>;

/** The list plus `GET /orders/{id}` for each row. */
function boardRoutes(b: Board, extra: Record<string, Handler> = {}): Record<string, Handler> {
  const routes: Record<string, Handler> = {
    'GET /v1/restaurant/orders': { body: [b.done, b.prep, b.out, b.late, b.delivered, b.ready, b.pending] },
  };
  for (const o of Object.values(b)) routes[`GET /v1/restaurant/orders/${o.id}`] = { body: o };
  return consoleRoutes({ ...routes, ...extra });
}

const listRegion = () => screen.getByRole('region', { name: 'In progress' });
const codeButton = (code: string) => within(listRegion()).getByRole('button', { name: code });


/** The board's list reads (the strip's pending-list reads share the route). */
function boardListCalls(api: { callsTo: (route: string) => Request[] }): Request[] {
  return api.callsTo('GET /v1/restaurant/orders').filter((r) => new URL(r.url).searchParams.get('state') !== 'RESTAURANT_PENDING');
}

describe('In progress list', () => {
  it('#601: always sends the state filter and drops rows outside the live set', async () => {
    const b = board();
    const api = installFakeApi(boardRoutes(b));
    await renderRedesign('/orders', { live: true });
    await waitFor(() => expect(codeButton('K7L8')).toBeTruthy());
    // The strip (WP3) reads the pending list on the same route; the board's call is the other one.
    const url = new URL(boardListCalls(api)[0]!.url);
    expect(url.searchParams.get('state')).toBe('PREPARING,READY_FOR_PICKUP,PICKED_UP,ARRIVED,DISPUTED');
    const list = listRegion();
    expect(within(list).queryByText('DONE1')).toBeNull();
    expect(within(list).queryByText('DONE2')).toBeNull();
    // The strip owns the pending offer.
    expect(within(list).queryByText('A7K2')).toBeNull();
    expect(screen.getByTestId('in-progress-counts').textContent).toBe('Preparing 2 · Ready 1 · Out for delivery 1');
    // Ready first, then soonest ready time; out for delivery after the kitchen.
    const codes = within(list)
      .getAllByRole('button')
      .filter((el) => el.hasAttribute('data-order-open'))
      .map((el) => el.textContent);
    expect(codes).toEqual(['K7J1', 'K7M4', 'K7L8', 'K7G5']);
    expect(within(list).getByText('Ready first, then soonest ready time')).toBeTruthy();
  });

  it('shows each row’s state and action in words', async () => {
    installFakeApi(boardRoutes(board()));
    await renderRedesign('/orders', { live: true });
    await waitFor(() => expect(codeButton('K7J1')).toBeTruthy());
    const row = (code: string) => codeButton(code).closest('tr')!;
    expect(within(row('K7J1')).getByText('Ready')).toBeTruthy();
    expect(within(row('K7J1')).getByText('Waiting for pickup')).toBeTruthy();
    expect(within(row('K7M4')).getByText('Late')).toBeTruthy();
    expect(within(row('K7M4')).getByText(/· \d+ min late$/)).toBeTruthy();
    expect(within(row('K7M4')).getByText('Customer note')).toBeTruthy();
    expect(within(row('K7L8')).getByRole('button', { name: 'Mark order K7L8 ready' })).toBeTruthy();
    expect(within(row('K7G5')).getByText('Out for delivery')).toBeTruthy();
    expect(within(row('K7G5')).getByText('Read only')).toBeTruthy();
    // After a refresh there is no live phase: name and vehicle only.
    expect(within(row('K7G5')).getByText('Bilal S. · Scooter')).toBeTruthy();
  });

  it('empty: says nothing is in progress and how orders arrive', async () => {
    installFakeApi(consoleRoutes({ 'GET /v1/restaurant/orders': 'restaurant_order_queue_empty' }));
    await renderRedesign('/orders', { live: true });
    expect(await screen.findByText('Nothing in progress')).toBeTruthy();
    expect(screen.getByText('Orders you accept appear here, soonest ready time first. Ready orders stay until the rider picks them up.')).toBeTruthy();
  });

  it('loading: skeleton rows under the header', async () => {
    installFakeApi(consoleRoutes({ 'GET /v1/restaurant/orders': () => new Promise(() => {}) }));
    await renderRedesign('/orders', { live: true });
    await waitFor(() => expect(screen.getByTestId('in-progress').getAttribute('data-state')).toBe('loading'));
    expect(screen.getAllByTestId('in-progress-skeleton-row').length).toBeGreaterThan(0);
  });

  it('first load failed: a way out that recovers', async () => {
    const api = installFakeApi(consoleRoutes({ 'GET /v1/restaurant/orders': { status: 500, body: errorBody('INTERNAL_ERROR') } }));
    await renderRedesign('/orders', { live: true });
    expect(await screen.findByRole('heading', { name: 'We couldn’t load your orders' })).toBeTruthy();
    // Board-first-load-error: the status bar can't show anything as known (availability answered).
    const bar = screen.getByRole('region', { name: 'Service status' });
    await waitFor(() => expect(within(bar).getByTestId('health-badge').textContent).toBe('Not connected'));
    expect(within(bar).getByTestId('open-state-badge').textContent).toBe('Unknown');
    expect(within(bar).getByRole('switch', { name: /^Orders/ }).hasAttribute('disabled')).toBe(true);
    api.set('GET /v1/restaurant/orders', 'restaurant_order_queue_empty');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Nothing in progress')).toBeTruthy();
    await waitFor(() => expect(within(bar).getByTestId('open-state-badge').textContent).not.toBe('Unknown'));
    expect(within(bar).getByTestId('health-badge').textContent).not.toBe('Not connected');
  });

  it('refresh failed: keeps the rows, says so in the bar and a banner, and Try now recovers', async () => {
    const b = board();
    const api = installFakeApi(boardRoutes(b));
    await renderRedesign('/orders', { live: true });
    await waitFor(() => expect(codeButton('K7L8')).toBeTruthy());
    api.set('GET /v1/restaurant/orders', { status: 503, body: errorBody('SERVICE_UNAVAILABLE') });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    const banner = await screen.findByTestId('banner-stale');
    expect(within(banner).getByText('Couldn’t refresh')).toBeTruthy();
    expect(screen.getByTestId('stale-badge').textContent).toMatch(/^Last updated \d{1,2}:\d{2} [ap]m · may be out of date$/);
    expect(codeButton('K7L8')).toBeTruthy();
    api.set('GET /v1/restaurant/orders', { body: [b.prep] });
    fireEvent.click(within(banner).getByRole('button', { name: 'Try now' }));
    await waitFor(() => expect(screen.queryByTestId('banner-stale')).toBeNull());
    expect(screen.queryByTestId('stale-badge')).toBeNull();
  });
});

describe('Order detail panel', () => {
  it('preparing: heading takes focus; money, contact and the forest Mark ready; Escape returns to the row', async () => {
    installFakeApi(boardRoutes(board()));
    await renderRedesign('/orders', { live: true });
    await waitFor(() => expect(codeButton('K7M4')).toBeTruthy());
    fireEvent.click(codeButton('K7M4'));
    const panel = await screen.findByRole('complementary', { name: 'Order K7M4 details' });
    const heading = await within(panel).findByRole('heading', { name: 'K7M4' });
    expect(document.activeElement).toBe(heading);
    expect(within(panel).getByTestId('detail-badge').textContent).toBe('Preparing · late');
    expect(within(panel).getByText(/^Ready by .* min late$/)).toBeTruthy();
    const money = within(panel).getByRole('region', { name: 'Money' });
    expect(within(money).getByText('You earn')).toBeTruthy();
    expect(within(money).getAllByText('$79.87').length).toBeGreaterThan(0);
    // Accepted: the masked phone and the full address show.
    expect(within(panel).getByText('+1 416 ••• 0142')).toBeTruthy();
    expect(within(panel).getByText(/88 Harbour Street/)).toBeTruthy();
    const mark = within(panel).getByRole('button', { name: 'Mark order K7M4 ready' });
    expect(mark.getAttribute('data-variant')).toBe('secondary');
    expect(within(panel).getByText(/Running late, or can’t finish this order\?/)).toBeTruthy();
    expect(within(panel).getAllByRole('link', { name: 'Call support on +1 800 555 0199, quote order K7M4' }).length).toBeGreaterThan(0);
    expect(within(panel).getByText('There is no cancel button after you accept; support cancels if it has to.')).toBeTruthy();
    // The row in the panel is marked Open.
    expect(within(codeButton('K7M4').closest('tr')!).getByText('Open')).toBeTruthy();

    fireEvent.keyDown(panel, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('complementary', { name: 'Order K7M4 details' })).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(codeButton('K7M4')));
  });

  it('before acceptance: no phone and no address', async () => {
    const b = board();
    installFakeApi(boardRoutes(b));
    await renderRedesign(`/orders?order=${ids.pending}`, { live: true });
    const panel = await screen.findByRole('complementary', { name: 'Order A7K2 details' });
    await within(panel).findByText('Phone number and full address appear after you accept.');
    expect(within(panel).queryByText(b.pending.customer.phone_masked)).toBeNull();
    expect(within(panel).getByText(b.pending.delivery_area)).toBeTruthy();
  });

  it('an offer that ended before acceptance (CANCELLED, accepted_at null): no phone, no address, not charged', async () => {
    const b = board();
    const ended = { ...b.pending, state: 'CANCELLED', accepted_at: null };
    installFakeApi(boardRoutes(b, { [`GET /v1/restaurant/orders/${ids.pending}`]: { body: ended } }));
    await renderRedesign(`/orders?order=${ids.pending}`, { live: true });
    const panel = await screen.findByRole('complementary', { name: 'Order A7K2 details' });
    await within(panel).findByText('Not charged');
    expect(within(panel).queryByText(b.pending.customer.phone_masked)).toBeNull();
    expect(within(panel).queryByText('HalalGoes commission')).toBeNull();
    expect(within(panel).getByText(b.pending.delivery_area)).toBeTruthy();
  });

  it('out for delivery: read only, no footer', async () => {
    installFakeApi(boardRoutes(board()));
    await renderRedesign(`/orders?order=${ids.out}`, { live: true });
    const panel = await screen.findByRole('complementary', { name: 'Order K7G5 details' });
    await within(panel).findByText('Read only. Nothing to do; it leaves this list when delivered.');
    expect(within(panel).queryByRole('button', { name: /Mark order/ })).toBeNull();
  });

  it('lines render variants[] when present, else variant_name', async () => {
    const choice = (group_name: string, variant_name: string) => ({ variant_group_id: `g-${group_name}`, group_name, variant_id: `v-${variant_name}`, variant_name, pricing_mode: 'DELTA', price_cents: null, delta_cents: 0 });
    const b = board();
    const lines = b.prep.lines.map((l: Record<string, unknown>, i: number) => (i === 0 ? { ...l, variant_name: 'Large, Spicy', variants: [choice('Size', 'Large'), choice('Heat', 'Spicy')] } : l));
    installFakeApi(boardRoutes(b, { [`GET /v1/restaurant/orders/${ids.prep}`]: { body: { ...b.prep, lines } } }));
    await renderRedesign(`/orders?order=${ids.prep}`, { live: true });
    const panel = await screen.findByRole('complementary', { name: 'Order K7L8 details' });
    expect(await within(panel).findByText('Large · Spicy')).toBeTruthy();
    expect(within(panel).getByText('Full')).toBeTruthy();
  });

  it('loading, then not found for a bad link', async () => {
    let release: () => void = () => {};
    installFakeApi(
      boardRoutes(board(), {
        'GET /v1/restaurant/orders/99999999-9999-4999-8999-999999999999': () =>
          new Promise((resolve) => {
            release = () => resolve({ status: 404, body: errorBody('NOT_FOUND') });
          }),
      }),
    );
    await renderRedesign('/orders?order=99999999-9999-4999-8999-999999999999', { live: true });
    expect(await screen.findByText(/^Loading order/)).toBeTruthy();
    act(() => release());
    const panel = await screen.findByRole('complementary', { name: 'Order details' });
    expect(await within(panel).findByText('We can’t show this order')).toBeTruthy();
    expect(within(panel).getByText(/isn’t one of .*’s orders, or the link is wrong\. Nothing else is affected\./)).toBeTruthy();
    fireEvent.click(within(panel).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('complementary', { name: 'Order details' })).toBeNull());
  });

  it('load error: says the list keeps working, Try again recovers', async () => {
    const b = board();
    const api = installFakeApi(boardRoutes(b, { [`GET /v1/restaurant/orders/${ids.prep}`]: { status: 500, body: errorBody('INTERNAL_ERROR') } }));
    await renderRedesign(`/orders?order=${ids.prep}`, { live: true });
    const title = await screen.findByText('We couldn’t load this order');
    const alert = title.closest('[role="alert"]') as HTMLElement;
    expect(alert).toBeTruthy();
    expect(within(alert).getByText('Check the connection. The list and new orders keep working while this panel retries.')).toBeTruthy();
    api.set(`GET /v1/restaurant/orders/${ids.prep}`, { body: b.prep });
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('button', { name: 'Mark order K7L8 ready' })).toBeTruthy();
  });

  it('support off: no dead links, the contact line says support is off', async () => {
    installFakeApi(
      boardRoutes(board(), { 'GET /v1/config/public': { body: { ...fixture('public_config'), support_enabled: false, support_phone_e164: null, support_hours: null } } }),
    );
    await renderRedesign(`/orders?order=${ids.prep}`, { live: true });
    const panel = await screen.findByRole('complementary', { name: 'Order K7L8 details' });
    expect(await within(panel).findByText('Contact with the customer goes through HalalGoes support, which is off right now.')).toBeTruthy();
    expect(within(panel).queryByRole('link', { name: /Call support/ })).toBeNull();
  });
});

describe('Mark ready', () => {
  it('a network failure keeps the same Idempotency-Key for the retry', async () => {
    const b = board();
    let n = 0;
    const api = installFakeApi(
      boardRoutes(b, {
        [`POST /v1/restaurant/orders/${ids.prep}/ready`]: () => {
          n += 1;
          if (n === 1) throw new TypeError('Failed to fetch');
          return { body: { ...b.prep, state: 'READY_FOR_PICKUP', ready_at: new Date().toISOString() } };
        },
      }),
    );
    await renderRedesign('/orders', { live: true });
    await waitFor(() => expect(codeButton('K7L8')).toBeTruthy());
    fireEvent.click(within(codeButton('K7L8').closest('tr')!).getByRole('button', { name: 'Mark order K7L8 ready' }));
    await waitFor(() => expect(within(codeButton('K7L8').closest('tr')!).getByText('Not marked ready')).toBeTruthy());
    fireEvent.click(within(codeButton('K7L8').closest('tr')!).getByRole('button', { name: 'Try marking order K7L8 ready again' }));
    await waitFor(() => expect(within(codeButton('K7L8').closest('tr')!).getByText('Ready')).toBeTruthy());
    const calls = api.callsTo(`POST /v1/restaurant/orders/${ids.prep}/ready`);
    expect(calls).toHaveLength(2);
    const k1 = calls[0]!.headers.get('Idempotency-Key');
    expect(k1).toBeTruthy();
    expect(calls[1]!.headers.get('Idempotency-Key')).toBe(k1);
  });

  it('just accepted: drawn at the top, a mark-ready failure still shows, and a refresh lets it sort normally', async () => {
    const b = board();
    const accepted = { ...b.prep, id: ids.pending, code: 'A7K2', promised_ready_at: inMinutes(30) } as unknown as Order;
    const api = installFakeApi(boardRoutes(b, { [`POST /v1/restaurant/orders/${ids.pending}/ready`]: { status: 503, body: errorBody('SERVICE_UNAVAILABLE') } }));
    await renderRedesign('/orders', { live: true });
    await waitFor(() => expect(codeButton('K7L8')).toBeTruthy());
    act(() => noteAcceptedHere(accepted));
    const row = () => codeButton('A7K2').closest('tr')!;
    await waitFor(() => expect(within(row()).getByText('Just accepted')).toBeTruthy());
    const codes = () => within(listRegion()).getAllByRole('button').map((x) => x.textContent).filter((t) => /^[A-Z0-9]{4,5}$/.test(t ?? ''));
    expect(codes()[0]).toBe('A7K2');
    // Mark ready fails: the failure is not hidden behind "Just accepted".
    fireEvent.click(within(row()).getByRole('button', { name: 'Mark order A7K2 ready' }));
    await waitFor(() => expect(within(row()).getByText('Not marked ready')).toBeTruthy());
    expect(within(row()).getByRole('button', { name: 'Try marking order A7K2 ready again' })).toBeTruthy();
    expect(within(row()).queryByText('Just accepted')).toBeNull();
    // Another order accepted here is pinned at the top until the next list refresh, then sorts
    // by its ready time like any other preparing row.
    const second = { ...b.prep, id: ids.done, code: 'B3M9', promised_ready_at: inMinutes(40) } as unknown as Order;
    act(() => noteAcceptedHere(second));
    await waitFor(() => expect(codes()[0]).toBe('B3M9'));
    api.set('GET /v1/restaurant/orders', { body: [b.prep, b.late, b.ready, accepted, second] });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await waitFor(() => expect(codes()[0]).not.toBe('B3M9'));
    const secondRow = codeButton('B3M9').closest('tr')!;
    expect(within(secondRow).getByText('Preparing')).toBeTruthy();
    expect(codes().at(-1)).toBe('B3M9');
  });

  it('accepting in the strip puts the order at the top of the board as "Just accepted"', async () => {
    const b = board();
    const offer = { ...b.pending, state: 'RESTAURANT_PENDING', deadline_at: new Date(Date.now() + 120_000).toISOString() };
    const accepted = { ...b.prep, id: ids.pending, code: 'A7K2', promised_ready_at: inMinutes(20) };
    installFakeApi(
      boardRoutes(b, {
        'GET /v1/restaurant/orders': (req) =>
          new URL(req.url).searchParams.get('state') === 'RESTAURANT_PENDING' ? { body: [offer] } : { body: [b.prep, b.ready] },
        [`GET /v1/restaurant/orders/${ids.pending}`]: { body: offer },
        [`POST /v1/restaurant/orders/${ids.pending}/accept`]: { body: accepted },
      }),
    );
    await renderRedesign('/orders', { live: true });
    await waitFor(() => expect(codeButton('K7L8')).toBeTruthy());
    const accept = await screen.findByRole('button', { name: /^Accept order A7K2/ });
    fireEvent.click(accept);
    await waitFor(() => expect(codeButton('A7K2')).toBeTruthy());
    const row = codeButton('A7K2').closest('tr')!;
    expect(within(row).getByText('Just accepted')).toBeTruthy();
    const codes = within(listRegion()).getAllByRole('button').map((x) => x.textContent).filter((t) => /^[A-Z0-9]{4,5}$/.test(t ?? ''));
    expect(codes[0]).toBe('A7K2');
  });

  it('the panel says the rider has not been told when marking fails', async () => {
    installFakeApi(boardRoutes(board(), { [`POST /v1/restaurant/orders/${ids.prep}/ready`]: { status: 503, body: errorBody('SERVICE_UNAVAILABLE') } }));
    await renderRedesign(`/orders?order=${ids.prep}`, { live: true });
    const panel = await screen.findByRole('complementary', { name: 'Order K7L8 details' });
    fireEvent.click(await within(panel).findByRole('button', { name: 'Mark order K7L8 ready' }));
    expect(await within(panel).findByText('We couldn’t mark K7L8 ready')).toBeTruthy();
    expect(within(panel).getByText('The rider hasn’t been told yet. Check the connection and try again. It won’t be sent twice.')).toBeTruthy();
  });

  it('a 409 refusal says so and refetches the list', async () => {
    const b = board();
    let release: () => void = () => {};
    let listCalls = 0;
    const api = installFakeApi(
      boardRoutes(b, {
        'GET /v1/restaurant/orders': (req) => {
          // The strip's pending-list reads are not the board's.
          if (new URL(req.url).searchParams.get('state') === 'RESTAURANT_PENDING') return { body: [] };
          listCalls += 1;
          if (listCalls === 1) return { body: [b.prep, b.ready] };
          return new Promise((resolve) => {
            release = () => resolve({ body: [{ ...b.prep, state: 'READY_FOR_PICKUP', ready_at: new Date().toISOString() }, b.ready] });
          });
        },
        [`POST /v1/restaurant/orders/${ids.prep}/ready`]: { status: 409, body: { error: { code: 'ILLEGAL_TRANSITION', message: 'no', request_id: 't', details: [] } } },
      }),
    );
    await renderRedesign('/orders', { live: true });
    await waitFor(() => expect(codeButton('K7L8')).toBeTruthy());
    fireEvent.click(within(codeButton('K7L8').closest('tr')!).getByRole('button', { name: 'Mark order K7L8 ready' }));
    const row = () => codeButton('K7L8').closest('tr')!;
    await waitFor(() => expect(within(row()).getByText('Can’t mark ready now')).toBeTruthy());
    expect(within(row()).getByText('List refreshing')).toBeTruthy();
    act(() => release());
    await waitFor(() => expect(within(row()).getByText('Ready')).toBeTruthy());
    expect(boardListCalls(api).length).toBeGreaterThanOrEqual(2);
  });
});

/** A socket the realtime connection dials in tests; events are pushed by the test. */
class TestSocket extends FakeRealtimeSocket {
  static all: TestSocket[] = [];
  constructor(url: string) {
    super(url);
    TestSocket.all.push(this);
    setTimeout(() => this.open(), 0);
  }
}

async function liveSocket(): Promise<TestSocket> {
  await waitFor(() => expect(TestSocket.all.length).toBeGreaterThan(0));
  const sock = TestSocket.all[TestSocket.all.length - 1]!;
  await waitFor(() => expect(sock.readyState).toBe(1));
  return sock;
}

let seq = 0;
function push(sock: TestSocket, channel: string, type: string, data: object) {
  seq += 1;
  act(() => sock.push({ id: `t-${seq}`, seq, channel, type, data }));
}

describe('hand-off and live events', () => {
  function withSocket(b: Board, extra: Record<string, Handler> = {}) {
    TestSocket.all = [];
    vi.stubGlobal('WebSocket', TestSocket);
    return installFakeApi(boardRoutes(b, { 'POST /v1/realtime/ticket': 'realtime_ticket', ...extra }));
  }

  it('rider here on a ready order: hand-off line and the pickup code (#290 shape)', async () => {
    const b = board();
    withSocket(b, { [`GET /v1/restaurant/orders/${ids.ready}`]: { body: { ...b.ready, pickup_code: '4827' } } });
    await renderRedesign('/orders', { live: true });
    await waitFor(() => expect(codeButton('K7J1')).toBeTruthy());
    const sock = await liveSocket();
    await waitFor(() => expect(screen.getByTestId('health-badge').textContent).toBe('Live'));
    push(sock, `order:${ids.ready}`, 'dispatch.state_changed', { order_id: ids.ready, from: 'ASSIGNED', to: 'AT_RESTAURANT', at: new Date().toISOString() });
    const row = codeButton('K7J1').closest('tr')!;
    await waitFor(() => expect(within(row).getByText('Ready · rider here')).toBeTruthy());
    expect(within(row).getByText('Read the pickup code to the rider')).toBeTruthy();
    fireEvent.click(codeButton('K7J1'));
    const panel = await screen.findByRole('complementary', { name: 'Order K7J1 details' });
    expect(await within(panel).findByText('Hand bag K7J1 to Bilal S.')).toBeTruthy();
    expect(within(panel).getByRole('group', { name: 'Pickup code 4 8 2 7' })).toBeTruthy();
    expect(within(panel).queryByTestId('pickup-code-error')).toBeNull();
  });

  it('rider here but no pickup code yet: the code-error state, never a blank slot', async () => {
    const b = board();
    withSocket(b, { [`GET /v1/restaurant/orders/${ids.ready}`]: { body: { ...b.ready, pickup_code: null } } });
    await renderRedesign('/orders', { live: true });
    await waitFor(() => expect(codeButton('K7J1')).toBeTruthy());
    const sock = await liveSocket();
    push(sock, `order:${ids.ready}`, 'dispatch.state_changed', { order_id: ids.ready, from: 'ASSIGNED', to: 'AT_RESTAURANT', at: new Date().toISOString() });
    await waitFor(() => expect(within(codeButton('K7J1').closest('tr')!).getByText('Ready · rider here')).toBeTruthy());
    fireEvent.click(codeButton('K7J1'));
    const panel = await screen.findByRole('complementary', { name: 'Order K7J1 details' });
    const error = await within(panel).findByTestId('pickup-code-error');
    expect(error.getAttribute('role')).toBe('alert');
    expect(within(error).getByText('We couldn’t load the pickup code')).toBeTruthy();
    expect(within(error).getByText('Still missing? Call support, they can read it to you.')).toBeTruthy();
    expect(within(error).getByRole('link', { name: 'Call support on +1 800 555 0199' })).toBeTruthy();
    expect(within(error).getByRole('button', { name: 'Try again' })).toBeTruthy();
    expect(within(panel).queryByRole('group', { name: /^Pickup code/ })).toBeNull();
  });

  it('no pickup code before the rider is here', async () => {
    const b = board();
    withSocket(b, { [`GET /v1/restaurant/orders/${ids.ready}`]: { body: { ...b.ready, pickup_code: '4827' } } });
    await renderRedesign(`/orders?order=${ids.ready}`, { live: true });
    const panel = await screen.findByRole('complementary', { name: 'Order K7J1 details' });
    await within(panel).findByText('Bilal S. · Scooter');
    expect(within(panel).queryByRole('group', { name: /^Pickup code/ })).toBeNull();
    expect(within(panel).queryByTestId('pickup-code-error')).toBeNull();
  });

  it('cancelled while preparing: stop, with Remove; ready on another screen says so', async () => {
    const b = board();
    withSocket(b);
    await renderRedesign('/orders', { live: true });
    await waitFor(() => expect(codeButton('K7L8')).toBeTruthy());
    const sock = await liveSocket();
    push(sock, `order:${ids.prep}`, 'order.cancelled', { order_id: ids.prep, reason_code: 'CUSTOMER_CANCELLED', by: 'SUPPORT', refund: null });
    const row = () => codeButton('K7L8').closest('tr')!;
    await waitFor(() => expect(within(row()).getByText('Cancelled · stop')).toBeTruthy());
    expect(screen.getByTestId('in-progress-counts').textContent).toBe('Preparing 1 · Ready 1 · Out for delivery 1');
    fireEvent.click(within(row()).getByRole('button', { name: 'Remove order K7L8 from the list' }));
    await waitFor(() => expect(within(listRegion()).queryByRole('button', { name: 'K7L8' })).toBeNull());

    push(sock, `order:${ids.late}`, 'order.state_changed', {
      order_id: ids.late,
      from: 'PREPARING',
      to: 'READY_FOR_PICKUP',
      at: new Date().toISOString(),
      reason: null,
      actor_kind: 'RESTAURANT',
      deadline_at: inMinutes(30),
      eta_at: null,
    });
    await waitFor(() => expect(within(codeButton('K7M4').closest('tr')!).getByText('Ready · marked on another screen')).toBeTruthy());
    expect(await screen.findByText('K7M4 was marked ready on another screen')).toBeTruthy();
  });
});
