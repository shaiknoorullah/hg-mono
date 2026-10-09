import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import {
  TOKEN,
  TWELVE_HOUR,
  apiError,
  installDomShims,
  json,
  openLink,
  resetAddress,
  scriptFetch,
  where,
} from './linkPageHarness';

/**
 * `/verify-email?token=…` (issue #329): every state the sign-up email's link can land on.
 * Opening a link must never sign anyone in (#356): the page confirms the email, drops the
 * session the API still returns, and sends the owner to the normal sign-in. The token is a
 * credential: it leaves the address before any request and goes only in a POST body.
 */
const SESSION_KEY = 'hg_restaurant_session_v1';
const GRANT = {
  data: {
    access_token: 'access-after-verify',
    refresh_token: null,
    expires_in: 900,
    is_new_account: true,
    principal: { account_id: 'acct-attacker', roles: [{ role: 'RESTAURANT_OWNER' }] },
  },
};

/**
 * Every write of the app's session goes through `setSession` in `lib/api.ts`, which is the
 * only writer of this key; watching the key's writes watches every session setter.
 */
function watchSessionWrites() {
  const writes = vi.spyOn(Storage.prototype, 'setItem');
  return () => writes.mock.calls.filter(([key]) => key === SESSION_KEY);
}

describe('restaurant /verify-email', () => {
  beforeAll(installDomShims);

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    localStorage.clear();
    resetAddress();
    vi.resetModules();
  });

  it('confirms the email, never stores the session the API returns, and offers sign-in', async () => {
    const calls = scriptFetch({ '/v1/auth/email/verify': json(200, GRANT) });
    const sessionWrites = watchSessionWrites();
    await openLink(`/verify-email?token=${TOKEN}`);

    expect(await screen.findByRole('heading', { name: 'Email verified' })).not.toBeNull();
    expect(sessionWrites()).toEqual([]);
    expect(localStorage.getItem(SESSION_KEY)).toBeNull();
    expect(where.pathname).toBe('/verify-email');

    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(where.pathname).toBe('/login');
    expect(calls.filter((c) => c.path === '/v1/auth/email/verify')).toHaveLength(1);
  });

  it('takes the token out of the address before any request, and sends it only in the POST body', async () => {
    const calls = scriptFetch({ '/v1/auth/email/verify': json(200, GRANT) });
    await openLink(`/verify-email?token=${TOKEN}`);
    await screen.findByRole('heading', { name: 'Email verified' });

    expect(window.location.href).not.toContain(TOKEN);
    expect(document.querySelector('meta[name="referrer"]')?.getAttribute('content')).toBe('no-referrer');
    const verify = calls.find((c) => c.path === '/v1/auth/email/verify')!;
    expect(verify.body).toEqual({ token: TOKEN });
    expect(calls.every((c) => !c.address.includes(TOKEN) && !c.url.includes(TOKEN))).toBe(true);
  });

  it('with someone signed in, asks before using the link, and signs them out first', async () => {
    localStorage.setItem(SESSION_KEY, JSON.stringify({ accessToken: 'victim-session', accountId: 'acct-victim' }));
    const calls = scriptFetch({ '/v1/auth/logout': json(204), '/v1/auth/email/verify': json(200, GRANT) });
    const sessionWrites = watchSessionWrites();
    await openLink(`/verify-email?token=${TOKEN}`);

    expect(screen.getByRole('heading', { name: "You're already signed in" })).not.toBeNull();
    expect(calls.filter((c) => c.path === '/v1/auth/email/verify')).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: 'Sign out and continue' }));

    expect(await screen.findByRole('heading', { name: 'Email verified' })).not.toBeNull();
    expect(calls.map((c) => c.path)).toEqual(['/v1/auth/logout', '/v1/auth/email/verify']);
    expect(sessionWrites()).toEqual([]);
    expect(localStorage.getItem(SESSION_KEY)).toBeNull();
  });

  it('with someone signed in, leaves the link unused when they stay signed in', async () => {
    localStorage.setItem(SESSION_KEY, JSON.stringify({ accessToken: 'victim-session', accountId: 'acct-victim' }));
    const calls = scriptFetch({
      '/v1/restaurant/orders': json(200, { data: [], meta: { next_cursor: null, has_more: false, total: 0 } }),
    });
    await openLink(`/verify-email?token=${TOKEN}`);

    fireEvent.click(screen.getByRole('button', { name: 'Stay signed in' }));
    await waitFor(() => expect(where.pathname).toBe('/orders'));
    await screen.findByRole('button', { name: 'Sign out' });
    expect(calls.filter((c) => c.path === '/v1/auth/email/verify')).toHaveLength(0);
    expect(localStorage.getItem(SESSION_KEY)).toContain('victim-session');
  });

  it('says an already-used link is not an error, and offers sign-in', async () => {
    scriptFetch({ '/v1/auth/email/verify': apiError(410, 'VERIFICATION_TOKEN_USED') });
    await openLink(`/verify-email?token=${TOKEN}`);
    expect(await screen.findByRole('heading', { name: 'This link has already been used' })).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Sign in' })).not.toBeNull();
  });

  it('on an expired link, sends a new one to the email typed', async () => {
    const calls = scriptFetch({
      '/v1/auth/email/verify': apiError(410, 'VERIFICATION_TOKEN_EXPIRED'),
      '/v1/auth/email/resend': json(202, { data: { acknowledged: true } }),
    });
    await openLink(`/verify-email?token=${TOKEN}`);
    expect(await screen.findByRole('heading', { name: 'This link has expired' })).not.toBeNull();

    fireEvent.change(screen.getByRole('textbox', { name: 'Email' }), { target: { value: 'owner@zaytoun.ca' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send a new link' }));

    expect(await screen.findByRole('heading', { name: 'Check your email' })).not.toBeNull();
    expect(calls.find((c) => c.path === '/v1/auth/email/resend')!.body).toEqual({ email: 'owner@zaytoun.ca' });
  });

  it('on a dropped connection, keeps the link and tries again', async () => {
    scriptFetch({ '/v1/auth/email/verify': [new TypeError('Failed to fetch'), json(200, GRANT)] });
    await openLink(`/verify-email?token=${TOKEN}`);
    expect(await screen.findByRole('heading', { name: "We couldn't confirm your email" })).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { name: 'Email verified' })).not.toBeNull();
  });

  it('treats a missing or cut-short token as a broken link and sends nothing', async () => {
    const calls = scriptFetch({});
    await openLink('/verify-email?token=too-short');
    expect(screen.getByRole('heading', { name: "This link doesn't work" })).not.toBeNull();
    expect(calls.filter((c) => c.path === '/v1/auth/email/verify')).toHaveLength(0);
  });

  it('on a 429, holds the button and names the time to try again on a 12-hour clock', async () => {
    scriptFetch({
      '/v1/auth/email/verify': apiError(410, 'VERIFICATION_TOKEN_EXPIRED'),
      '/v1/auth/email/resend': apiError(429, 'RATE_LIMITED', { 'Retry-After': '60' }),
    });
    await openLink(`/verify-email?token=${TOKEN}`);
    await screen.findByRole('heading', { name: 'This link has expired' });

    fireEvent.change(screen.getByRole('textbox', { name: 'Email' }), { target: { value: 'owner@zaytoun.ca' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send a new link' }));

    expect(await screen.findByText('Too many attempts from this device')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Send a new link' }).getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByText(/You can send another at/).textContent).toMatch(TWELVE_HOUR);
  });
});
