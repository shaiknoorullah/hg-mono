import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const SESSION = {
  data: {
    access_token: 'rx-token-abc',
    token_type: 'Bearer',
    principal: { account_id: 'acct-1', roles: [{ role: 'RESTAURANT_OWNER' }] },
  },
};

/**
 * Stubs the API for a sign-in: `/auth/login` answers with `login(totp_code)`. Login always
 * routes to `/onboarding` first; reporting `DONE` there sends the onboarding screen straight
 * on to the protected shell, the same way a fully onboarded operator's session would. Every
 * list after that is empty.
 */
function stubApi(login: (totpCode: string | null) => Response) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const req = input instanceof Request ? input : null;
      const url = req ? req.url : String(input);
      if (url.includes('/auth/login')) {
        const body = req ? ((await req.clone().json()) as { totp_code?: string | null }) : {};
        return login(body.totp_code ?? null);
      }
      if (url.includes('/onboarding/status')) {
        return json(200, { data: { current_step: 'DONE', progress_percent: 100 } });
      }
      return json(200, { data: [], meta: { next_cursor: null, has_more: false, total: 0 } });
    }),
  );
}

/**
 * The auth gate — deny by default (AGENTS.md invariant #2). Every protected route
 * (`RequireAuth` in `App.tsx`) must be unreachable pre-session, and the login form is the
 * only thing rendered at `/orders` until one exists. Salvaged and adapted from the abandoned
 * `apps/restaurant-web` stub's `login-gate.test.tsx` to this app's real routes/auth model
 * (route-based `RequireAuth`, `localStorage`-backed session rather than an in-memory token
 * holder).
 */
/** Renders the app at `path` and submits the email + password step. */
async function renderAndSignIn(path: string) {
  const { Root } = await import('../src/App');
  const rtl = await import('@testing-library/react');
  render(
    <MemoryRouter initialEntries={[path]}>
      <Root />
    </MemoryRouter>,
  );
  rtl.fireEvent.change(screen.getByLabelText('Business email', { exact: false }), { target: { value: 'owner@karachikitchen.ca' } });
  rtl.fireEvent.change(screen.getByLabelText('Password', { exact: false }), { target: { value: 'correct horse battery staple' } });
  rtl.fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  return rtl;
}

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

    expect(screen.getByRole('heading', { name: 'HalalGoes for restaurants' })).not.toBeNull();
    // `exact: false`: the required-field marker (`Input`'s trailing " *") makes the
    // computed accessible name "Business email *", not the bare label text.
    expect(screen.getByLabelText('Business email', { exact: false })).not.toBeNull();
    expect(screen.getByLabelText('Password', { exact: false })).not.toBeNull();

    // Deny by default: nothing from the protected nav/shell is present.
    expect(screen.queryByRole('link', { name: 'Orders' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull();
  });

  it('opens the protected shell once email + password succeed', async () => {
    stubApi(() => json(200, SESSION));

    const { fireEvent, waitFor } = await renderAndSignIn('/orders');

    await waitFor(
      () => {
        expect(screen.queryByRole('link', { name: 'Orders' })).not.toBeNull();
      },
      { timeout: 5000 },
    );
    expect(screen.getByRole('button', { name: 'Sign out' })).not.toBeNull();

    // The side nav routes: choosing Menu makes it the current page. jsdom cannot follow the
    // link's real href, so the browser default is stopped and the router does the work. (The
    // real app follows the href as well today: https://github.com/shaiknoorullah/hg-mono/issues/232)
    const menu = screen.getByRole('link', { name: 'Menu' });
    menu.addEventListener('click', (e) => e.preventDefault(), { once: true });
    fireEvent.click(menu);
    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Menu' }).getAttribute('aria-current')).toBe('page');
    });
  });

  it('asks for the authenticator code when the server requires it, then signs in with it', async () => {
    const codes: (string | null)[] = [];
    stubApi((totpCode) => {
      codes.push(totpCode);
      return totpCode
        ? json(200, SESSION)
        : json(401, { error: { code: 'MFA_REQUIRED', message: 'Enter the code from your authenticator app.' } });
    });

    const { fireEvent, waitFor } = await renderAndSignIn('/login');

    // Still signed out: the password step gives way to the code, and nothing protected shows.
    const code = (await screen.findAllByRole('textbox', { name: /^6-digit authentication code/ }))[0]!;
    expect(screen.queryByLabelText('Password', { exact: false })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Orders' })).toBeNull();

    fireEvent.paste(code, { clipboardData: { getData: () => '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verify and sign in' }));

    await waitFor(
      () => {
        expect(screen.queryByRole('link', { name: 'Orders' })).not.toBeNull();
      },
      { timeout: 5000 },
    );
    expect(codes).toEqual([null, '123456']);
  });
});
