import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';

import queueBusy from '../../../contracts/fixtures/orders/restaurant_order_queue_busy.json';
import { setToken } from '../src/lib/token';

/**
 * One smoke test. The dashboard mounts, calls the one real GET the mock serves for this
 * surface (`listRestaurantOrders` — `GET /v1/restaurant/orders`), and renders the queue
 * with `@hg/ui-web`'s DataTable. `fetch` is stubbed with the contract fixture so the test
 * exercises the real fetch → parse → render path without a server, and asserts that the
 * fixture's order codes reach the DOM and that nothing logged an unexpected console error.
 */

const fixture = queueBusy as { payload: unknown[]; meta: unknown };

function stubOk(body: unknown): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })) as unknown as typeof fetch;
}

describe('restaurant dashboard smoke', () => {
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
    (window as unknown as { scrollTo: unknown }).scrollTo = () => {};
    Element.prototype.scrollIntoView = function scrollIntoView() {};
    (Element.prototype as unknown as { hasPointerCapture: unknown }).hasPointerCapture = () => false;
    (Element.prototype as unknown as { releasePointerCapture: unknown }).releasePointerCapture = () => {};
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    setToken(null);
  });

  it('fetches the order queue and renders it', async () => {
    // Behind the login gate: every protected fetch requires a session.
    setToken('test-access-token');
    // The listRestaurantOrders 200 body is `{ data: OrderRestaurantView[], meta }`.
    vi.stubGlobal('fetch', stubOk({ data: fixture.payload, meta: fixture.meta }));

    const errors: string[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((...args) => {
      errors.push(args.map((a) => String(a)).join(' '));
    });

    const { Root } = await import('../src/App');
    const { container } = render(<Root />);

    // The busy fixture carries these order codes; they only appear after the fetch resolves.
    await waitFor(() => {
      expect(container.textContent).toContain('HG-RENG-18X');
    });
    expect(container.textContent).toContain('HG-4K2M-9T');
    // The table caption is always present.
    expect(container.querySelector('#order-queue')).not.toBeNull();

    spy.mockRestore();
    expect(errors).toEqual([]);
  });
});
