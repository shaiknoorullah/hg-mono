/**
 * WP2 — `/login` (canvas SI `Main`, `SignIn-*`). Every board state from a contract fixture or a
 * contract-shaped envelope, asserted by role and name.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { consoleRoutes, fixture, installFakeApi, type Handler } from '../test/fakeApi';
import { apiError, configWithoutSupport, renderPublic, restaurantGrant } from '../test/authKit';
import { getSession } from '../../lib/api';
import { safeReturnTo } from './returnTo';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  localStorage.clear();
});

function routes(login: Handler, extra: Record<string, Handler> = {}) {
  return consoleRoutes({ 'POST /v1/auth/login': login, 'POST /v1/auth/logout': { status: 204 }, ...extra });
}

async function signIn(email = 'samir@zaytoungrill.ca', password = 'correct horse battery') {
  const emailField = await screen.findByLabelText(/^Email/);
  fireEvent.change(emailField, { target: { value: email } });
  fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: password } });
  fireEvent.submit(emailField.closest('form')!);
}

const location = () => screen.getByTestId('location').textContent;

/** The page's own alert (the page announcer also owns a role=alert region). */
function getAlert(): HTMLElement {
  const el = screen.getByTestId('InlineAlert');
  expect(el.getAttribute('role')).toBe('alert');
  return el;
}
async function findAlert(): Promise<HTMLElement> {
  await screen.findByTestId('InlineAlert');
  return getAlert();
}

describe('sign in · main', () => {
  it('draws the Main board: heading, fields with autocomplete, links and the support sentence from config', async () => {
    installFakeApi(routes('session_grant_customer'));
    await renderPublic('/login');
    expect(await screen.findByRole('heading', { level: 1, name: 'Sign in to your restaurant' })).toBeTruthy();
    expect(screen.getByText('Use the email and password you registered with.')).toBeTruthy();
    expect(screen.getByLabelText(/^Email/).getAttribute('autocomplete')).toBe('username');
    expect(screen.getByLabelText(/^Password/).getAttribute('autocomplete')).toBe('current-password');
    expect(screen.getByRole('link', { name: 'Reset it by email' }).getAttribute('href')).toBe('/forgot-password');
    expect(screen.getByRole('link', { name: 'Register your restaurant' }).getAttribute('href')).toBe('/register');
    const phone = await screen.findByRole('link', { name: '1-800-555-0199' });
    expect(phone.getAttribute('href')).toBe('tel:+18005550199');
    expect(screen.getByTestId('support-sentence').textContent).toBe(
      'Need help signing in? Call partner support on 1-800-555-0199, Support Hours.',
    );
    // The header: brand, no navigation.
    expect(screen.getByRole('img', { name: 'HalalGoes' })).toBeTruthy();
    expect(screen.queryByRole('navigation')).toBeNull();
  });

  it('hides every support line when support_enabled is false', async () => {
    installFakeApi(routes('session_grant_customer', { 'GET /v1/config/public': { body: configWithoutSupport() } }));
    await renderPublic('/login');
    await screen.findByRole('heading', { name: 'Sign in to your restaurant' });
    await waitFor(() => expect(screen.queryByTestId('support-sentence')).toBeNull());
    expect(screen.queryByText(/partner support/)).toBeNull();
  });

  it('signs in through the redesign client with no TOTP, stores the session and goes to orders when onboarding is DONE', async () => {
    const api = installFakeApi(routes({ body: restaurantGrant() }));
    await renderPublic('/login');
    await signIn();
    await waitFor(() => expect(location()).toBe('/orders'));
    expect(getSession()).toMatchObject({ accessToken: 'fresh-access-token', accountId: fixture('principal_customer').account_id });
    const [req] = api.callsTo('POST /v1/auth/login');
    expect(req!.headers.get('X-HG-Client')).toBe('restaurant-web');
    const body = await req!.json();
    expect(body).toEqual({ email: 'samir@zaytoungrill.ca', password: 'correct horse battery' });
    // The client never works out the step: the server's onboarding status decides.
    expect(api.callsTo('GET /v1/restaurant/onboarding/status').length).toBeGreaterThanOrEqual(1);
  });

  it('goes to onboarding when the server says setup is not DONE', async () => {
    installFakeApi(routes({ body: restaurantGrant() }, { 'GET /v1/restaurant/onboarding/status': 'restaurant_onboarding_documents_pending' }));
    await renderPublic('/login');
    await signIn();
    await waitFor(() => expect(location()).toBe('/onboarding'));
  });

  it('honours a same-origin return_to and refuses one that leaves the site', async () => {
    installFakeApi(routes({ body: restaurantGrant() }));
    await renderPublic('/login?return_to=%2Fmenu%3Fitem%3D1');
    await signIn();
    await waitFor(() => expect(location()).toBe('/menu?item=1'));
    cleanup();
    installFakeApi(routes({ body: restaurantGrant() }));
    await renderPublic('/login?return_to=%2F%2Fevil.example%2Forders');
    await signIn();
    await waitFor(() => expect(location()).toBe('/orders'));
  });

  it('asks for both fields before sending anything', async () => {
    const api = installFakeApi(routes({ body: restaurantGrant() }));
    await renderPublic('/login');
    const emailField = await screen.findByLabelText(/^Email/);
    fireEvent.submit(emailField.closest('form')!);
    expect(await screen.findByText('Enter your email.')).toBeTruthy();
    expect(api.callsTo('POST /v1/auth/login')).toHaveLength(0);
  });
});

