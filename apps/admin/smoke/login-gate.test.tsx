import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';

import { setToken, isAuthed } from '../src/lib/token';

/**
 * The auth gate. Admin sessions are email + password + TOTP: `POST /v1/auth/login` 401s with
 * `MFA_REQUIRED` unless `totp_code` is present. Deny-by-default means every protected screen
 * must be unreachable until a session exists — this pins that the app renders *only* the
 * sign-in form pre-auth, and that a successful login (with a TOTP code) opens the gate and
 * mounts the protected shell.
 */
describe('admin login gate', () => {
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
    // The module graph (the dashboard route pulls in mapbox-gl) touches `fetch` at import
    // time; stub it globally, once, before anything in this file imports `../src/App` — a
    // real network call in the test sandbox never resolves and hangs the import forever.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })),
    );
  });

  // Query by accessible name, not raw label text: a required field's label also holds an
  // aria-hidden " *", so its text is "Email *" while its accessible name is "Email".
  // Password inputs have no ARIA role, so that one field is matched by label prefix.
  const email = () => screen.getByRole('textbox', { name: 'Email' });
  const password = () => screen.getByLabelText(/^Password/);
  const totp = () => screen.getByRole('textbox', { name: 'Authenticator code' });

  afterEach(() => {
    cleanup();
    setToken(null);
  });

  it('blocks the protected shell and shows only the sign-in form pre-auth', async () => {
    expect(isAuthed()).toBe(false);

    const { Root } = await import('../src/App');
    render(<Root />);

    expect(screen.getByRole('heading', { name: 'Admin sign in' })).not.toBeNull();
    expect(email()).not.toBeNull();
    expect(password()).not.toBeNull();
    expect(totp()).not.toBeNull();

    // Deny by default: nothing from the protected nav/shell is present.
    expect(screen.queryByRole('link', { name: 'Restaurants' })).toBeNull();
    expect(screen.queryByText('HalalGoes — Admin')).toBeNull();
  });

  it('opens the shell once email + password + TOTP succeed', async () => {
    vi.mocked(globalThis.fetch).mockImplementation(async (input) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.includes('/auth/login')) {
        return new Response(
          JSON.stringify({ data: { access_token: 'admin-token-abc', token_type: 'Bearer' } }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(
        JSON.stringify({ data: [], meta: { next_cursor: null, has_more: false, total: 0 } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });

    const { Root } = await import('../src/App');
    render(<Root />);

    fireEvent.change(email(), { target: { value: 'admin@halalgoes.ca' } });
    fireEvent.change(password(), {
      target: { value: 'correct horse battery staple' },
    });
    fireEvent.change(totp(), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => expect(isAuthed()).toBe(true));
    await waitFor(() => {
      expect(screen.queryByText('HalalGoes — Admin')).not.toBeNull();
    });
    expect(screen.getByRole('link', { name: 'Restaurants' })).not.toBeNull();
  });
});
