import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/**
 * The auth gate — deny by default (AGENTS.md invariant #2). Every protected route
 * (`RequireAuth` in `App.tsx`) must be unreachable pre-session, and the login form is the
 * only thing rendered at `/orders` until one exists. Salvaged and adapted from the abandoned
 * `apps/restaurant-web` stub's `login-gate.test.tsx` to this app's real routes/auth model
 * (route-based `RequireAuth`, `localStorage`-backed session rather than an in-memory token
 * holder).
 */
describe('restaurant app — login gate', () => {
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
    localStorage.clear();
    // Each test gets a fresh module graph: `lib/api.ts` reads its stored session once, at
    // module load, so a session set (or cleared) by a prior test must not leak forward.
    vi.resetModules();
  });

  it('blocks the protected shell and shows only the sign-in form pre-auth', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })));

    const { Root } = await import('../src/App');
    render(
      <MemoryRouter initialEntries={['/orders']}>
        <Root />
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: 'Halal Goes for restaurants' })).not.toBeNull();
    // `exact: false`: the required-field marker (`Input`'s trailing " *") makes the
    // computed accessible name "Business email *", not the bare label text.
    expect(screen.getByLabelText('Business email', { exact: false })).not.toBeNull();
    expect(screen.getByLabelText('Password', { exact: false })).not.toBeNull();

    // Deny by default: nothing from the protected nav/shell is present.
    expect(screen.queryByRole('link', { name: 'Orders' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull();
  });

  it('opens the protected shell once email + password succeed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = input instanceof Request ? input.url : String(input);
        if (url.includes('/auth/login')) {
          return new Response(
            JSON.stringify({
              data: {
                access_token: 'rx-token-abc',
                token_type: 'Bearer',
                principal: { account_id: 'acct-1', roles: [{ role: 'RESTAURANT_OWNER' }] },
              },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        // Login always routes to `/onboarding` first; reporting `DONE` here sends the
        // onboarding screen straight on to the protected shell, the same way a fully
        // onboarded operator's session would.
        if (url.includes('/onboarding/status')) {
          return new Response(
            JSON.stringify({ data: { current_step: 'DONE', progress_percent: 100 } }),
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
    const { fireEvent, waitFor } = await import('@testing-library/react');
    render(
      <MemoryRouter initialEntries={['/orders']}>
        <Root />
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText('Business email', { exact: false }), { target: { value: 'owner@karachikitchen.ca' } });
    fireEvent.change(screen.getByLabelText('Password', { exact: false }), { target: { value: 'correct horse battery staple' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(
      () => {
        expect(screen.queryByRole('link', { name: 'Orders' })).not.toBeNull();
      },
      { timeout: 5000 },
    );
    expect(screen.getByRole('button', { name: 'Sign out' })).not.toBeNull();
  });
});
