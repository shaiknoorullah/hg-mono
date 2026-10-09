import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';

import pendingFixture from '../../../contracts/fixtures/orders/restaurant_order_restaurant_pending.json';
import preparingFixture from '../../../contracts/fixtures/orders/restaurant_order_preparing.json';

/**
 * The critical restaurant-side interaction: accepting an order. `RESTAURANT_PENDING` offers
 * accept + reject; accepting posts to `/v1/restaurant/orders/{id}/accept`, which captures the
 * payment authorisation server-side (AGENTS.md invariant #5: authorise then capture on
 * acceptance). This pins that the accept button is offered on a pending order and that
 * clicking it calls the accept endpoint with an idempotency key attached — salvaged and
 * adapted from the abandoned `apps/restaurant-web` stub's `accept-order.test.tsx` to this
 * app's card-grid `OrdersPage` instead of its old `OrderDetailScreen`.
 */

function stubOk(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

function stubError(status: number, code: string, message: string): Response {
  return new Response(JSON.stringify({ error: { code, message, request_id: 'req-1' } }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const list = (orders: unknown[]) => ({ data: orders, meta: { next_cursor: null, has_more: false, total: orders.length } });

interface Sent {
  method: string;
  path: string;
  body: string;
  idempotencyKey: string | null;
}

/**
 * Records every request, answers the queue `GET` from `queue()` (re-read on each poll) and
 * every other request from `write`. The profile lookup for the rider map is best-effort and
 * answered with a 404.
 */
function stubQueue(queue: () => unknown[], write: (sent: Sent) => Response): Sent[] {
  const sent: Sent[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const request = input instanceof Request ? input : new Request(String(input));
    const call: Sent = {
      method: request.method,
      path: new URL(request.url).pathname,
      body: request.method === 'GET' ? '' : await request.clone().text(),
      idempotencyKey: request.headers.get('Idempotency-Key'),
    };
    sent.push(call);
    if (call.path === '/v1/restaurant/profile') return stubError(404, 'NOT_FOUND', 'No profile');
    if (call.method === 'GET' && call.path === '/v1/restaurant/orders') return stubOk(list(queue()));
    return write(call);
  });
  return sent;
}

const queueReads = (sent: Sent[]) => sent.filter((c) => c.method === 'GET' && c.path === '/v1/restaurant/orders').length;

describe('restaurant orders — accept', () => {
  beforeAll(() => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: (query: string) => ({
        matches: false, media: query, onchange: null,
        addListener: () => {}, removeListener: () => {},
        addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
      }),
    });
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {} unobserve() {} disconnect() {}
    };
    Element.prototype.scrollIntoView = function scrollIntoView() {};
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('offers Accept on a RESTAURANT_PENDING order and posts the accept transition with an idempotency key', async () => {
    const orderId = pendingFixture.payload.id;
    const acceptedOrder = { ...pendingFixture.payload, state: 'PREPARING', accepted_at: '2026-08-10T18:41:00Z' };

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
      if (url.includes(`/v1/restaurant/orders/${orderId}/accept`) && method === 'POST') {
        return stubOk({ data: acceptedOrder });
      }
      if (url.includes('/v1/restaurant/orders')) {
        return stubOk({ data: [pendingFixture.payload], meta: { next_cursor: null, has_more: false, total: 1 } });
      }
      throw new Error(`unexpected fetch: ${method} ${url}`);
    });

    const { OrdersPage } = await import('../src/routes/OrdersPage');
    render(<OrdersPage />);

    const acceptButton = await screen.findByRole('button', { name: 'Accept' });
    acceptButton.click();

    await waitFor(() => {
      const acceptCall = fetchSpy.mock.calls.find((call) => {
        const first = call[0];
        const url = first instanceof Request ? first.url : String(first);
        return url.includes('/accept');
      });
      expect(acceptCall).toBeDefined();
    });
    const acceptCall = fetchSpy.mock.calls.find((call) => {
      const first = call[0];
      const url = first instanceof Request ? first.url : String(first);
      return url.includes('/accept');
    })!;
    const [firstArg, init] = acceptCall;
    const headers = firstArg instanceof Request ? firstArg.headers : new Headers(init?.headers);
    expect(headers.get('Idempotency-Key')).toBeTruthy();
  });

  it('keeps the order on screen and says why when the accept is refused', async () => {
    stubQueue(
      () => [pendingFixture.payload],
      () => stubError(409, 'ILLEGAL_TRANSITION', 'This order has already timed out.'),
    );

    const { OrdersPage } = await import('../src/routes/OrdersPage');
    const { container } = render(<OrdersPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Accept' }));

    expect((await screen.findByRole('alert')).textContent).toBe('This order has already timed out.');
    expect(container.textContent).toContain(pendingFixture.payload.code);
    expect(screen.getByRole('button', { name: 'Accept' })).not.toBeNull();
  });

  it('marks a preparing order ready for pickup with an idempotency key, then refreshes the queue', async () => {
    let state = 'PREPARING';
    const sent = stubQueue(
      () => [{ ...preparingFixture.payload, state }],
      () => {
        state = 'READY_FOR_PICKUP';
        return stubOk({ data: { ...preparingFixture.payload, state } });
      },
    );

    const { OrdersPage } = await import('../src/routes/OrdersPage');
    render(<OrdersPage />);
    // A pending order offers accept/reject only; "ready" belongs to the kitchen column.
    fireEvent.click(await screen.findByRole('button', { name: 'Mark ready for pickup' }));

    await waitFor(() => expect(screen.getByText('Ready for pickup')).not.toBeNull());
    const ready = sent.find((c) => c.method === 'POST')!;
    expect(ready.path).toBe(`/v1/restaurant/orders/${preparingFixture.payload.id}/ready`);
    expect(ready.idempotencyKey).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Mark ready for pickup' })).toBeNull();
    expect(queueReads(sent)).toBe(2);
  });

  it('shows the server message when marking ready fails', async () => {
    stubQueue(
      () => [preparingFixture.payload],
      () => stubError(409, 'ILLEGAL_TRANSITION', 'The order was cancelled.'),
    );

    const { OrdersPage } = await import('../src/routes/OrdersPage');
    render(<OrdersPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Mark ready for pickup' }));

    expect((await screen.findByRole('alert')).textContent).toBe('The order was cancelled.');
  });

  it('rejects with a reason code (voiding the authorisation server-side), then drops the order from the queue', async () => {
    let orders: unknown[] = [pendingFixture.payload];
    const sent = stubQueue(
      () => orders,
      () => {
        orders = [];
        return stubOk({ data: { ...pendingFixture.payload, state: 'RESTAURANT_REJECTED' } });
      },
    );

    const { OrdersPage } = await import('../src/routes/OrdersPage');
    render(<OrdersPage />);

    // Cancelling the dialog writes nothing.
    fireEvent.click(await screen.findByRole('button', { name: 'Reject' }));
    expect(await screen.findByText(`Reject order #${pendingFixture.payload.code}`)).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByText(`Reject order #${pendingFixture.payload.code}`)).toBeNull());
    expect(sent.some((c) => c.method === 'POST')).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
    fireEvent.change(await screen.findByLabelText('Reason', { exact: false }), { target: { value: 'KITCHEN_AT_CAPACITY' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reject order' }));

    expect(await screen.findByText('No live orders')).not.toBeNull();
    const reject = sent.find((c) => c.method === 'POST')!;
    expect(reject.path).toBe(`/v1/restaurant/orders/${pendingFixture.payload.id}/reject`);
    expect(reject.idempotencyKey).toBeTruthy();
    expect(JSON.parse(reject.body)).toEqual({ reason_code: 'KITCHEN_AT_CAPACITY' });
    expect(screen.queryByText(`Reject order #${pendingFixture.payload.code}`)).toBeNull();
  });
});
