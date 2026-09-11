import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';

import pendingFixture from '../../../contracts/fixtures/orders/restaurant_order_restaurant_pending.json';

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
});
