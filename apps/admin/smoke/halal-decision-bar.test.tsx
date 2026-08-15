import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';

import { setToken } from '../src/lib/token';
import pendingFixture from '../../../contracts/fixtures/halal/halal_certificate_status_pending.json';

/**
 * A-15 — the seven-check decision bar, wired end to end through `HalalVerificationScreen`.
 * The gating logic itself (open only on seven passes) is unit-tested exhaustively in
 * `@hg/ui-web`'s `HalalChecklist.test.tsx`; this pins the app-level wiring — that a real
 * `GET /v1/admin/halal-certificates/{id}` response with all seven checks NOT_ASSESSED
 * renders the checklist with the approve affordance absent, and that flipping every check
 * to PASS (a second fetch) opens it. The instrument the platform's single claim rests on
 * must not silently render an approve button nobody meant to enable.
 */

function allPass(): typeof pendingFixture {
  return {
    ...pendingFixture,
    payload: {
      ...pendingFixture.payload,
      checks: pendingFixture.payload.checks.map((c) => ({ ...c, result: 'PASS' as const })),
    },
  };
}

describe('admin halal decision bar', () => {
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
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })),
    );
  });

  afterEach(() => {
    cleanup();
    setToken(null);
    window.location.hash = '';
  });

  it('renders no approve affordance while checks are outstanding', async () => {
    setToken('admin-token');
    window.location.hash = `#/certificates/${pendingFixture.payload.id}`;

    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(JSON.stringify({ data: pendingFixture.payload }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const { Root } = await import('../src/App');
    render(<Root />);

    await waitFor(() => {
      expect(screen.queryByText('Halal verification')).not.toBeNull();
    });

    await waitFor(() => {
      expect(screen.queryByTestId('HalalChecklist-outstanding')).not.toBeNull();
    });
    expect(screen.queryByTestId('HalalChecklist-approve')).toBeNull();
    expect(screen.getByTestId('HalalChecklist-outstanding').textContent).toContain(
      '7 checks are outstanding',
    );
  });

  it('opens the approve affordance once all seven checks pass', async () => {
    setToken('admin-token');
    const fixture = allPass();
    window.location.hash = `#/certificates/${fixture.payload.id}`;

    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(JSON.stringify({ data: fixture.payload }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const { Root } = await import('../src/App');
    render(<Root />);

    await waitFor(() => {
      expect(screen.queryByTestId('HalalChecklist-approve')).not.toBeNull();
    });
    expect(screen.queryByTestId('HalalChecklist-outstanding')).toBeNull();
  });
});
