import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';

/**
 * The auth gate. Operator sessions are email + password (`POST /v1/auth/login`); until one is
 * held every protected fetch would 401, so the whole app tree renders behind this form.
 * Deny-by-default means the protected shell (order queue, nav) must be unreachable pre-auth —
 * pinned here alongside the happy path of a successful sign-in opening it.
 */
describe('restaurant-web login gate', () => {
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
    // Each test gets a fresh module graph: the api client (and the token holder it reads)
    // are constructed once per import, so a stale instance from a prior test's mock must
    // not leak into the next.
    vi.resetModules();
  });

  it('blocks the protected shell and shows only the sign-in form pre-auth', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })),
    );

    const { Root } = await import('../src/App');
    const { isAuthed } = await import('../src/lib/token');
    expect(isAuthed()).toBe(false);
    render(<Root />);

    expect(screen.getByRole('heading', { name: 'Sign in' })).not.toBeNull();
    expect(screen.getByLabelText('Email')).not.toBeNull();
    expect(screen.getByLabelText('Password')).not.toBeNull();

    // Deny by default: nothing from the protected nav/shell is present.
    expect(screen.queryByRole('link', { name: 'Orders' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull();
  });

  it('opens the shell once email + password succeed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = input instanceof Request ? input.url : String(input);
        if (url.includes('/auth/login')) {
          return new Response(
            JSON.stringify({ data: { access_token: 'rx-token-abc', token_type: 'Bearer' } }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        return new Response(
          JSON.stringify({ data: [], meta: { next_cursor: null, has_more: false, total: 0 } }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }),
    );

    const { Root } = await import('../src/App');
    const { isAuthed } = await import('../src/lib/token');
    render(<Root />);

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'owner@karachikitchen.ca' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'correct horse battery staple' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => expect(isAuthed()).toBe(true));
    await waitFor(() => {
      expect(screen.queryByRole('link', { name: 'Orders' })).not.toBeNull();
    });
    expect(screen.getByRole('button', { name: 'Sign out' })).not.toBeNull();
  });
});
