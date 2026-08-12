import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';

/**
 * One smoke test: the queue screen mounts, calls the one real GET operation
 * (`listRestaurantApplications`) through @hg/api-client, and renders the returned
 * applications as rows in @hg/ui-web's DataTable. `fetch` is stubbed with a response
 * shaped exactly like the mock's fixture so the test needs no live server.
 */

const QUEUE_BODY = {
  data: [
    {
      restaurant_id: '2536622a-2c61-4b1e-ae8e-12d40d7b288f',
      display_name: 'Bilal S.',
      city: 'Scarborough',
      province: 'ON',
      onboarding_state: 'ACTIVE',
      submission_count: 0,
      assigned_admin_id: '23fd4868-d8f8-475c-a1ca-a16c342c119c',
      review_lock_expires_at: '2026-08-10T18:32:11.412Z',
      submitted_at: '2026-08-04T18:42:11.412Z',
      sla_due_at: '2026-08-10T18:32:11.412Z',
    },
    {
      restaurant_id: 'efae64e3-6d24-4b20-adc1-a83ad37ffdc8',
      display_name: 'Sana A.',
      city: 'Scarborough',
      province: 'ON',
      onboarding_state: 'ACTIVE',
      submission_count: 20,
      assigned_admin_id: 'cec92314-a975-4847-a5b1-1c740da3fbef',
      review_lock_expires_at: '2026-08-10T18:32:11.412Z',
      submitted_at: '2026-08-04T18:42:11.412Z',
      sla_due_at: '2026-08-10T18:32:11.412Z',
    },
  ],
  meta: { next_cursor: null, has_more: false, total: 2 },
};

describe('admin smoke', () => {
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
    (Element.prototype as unknown as { hasPointerCapture: unknown }).hasPointerCapture = () => false;
    (Element.prototype as unknown as { releasePointerCapture: unknown }).releasePointerCapture = () => {};
    Element.prototype.scrollIntoView = function scrollIntoView() {};
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('fetches the onboarding queue and renders the applications', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(QUEUE_BODY), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const { Root } = await import('../src/App');
    render(<Root />);

    // The one real GET the app makes on mount.
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    const firstArg = fetchSpy.mock.calls[0]?.[0];
    const url = firstArg instanceof Request ? firstArg.url : String(firstArg ?? '');
    expect(url).toContain('/v1/admin/restaurant-applications');

    // Real rows from real @hg/ui-web components.
    await waitFor(() => {
      expect(screen.getByText('Bilal S.')).not.toBeNull();
      expect(screen.getByText('Sana A.')).not.toBeNull();
    });
  });
});
