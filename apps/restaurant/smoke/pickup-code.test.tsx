import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

import readyForPickup from '../../../contracts/fixtures/orders/restaurant_order_ready_for_pickup.json';
import { installDomShims } from '@hg/ui-web/testing';

/**
 * The kitchen reads the pickup code out to the rider, who types it in to confirm pickup — the
 * only way an order leaves the kitchen (issue #659; contract `OrderRestaurantView.pickup_code`).
 * The legacy order queue shows it, large and labelled, on a ready order, and nothing — never a
 * placeholder — when the field is absent.
 */

function queue(orders: unknown[]): Response {
  return new Response(JSON.stringify({ data: orders, meta: { next_cursor: null, has_more: false, total: orders.length } }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function renderOrders() {
  const { OrdersPage } = await import('../src/routes/OrdersPage');
  return render(<OrdersPage />);
}

describe('restaurant order queue — the pickup code', () => {
  beforeAll(installDomShims);

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    // The api client binds `fetch` at module-construction time; see order-queue-states.test.tsx.
    vi.resetModules();
  });

  it('shows the pickup code on a ready order, labelled as the code the rider must type', async () => {
    const order = readyForPickup.payload as { pickup_code: string };
    expect(order.pickup_code).toMatch(/^[0-9]{4}$/);
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = input instanceof Request ? input.url : String(input);
      return url.includes('/v1/restaurant/orders') ? queue([order]) : queue([]);
    });

    await renderOrders();

    const block = await screen.findByTestId('pickup-code');
    expect(block.textContent).toContain(order.pickup_code);
    expect(block.textContent).toMatch(/rider, who must type it in/);
  });

  it('shows no pickup code when the field is absent', async () => {
    const order = { ...(readyForPickup.payload as Record<string, unknown>), pickup_code: null };
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = input instanceof Request ? input.url : String(input);
      return url.includes('/v1/restaurant/orders') ? queue([order]) : queue([]);
    });

    await renderOrders();

    expect(await screen.findByText('Ready for pickup')).not.toBeNull();
    expect(screen.queryByTestId('pickup-code')).toBeNull();
  });
});