describe('sign in · refusals (branch on error.code)', () => {
  it('Invalid: the danger alert takes focus, the password is cleared and the email kept', async () => {
    installFakeApi(routes(apiError(401, 'INVALID_CREDENTIALS')));
    await renderPublic('/login');
    await signIn();
    const alert = await findAlert();
    expect(within(alert).getByText('Email or password is incorrect')).toBeTruthy();
    expect(within(alert).getByText('Check both and try again. Forgot your password? Reset it by email below.')).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(alert));
    expect((screen.getByLabelText(/^Password/) as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText(/^Email/) as HTMLInputElement).value).toBe('samir@zaytoungrill.ca');
    expect(screen.getByRole('link', { name: 'Register your restaurant' })).toBeTruthy();
  });

  it('Unverified: branches on details.email_verification_required and "Send a new link" opens Check your email in its wait', async () => {
    const api = installFakeApi(
      routes(apiError(401, 'INVALID_CREDENTIALS', { details: { email_verification_required: true } }), {
        'POST /v1/auth/email/resend': { status: 202, body: { acknowledged: true } },
      }),
    );
    await renderPublic('/login');
    await signIn();
    const title = await screen.findByText('Confirm your email to sign in');
    expect(title.closest('[role="status"]')).not.toBeNull();
    expect(
      screen.getByText(
        'We sent a confirmation link to samir@zaytoungrill.ca when you registered. Links work for 24 hours. Signing in won’t work until you’ve opened it.',
      ),
    ).toBeTruthy();
    // Both fields kept; Sign in becomes secondary under the primary "Send a new link".
    expect((screen.getByLabelText(/^Password/) as HTMLInputElement).value).toBe('correct horse battery');
    expect(screen.getByRole('button', { name: 'Sign in' }).getAttribute('data-variant')).toBe('secondary');
    fireEvent.click(screen.getByRole('button', { name: 'Send a new link' }));
    await waitFor(() => expect(location()).toBe('/check-email'));
    expect(await api.callsTo('POST /v1/auth/email/resend')[0]!.json()).toEqual({ email: 'samir@zaytoungrill.ca' });
    expect(await screen.findByText('A new link is on its way. Earlier links no longer work, so use the newest email.')).toBeTruthy();
  });

  it('TooMany: the wait counts from the response Date header, not this device’s clock', async () => {
    // This device's clock runs 5 minutes ahead of the server; Retry-After is an HTTP date 40 s
    // after the server's Date. Counting from the device clock would show nothing left.
    const serverMs = Math.floor(Date.now() / 1000) * 1000 - 300_000;
    const headers = { 'Retry-After': new Date(serverMs + 40_000).toUTCString(), Date: new Date(serverMs).toUTCString() };
    installFakeApi(routes(apiError(429, 'RATE_LIMITED', { headers })));
    await renderPublic('/login');
    await signIn();
    expect(await screen.findByText('Too many attempts from this device')).toBeTruthy();
    const button = screen.getByRole('button', { name: 'Try again' });
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.getAttribute('aria-describedby')).toBe('wait-reason');
    const timer = screen.getByRole('timer', { name: 'until you can try again' });
    expect(timer.textContent).toMatch(/^0:(39|40)$/);
    expect(document.getElementById('wait-reason')!.textContent).toMatch(/^You can try again in 0:4/);
    // A status, not an alert: focus stays put.
    expect(document.activeElement?.getAttribute('role')).not.toBe('alert');
  });

  it('TooMany: the button comes back when the wait is over', async () => {
    const serverMs = Math.floor(Date.now() / 1000) * 1000 - 300_000;
    const headers = { 'Retry-After': new Date(serverMs + 2_000).toUTCString(), Date: new Date(serverMs).toUTCString() };
    installFakeApi(routes(apiError(429, 'RATE_LIMITED', { headers })));
    await renderPublic('/login');
    await signIn();
    await screen.findByText('Too many attempts from this device');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Try again' }).getAttribute('aria-disabled')).toBeNull(), { timeout: 4000 });
  });

  it('Locked (backend 429 ACCOUNT_TEMPORARILY_LOCKED): alert focus, Call partner support, Sign in stays focusable, 15-minute wait', async () => {
    installFakeApi(routes(apiError(429, 'ACCOUNT_TEMPORARILY_LOCKED', { headers: { 'Retry-After': '900' } })));
    await renderPublic('/login');
    await screen.findByRole('link', { name: '1-800-555-0199' });
    await signIn();
    const alert = await findAlert();
    expect(within(alert).getByText('Sign-in is paused for this account')).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(alert));
    expect(within(alert).getByRole('link', { name: 'Reset it by email' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Call partner support' }).getAttribute('href')).toBe('tel:+18005550199');
    const signInButton = screen.getByRole('button', { name: 'Sign in' });
    expect(signInButton.getAttribute('aria-disabled')).toBe('true');
    expect(signInButton.getAttribute('aria-describedby')).toBe('wait-reason');
    expect(screen.getByRole('timer').textContent).toMatch(/^1[45]:\d\d$/);
    expect((screen.getByLabelText(/^Password/) as HTMLInputElement).value).toBe('');
    expect(screen.getByText(/^Partner support:/)).toBeTruthy();
  });

  it('Locked: activating the aria-disabled Sign in says the wait again and does not sign in', async () => {
    const api = installFakeApi(routes(apiError(429, 'ACCOUNT_TEMPORARILY_LOCKED', { headers: { 'Retry-After': '900' } })));
    await renderPublic('/login');
    await signIn();
    await screen.findByText('Sign-in is paused for this account');
    const polite = screen.getByTestId('announcer-polite');
    expect(polite.textContent).toBe('');
    fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: 'another try' } });
    // A real click: the DS Button must not swallow it, so the form's submit runs.
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(polite.textContent).toMatch(/^You can try again in 1[45] minutes( \d+ seconds?)?\.$/));
    expect(api.callsTo('POST /v1/auth/login')).toHaveLength(1);
  });

  it('Locked without Retry-After has no countdown; without support there is no call button', async () => {
    installFakeApi(routes(apiError(423, 'ACCOUNT_TEMPORARILY_LOCKED'), { 'GET /v1/config/public': { body: configWithoutSupport() } }));
    await renderPublic('/login');
    await signIn();
    await screen.findByText('Sign-in is paused for this account');
    expect(screen.queryByRole('timer')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Call partner support' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Sign in' }).getAttribute('aria-disabled')).toBeNull();
  });

  it('Offline: a neutral alert takes focus and keeps what was typed', async () => {
    const api = installFakeApi(routes({ body: restaurantGrant() }));
    void api;
    await renderPublic('/login');
    await screen.findByLabelText(/^Email/);
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))));
    await signIn();
    const alert = await findAlert();
    expect(within(alert).getByText('We couldn’t reach HalalGoes')).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(alert));
    expect((screen.getByLabelText(/^Password/) as HTMLInputElement).value).toBe('correct horse battery');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });

  it.each([
    ['503 TIMEOUT', apiError(503, 'TIMEOUT', { headers: { 'Retry-After': '5' } })],
    ['500 INTERNAL_ERROR', apiError(500, 'INTERNAL_ERROR')],
    ['403 MFA_REQUIRED (no two-step at launch)', apiError(403, 'MFA_REQUIRED')],
    ['an unknown code', apiError(400, 'SOMETHING_NEW')],
  ])('%s: the Offline layout with "try again in a moment", never a blank card', async (_name, response) => {
    installFakeApi(routes(response));
    await renderPublic('/login');
    await signIn();
    const alert = await findAlert();
    expect(within(alert).getByText('HalalGoes couldn’t sign you in just now')).toBeTruthy();
    expect(within(alert).getByText(/Try again in a moment\.$/)).toBeTruthy();
    expect(screen.queryByLabelText(/code/i)).toBeNull();
  });
});

