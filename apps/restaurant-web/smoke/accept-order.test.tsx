import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ToastProvider, TooltipProvider } from '@hg/ui-web';

import pendingFixture from '../../../contracts/fixtures/orders/restaurant_order_restaurant_pending.json';

/**
 * The critical restaurant-side interaction: accepting an order. `RESTAURANT_PENDING` offers
 * accept + reject (§R-24/R-25); accepting posts to `/v1/restaurant/orders/{id}/accept`, which
 * captures the payment authorisation server-side (contract invariant: authorise then capture
 * on acceptance). This pins that the accept button is offered on a pending order, that
 * clicking it calls the accept endpoint with an idempotency key, and that the screen updates
 * to reflect the new (server-returned) state once it resolves.
 */

function stubOk(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function renderDetail(orderId: string) {
  // The api client binds `fetch` at construction time (module load), so the screen must be
  // imported dynamically, after the mock is installed — a static top-of-file import would
  // capture the real `fetch` before any spy exists.
  const { OrderDetailScreen } = await import('../src/screens/OrderDetailScreen');
  return render(
    <TooltipProvider>
      <ToastProvider>
        <MemoryRouter initialEntries={[`/orders/${orderId}`]}>
          <Routes>
            <Route path="/orders/:orderId" element={<OrderDetailScreen />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </TooltipProvider>,
  );
}

describe('restaurant accept-order', () => {
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
  });

  it('offers accept on a RESTAURANT_PENDING order and posts the accept transition', async () => {
    const orderId = pendingFixture.payload.id;
    const acceptedOrder = { ...pendingFixture.payload, state: 'PREPARING', accepted_at: '2026-08-10T18:41:00Z' };

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
      if (url.includes(`/v1/restaurant/orders/${orderId}/accept`) && method === 'POST') {
        return stubOk({ data: acceptedOrder });
      }
      if (url.includes(`/v1/restaurant/orders/${orderId}`)) {
        return stubOk({ data: pendingFixture.payload });
      }
      throw new Error(`unexpected fetch: ${method} ${url}`);
    });

    await renderDetail(orderId);

    const acceptButton = await screen.findByRole('button', { name: 'Accept order' });
    expect(screen.queryByRole('button', { name: 'Mark ready for pickup' })).toBeNull();

    acceptButton.click();

    // Posts the accept transition with an Idempotency-Key (contract requirement for a
    // capture-triggering mutation).
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

    // The screen reflects the server's new state: accept is gone, ready is now offered.
    await screen.findByRole('button', { name: 'Mark ready for pickup' });
    expect(screen.queryByRole('button', { name: 'Accept order' })).toBeNull();
  });
});
