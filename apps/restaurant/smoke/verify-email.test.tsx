import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { TOKEN, TWELVE_HOUR, apiError, installDomShims, json, mountAt, scriptFetch, where } from './linkPageHarness';

/**
 * `/verify-email?token=…` (issue #329): every state the sign-up email's link can land on.
 * The token is a credential, so the tests also pin that it leaves the address bar at once
 * and goes nowhere but the body of `verifyEmail`.
 */
const GRANT = {
  data: {
    access_token: 'access-after-verify',
    refresh_token: null,
    expires_in: 900,
    is_new_account: true,
    principal: { account_id: 'acct-1', roles: [{ role: 'RESTAURANT_OWNER' }] },
  },
};

describe('restaurant /verify-email', () => {
  beforeAll(installDomShims);

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    localStorage.clear();
    vi.resetModules();
  });

  it('confirms the email once, signs the owner in and opens onboarding; the token leaves the address', async () => {
    const calls = scriptFetch({ '/v1/auth/email/verify': json(200, GRANT) });
    await mountAt(`/verify-email?token=${TOKEN}`);

    expect(screen.getByRole('heading', { name: 'Confirming your email' })).not.toBeNull();
    await waitFor(() => expect(where.pathname).toBe('/onboarding'));

    const verifies = calls.filter((c) => c.path === '/v1/auth/email/verify');
    expect(verifies).toHaveLength(1);
    expect(verifies[0]!.body).toEqual({ token: TOKEN });
    expect(calls.every((c) => !c.url.includes(TOKEN))).toBe(true);
    expect(localStorage.getItem('hg_restaurant_session_v1')).toContain('access-after-verify');
  });

  it('removes the token from the address before the answer arrives', async () => {
    scriptFetch({ '/v1/auth/email/verify': () => new Promise<Response>(() => {}) as unknown as Response });
    await mountAt(`/verify-email?token=${TOKEN}`);
    await waitFor(() => expect(where.search).toBe(''));
    expect(where.pathname).toBe('/verify-email');
  });

  it('says an already-used link is not an error, and offers sign-in', async () => {
    scriptFetch({ '/v1/auth/email/verify': apiError(410, 'VERIFICATION_TOKEN_USED') });
    await mountAt(`/verify-email?token=${TOKEN}`);
    expect(await screen.findByRole('heading', { name: 'This link has already been used' })).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Sign in' })).not.toBeNull();
  });

  it('on an expired link, sends a new one to the email typed', async () => {
    const calls = scriptFetch({
      '/v1/auth/email/verify': apiError(410, 'VERIFICATION_TOKEN_EXPIRED'),
      '/v1/auth/email/resend': json(202, { data: { acknowledged: true } }),
    });
    await mountAt(`/verify-email?token=${TOKEN}`);
    expect(await screen.findByRole('heading', { name: 'This link has expired' })).not.toBeNull();

    fireEvent.change(screen.getByRole('textbox', { name: 'Email' }), { target: { value: 'owner@zaytoun.ca' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send a new link' }));

    expect(await screen.findByRole('heading', { name: 'Check your email' })).not.toBeNull();
    expect(calls.find((c) => c.path === '/v1/auth/email/resend')!.body).toEqual({ email: 'owner@zaytoun.ca' });
  });

  it('on a dropped connection, keeps the link and tries again', async () => {
    scriptFetch({ '/v1/auth/email/verify': [new TypeError('Failed to fetch'), json(200, GRANT)] });
    await mountAt(`/verify-email?token=${TOKEN}`);
    expect(await screen.findByRole('heading', { name: "We couldn't confirm your email" })).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(where.pathname).toBe('/onboarding'));
  });

  it('treats a missing or cut-short token as a broken link and sends nothing', async () => {
    const calls = scriptFetch({});
    await mountAt('/verify-email?token=too-short');
    expect(screen.getByRole('heading', { name: "This link doesn't work" })).not.toBeNull();
    expect(calls.filter((c) => c.path === '/v1/auth/email/verify')).toHaveLength(0);
  });

  it('on a 429, holds the button and names the time to try again on a 12-hour clock', async () => {
    scriptFetch({
      '/v1/auth/email/verify': apiError(410, 'VERIFICATION_TOKEN_EXPIRED'),
      '/v1/auth/email/resend': apiError(429, 'RATE_LIMITED', { 'Retry-After': '60' }),
    });
    await mountAt(`/verify-email?token=${TOKEN}`);
    await screen.findByRole('heading', { name: 'This link has expired' });

    fireEvent.change(screen.getByRole('textbox', { name: 'Email' }), { target: { value: 'owner@zaytoun.ca' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send a new link' }));

    expect(await screen.findByText('Too many attempts from this device')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Send a new link' }).getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByText(/You can send another at/).textContent).toMatch(TWELVE_HOUR);
  });
});
