import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import { setToken } from '../src/lib/token';
import openFixture from '../../../contracts/fixtures/admin/ordering_pause_open.json';
import pausedFixture from '../../../contracts/fixtures/admin/ordering_pause_on.json';

/**
 * #389 — the platform-wide pause on new orders, on the System page. Pins the one thing that
 * matters: confirming the dialog with a reason sends `setOrderingPause` (`PUT
 * /v1/admin/ordering-pause`, `paused: true`, the reason, an Idempotency-Key), and the
 * panel then shows the paused state the API answered with.
 */

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('admin ordering pause', () => {
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
    // See login-gate.test.tsx: the module graph touches `fetch` at import time.
    vi.stubGlobal('fetch', vi.fn(async () => json({})));
  });

  afterEach(() => {
    cleanup();
    setToken(null);
    window.location.hash = '';
  });

  it('pauses with a reason through setOrderingPause and shows the paused state', async () => {
    setToken('admin-token');
    window.location.hash = '#/system';

    const puts: { body: unknown; idempotencyKey: string | null }[] = [];
    vi.mocked(globalThis.fetch).mockImplementation(async (input: RequestInfo | URL) => {
      const req = input as Request;
      if (req.url.endsWith('/v1/admin/ordering-pause')) {
        if (req.method === 'PUT') {
          puts.push({ body: await req.json(), idempotencyKey: req.headers.get('Idempotency-Key') });
          return json({ data: pausedFixture.payload });
        }
        return json({ data: openFixture.payload });
      }
      return json({ error: { code: 'FORBIDDEN', message: 'host only' } }, 403);
    });

    const { Root } = await import('../src/App');
    render(<Root />);

    const pauseButton = await screen.findByRole('button', { name: 'Pause new orders' });
    expect(screen.getByTestId('ordering-pause-state').textContent).toContain('New orders are open');

    fireEvent.click(pauseButton);
    const dialog = await screen.findByTestId('ordering-pause-confirm');
    const reason = 'Stripe is refusing card authorisations; pausing new orders.';
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: reason } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Pause new orders' }));

    await waitFor(() => {
      expect(screen.getByTestId('ordering-pause-state').textContent).toContain('New orders are paused');
    });
    expect(puts).toHaveLength(1);
    expect(puts[0]!.body).toEqual({ paused: true, reason });
    expect(puts[0]!.idempotencyKey).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Resume new orders' })).not.toBeNull();
  });
});
