import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import queueBusy from '../../../contracts/fixtures/orders/restaurant_order_queue_busy.json';

/**
 * `OrderQueueScreen` drives all three states through `@hg/ui-web`'s `DataTable` — loading
 * (skeleton rows), empty (queue drained) and error (network/API failure) — never a
 * happy-path-only render. This pins each independently against the real fetch → DataTable
 * wiring, using the contract's own busy/empty fixtures.
 */

function neverResolves(): Promise<Response> {
  return new Promise(() => {});
}

function stubOk(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function renderQueue() {
  const { OrderQueueScreen } = await import('../src/screens/OrderQueueScreen');
  return render(
    <MemoryRouter>
      <OrderQueueScreen />
    </MemoryRouter>,
  );
}

describe('restaurant order queue — loading, empty, error', () => {
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
    // The api client binds `fetch` at module-construction time; force a fresh module (and a
    // freshly-constructed client bound to the *next* test's mock) rather than reusing one
    // captured against a mock a previous test already tore down.
    vi.resetModules();
  });

  it('renders skeleton rows while the fetch is in flight', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(neverResolves);

    await renderQueue();

    await waitFor(() => {
      expect(document.querySelector('#order-queue')?.getAttribute('data-state')).toBe(
        'loading',
      );
    });
    expect(document.querySelectorAll('[data-testid="data-table-skeleton-row"]').length).toBeGreaterThan(0);
  });

  it('renders the drained-queue empty state for zero orders', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      stubOk({ data: [], meta: { next_cursor: null, has_more: false, total: 0 } }),
    );

    await renderQueue();

    await waitFor(() => {
      expect(document.querySelector('[data-testid="data-table-empty"]')).not.toBeNull();
    });
    expect(document.querySelector('#order-queue')?.getAttribute('data-state')).toBe(
      'empty',
    );
  });

  it('renders the error state and a retry action on failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ error: { code: 'INTERNAL', message: 'Something broke', request_id: 'req-1' } }),
        { status: 500, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    await renderQueue();

    await waitFor(() => {
      expect(document.querySelector('[data-testid="data-table-error"]')).not.toBeNull();
    });
    expect(document.querySelector('#order-queue')?.getAttribute('data-state')).toBe(
      'error',
    );
    expect(screen.getByRole('button', { name: /try again/i })).not.toBeNull();
  });

  it('renders real rows once the fetch resolves with orders', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      stubOk({ data: queueBusy.payload, meta: queueBusy.meta }),
    );

    await renderQueue();

    await waitFor(() => {
      expect(document.querySelector('#order-queue')?.getAttribute('data-state')).toBe(
        'rows',
      );
    });
    expect(screen.getByText('HG-RENG-18X')).not.toBeNull();
  });
});