describe('sign in · account-state cards', () => {
  it.each([
    [423, 'ACCOUNT_LOCKED', 'This account is locked', 'For your security, only partner support can unlock samir@zaytoungrill.ca.'],
    [403, 'ACCOUNT_SUSPENDED', 'Your sign-in account is suspended', 'You can’t sign in with samir@zaytoungrill.ca while it is suspended.'],
    [403, 'ACCOUNT_BANNED', 'This sign-in account can’t be used', 'samir@zaytoungrill.ca can’t be used on HalalGoes.'],
    [403, 'ACCOUNT_NOT_ACTIVE', 'This account isn’t active', 'samir@zaytoungrill.ca exists but isn’t active yet.'],
    [403, 'ACCOUNT_DEACTIVATED', 'This account has been closed', 'samir@zaytoungrill.ca can no longer be used to sign in.'],
  ])('%s %s → "%s" with the support block and Back to sign in', async (status, code, title, body) => {
    installFakeApi(routes(apiError(status, code)));
    await renderPublic('/login');
    await signIn();
    expect(await screen.findByRole('heading', { level: 1, name: title })).toBeTruthy();
    expect(screen.getByText((t) => t.startsWith(body))).toBeTruthy();
    const block = await screen.findByTestId('support-block');
    expect(within(block).getByText('Partner support')).toBeTruthy();
    expect(within(block).getByRole('link', { name: '1-800-555-0199' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Back to sign in' }).getAttribute('href')).toBe('/login');
    expect(getSession()).toBeNull();
  });

  it('support_enabled=false: the support block is replaced and the locked card says only HalalGoes can unlock it', async () => {
    installFakeApi(routes(apiError(423, 'ACCOUNT_LOCKED'), { 'GET /v1/config/public': { body: configWithoutSupport() } }));
    await renderPublic('/login');
    await screen.findByRole('heading', { name: 'Sign in to your restaurant' });
    await waitFor(() => expect(screen.queryByTestId('support-sentence')).toBeNull());
    await signIn();
    expect(await screen.findByText('For your security, it can only be unlocked by HalalGoes.')).toBeTruthy();
    expect(screen.getByText('Partner support isn’t available right now')).toBeTruthy();
    expect(screen.getByText('Try again later. What you’ve already sent stays on record.')).toBeTruthy();
    expect(screen.queryByTestId('support-block')).toBeNull();
    expect(screen.getByRole('link', { name: 'Back to sign in' })).toBeTruthy();
  });

  it('next_route SUSPENDED maps principal.status, ends the session and stores nothing', async () => {
    const api = installFakeApi(routes({ body: restaurantGrant({ next_route: 'SUSPENDED', status: 'BANNED' }) }));
    await renderPublic('/login');
    await signIn();
    expect(await screen.findByRole('heading', { name: 'This sign-in account can’t be used' })).toBeTruthy();
    expect(getSession()).toBeNull();
    await waitFor(() => expect(api.callsTo('POST /v1/auth/logout')).toHaveLength(1));
    expect(api.callsTo('POST /v1/auth/logout')[0]!.headers.get('Authorization')).toBe('Bearer fresh-access-token');
  });

  it.each(['APP_UPDATE_REQUIRED', 'SOME_FUTURE_ROUTE'])('next_route %s → the update view', async (nextRoute) => {
    installFakeApi(routes({ body: restaurantGrant({ next_route: nextRoute }) }));
    await renderPublic('/login');
    await signIn();
    expect(await screen.findByRole('heading', { name: 'This page needs an update' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeTruthy();
    expect(getSession()).toBeNull();
    expect(screen.queryByText(nextRoute)).toBeNull();
  });

  it('NotRestaurant: a customer grant is signed out and explained; "Sign in with a different email" starts clean', async () => {
    const api = installFakeApi(routes('session_grant_customer'));
    await renderPublic('/login');
    await signIn();
    expect(await screen.findByRole('heading', { name: 'This isn’t a restaurant account' })).toBeTruthy();
    expect(screen.getByText(/^samir@zaytoungrill\.ca signed in, but it has no restaurant on HalalGoes\./)).toBeTruthy();
    expect(screen.queryByText(/CUSTOMER/)).toBeNull();
    expect(getSession()).toBeNull();
    await waitFor(() => expect(api.callsTo('POST /v1/auth/logout')).toHaveLength(1));
    fireEvent.click(screen.getByRole('button', { name: 'Sign in with a different email' }));
    expect(((await screen.findByLabelText(/^Email/)) as HTMLInputElement).value).toBe('');
  });
});

describe('sign in · after a session ended', () => {
  it('SessionExpired: states the cost, with the response window derived from config', async () => {
    const config = fixture('public_config');
    config.restaurant_response_window_seconds = 120;
    installFakeApi(routes({ body: restaurantGrant() }, { 'GET /v1/config/public': { body: config } }));
    localStorage.setItem('hg_restaurant_last_email_v1', 'samir@zaytoungrill.ca');
    await renderPublic('/login?signed_out=expired&return_to=%2Forders');
    expect(await screen.findByRole('heading', { name: 'You’ve been signed out' })).toBeTruthy();
    expect(screen.getByText('Sign in again to keep receiving orders.')).toBeTruthy();
    const alert = getAlert();
    expect(within(alert).getByText('New orders can’t reach this screen')).toBeTruthy();
    await waitFor(() =>
      expect(
        within(alert).getByText(
          'New orders can’t reach this screen until you sign in. Orders that arrive now will time out after 2 minutes, and two missed orders in a row stop new orders.',
        ),
      ).toBeTruthy(),
    );
    expect(within(alert).getByText('Orders you’ve already accepted are not affected.')).toBeTruthy();
    expect((screen.getByLabelText(/^Email/) as HTMLInputElement).value).toBe('samir@zaytoungrill.ca');
    expect((screen.getByLabelText(/^Password/) as HTMLInputElement).value).toBe('');
  });

  it('ReuseDetected: signed out everywhere, with the support phone in the body', async () => {
    installFakeApi(routes({ body: restaurantGrant() }));
    await renderPublic('/login?signed_out=reuse-detected');
    expect(await screen.findByRole('heading', { name: 'We signed you out on every device' })).toBeTruthy();
    expect(screen.getByText('Every session ended, including kitchen tablets')).toBeTruthy();
    expect(
      await screen.findByText(
        'Something looked like a copied sign-in, so we ended every session. Sign in again on each one. If you didn’t expect this, call partner support on 1-800-555-0199 after signing in.',
      ),
    ).toBeTruthy();
  });

  it('the shell’s Sign in again lands on the matching board', async () => {
    // RedesignRoot's SignedOutAlert sends ?signed_out=<reason>; the route reads it.
    installFakeApi(routes({ body: restaurantGrant() }));
    await renderPublic('/login?signed_out=reuse-detected&return_to=%2Forders');
    await screen.findByRole('heading', { name: 'We signed you out on every device' });
    await act(async () => {
      await signIn();
    });
    await waitFor(() => expect(location()).toBe('/orders'));
  });
});

describe('return_to', () => {
  it.each([
    ['/orders', '/orders'],
    ['/menu?item=1#x', '/menu?item=1#x'],
    ['//evil.example/orders', null],
    ['/\\evil.example', null],
    ['https://evil.example/', null],
    ['javascript:alert(1)', null],
    ['orders', null],
    ['/login', null],
    ['/%0d%0aSet-Cookie', '/%0d%0aSet-Cookie'],
    ['/a\tb', null],
    ['', null],
  ])('%j → %j', (raw, expected) => {
    expect(safeReturnTo(raw)).toBe(expected);
  });
});
