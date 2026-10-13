import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';

import queueBusy from '../../../contracts/fixtures/orders/restaurant_order_queue_busy.json';
import queueEmpty from '../../../contracts/fixtures/orders/restaurant_order_queue_empty.json';
import { installDomShims } from '@hg/ui-web/testing';

/**
 * `OrdersPage` drives all three states — loading, empty (queue drained, a *positive* tone —
 * not "no records yet") and error — never a happy-path-only render (AGENTS.md §6). Salvaged
 * and adapted from the abandoned `apps/restaurant-web` stub's `queue-states.test.tsx`: this
 * app's queue is a card grid, not `@hg/ui-web`'s `DataTable`, so the assertions target
 * `OrdersPage`'s own markup instead of `DataTable`'s `data-testid`s.
 */

function stubOk(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

function neverResolves(): Promise<Response> {
  return new Promise(() => {});
}

async function renderOrders() {
  const { OrdersPage } = await import('../src/routes/OrdersPage');
  return render(<OrdersPage />);
}

describe('restaurant order queue — loading, empty, error, rows', () => {
  beforeAll(installDomShims);

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    // The api client binds `fetch` at module-construction time; force a fresh module graph
    // so the next test's mock isn't shadowed by a client instance captured against this one.
    vi.resetModules();
  });

  it('shows a loading state while the fetch is in flight', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(neverResolves);

    await renderOrders();

    expect(screen.getByRole('status')).not.toBeNull();
    expect(screen.getByText('Loading the order queue…')).not.toBeNull();
  });

  it('shows the positive drained-queue empty state for zero orders', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(stubOk({ data: queueEmpty.payload, meta: { next_cursor: null, has_more: false, total: 0 } }));

    await renderOrders();

    const empty = await screen.findByTestId('empty-state');
    expect(empty.getAttribute('data-tone')).toBe('positive');
    expect(screen.getByText('No live orders')).not.toBeNull();
  });

  it('shows the error state with a retry action on failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: 'Something broke', request_id: 'req-1' } }),
        { status: 500, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    await renderOrders();

    await waitFor(() => {
      expect(screen.queryByTestId('error-state')).not.toBeNull();
    });
    expect(screen.getByRole('button', { name: /try again/i })).not.toBeNull();
  });

  it('renders real order cards once the fetch resolves with orders', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(stubOk({ data: queueBusy.payload, meta: { next_cursor: null, has_more: false, total: (queueBusy.payload as unknown[]).length } }));

    const { container } = await renderOrders();

    // Nested layout (card → row → span) means the order code's text is a substring of
    // several ancestors' `textContent`, so a plain `getByText`/`queryByText` substring
    // match is ambiguous (throws "multiple elements"). Asserting on the rendered
    // container's full text avoids that without coupling the test to internal markup.
    await waitFor(() => {
      expect(container.textContent).toContain('HG-RENG-18X');
    });
  });

  it('shows the live rider map on an accepted order once a rider is assigned', async () => {
    const orders = (queueBusy.payload as Array<Record<string, unknown>>).map((o, i) =>
      i === 0 ? { ...o, state: 'READY_FOR_PICKUP', rider: { display_name: 'Yusuf K.', vehicle_type: 'BICYCLE', photo_url: null, eta_at: null } } : o,
    );
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.includes('/v1/restaurant/profile')) return new Response('{}', { status: 500 });
      return stubOk({ data: orders, meta: { next_cursor: null, has_more: false, total: orders.length } });
    });

    await renderOrders();

    const maps = await screen.findAllByTestId('rider-approach-map');
    expect(maps.some((m) => m.textContent?.includes('Yusuf K. · Bicycle'))).toBe(true);
  });

  it('rings and highlights an order that arrives on a later poll, but not the ones already seen', async () => {
    const [first, second] = queueBusy.payload as Array<{ id: string; code: string }>;
    let orders: unknown[] = [first];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.includes('/v1/restaurant/profile')) return new Response('{}', { status: 500 });
      return stubOk({ data: orders, meta: { next_cursor: null, has_more: false, total: orders.length } });
    });
    // jsdom has no Web Audio: count chimes through a minimal stand-in.
    const chimes = vi.fn();
    const node = () => ({
      connect: (next: unknown) => next,
      frequency: { value: 0 },
      gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
      start() {},
      stop() {},
    });
    vi.stubGlobal(
      'AudioContext',
      class {
        currentTime = 0;
        destination = {};
        constructor() {
          chimes();
        }
        createOscillator = node;
        createGain = node;
        close = () => Promise.resolve();
      },
    );

    const { container } = await renderOrders();
    await waitFor(() => expect(container.querySelectorAll('[data-hg-numeric]').length).toBeGreaterThan(0));
    // The first load is the baseline: nothing on it is "new".
    expect(container.querySelector('[data-new-order]')).toBeNull();
    expect(chimes).not.toHaveBeenCalled();

    orders = [first, second];
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));

    await waitFor(() => expect(container.querySelectorAll('[data-new-order="true"]')).toHaveLength(1));
    expect(chimes).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[data-new-order="true"]')!.textContent).toContain(second!.code);
  });

  it('keeps the last good queue on screen when a later poll fails', async () => {
    let fail = false;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.includes('/v1/restaurant/profile')) return new Response('{}', { status: 500 });
      if (fail) {
        return new Response(JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: 'Something broke', request_id: 'req-2' } }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return stubOk({ data: queueBusy.payload, meta: { next_cursor: null, has_more: false, total: (queueBusy.payload as unknown[]).length } });
    });

    const { container } = await renderOrders();
    await waitFor(() => expect(container.textContent).toContain('HG-RENG-18X'));

    fail = true;
    window.dispatchEvent(new Event('focus'));

    await waitFor(() => expect(vi.mocked(fetch).mock.calls.length).toBeGreaterThanOrEqual(3));
    // Let the failed poll's response settle before asserting nothing changed.
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
    expect(screen.queryByTestId('error-state')).toBeNull();
    expect(container.textContent).toContain('HG-RENG-18X');
  });
});
