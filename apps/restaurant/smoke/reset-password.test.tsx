import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { TOKEN, TWELVE_HOUR, apiError, installDomShims, json, mountAt, scriptFetch, where } from './linkPageHarness';

/**
 * `/reset-password` (issue #329): "Forgot your password?" without a token, "Set a new
 * password" with one, and every way either can go wrong.
 */
const password = () => screen.getByLabelText(/^New password/) as HTMLInputElement;
const email = () => screen.getByRole('textbox', { name: 'Email' });

function typePassword(value: string) {
  fireEvent.change(password(), { target: { value } });
  fireEvent.click(screen.getByRole('button', { name: 'Set new password' }));
}

describe('restaurant /reset-password', () => {
  beforeAll(installDomShims);

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    localStorage.clear();
    vi.resetModules();
  });

  it('is reachable from sign-in, and asks for a link without saying whether the account exists', async () => {
    const calls = scriptFetch({ '/v1/auth/password/forgot': json(200, { data: { acknowledged: true } }) });
    await mountAt('/login');
    fireEvent.click(screen.getByRole('link', { name: 'Reset it by email' }));
    expect(where.pathname).toBe('/reset-password');

    fireEvent.change(email(), { target: { value: 'owner@zaytoun.ca' } });
    fireEvent.click(screen.getByRole('button', { name: 'Email me a reset link' }));

    expect(await screen.findByRole('heading', { name: 'Check your email' })).not.toBeNull();
    expect(screen.getByText(/has a HalalGoes partner account/)).not.toBeNull();
    expect(calls.find((c) => c.path === '/v1/auth/password/forgot')!.body).toEqual({ email: 'owner@zaytoun.ca' });
  });

  it('keeps the email and offers a retry when the link could not be sent', async () => {
    scriptFetch({ '/v1/auth/password/forgot': new TypeError('Failed to fetch') });
    await mountAt('/reset-password');
    fireEvent.change(email(), { target: { value: 'owner@zaytoun.ca' } });
    fireEvent.click(screen.getByRole('button', { name: 'Email me a reset link' }));

    expect(await screen.findByText("We couldn't send the link")).not.toBeNull();
    expect((email() as HTMLInputElement).value).toBe('owner@zaytoun.ca');
    expect(screen.getByRole('button', { name: 'Try again' })).not.toBeNull();
  });

  it('sets the new password, signs this device out, and the token goes only in the body', async () => {
    localStorage.setItem('hg_restaurant_session_v1', JSON.stringify({ accessToken: 'old-session' }));
    const calls = scriptFetch({ '/v1/auth/password/reset': json(204) });
    await mountAt(`/reset-password?token=${TOKEN}`);
    await waitFor(() => expect(where.search).toBe(''));

    typePassword('correct-horse-battery-staple');

    expect(await screen.findByRole('heading', { name: 'Your new password is set' })).not.toBeNull();
    const reset = calls.find((c) => c.path === '/v1/auth/password/reset')!;
    expect(reset.body).toEqual({ token: TOKEN, new_password: 'correct-horse-battery-staple' });
    expect(calls.every((c) => !c.url.includes(TOKEN))).toBe(true);
    expect(localStorage.getItem('hg_restaurant_session_v1')).toBeNull();
  });

  it('refuses a short password on this device, before anything is sent', async () => {
    const calls = scriptFetch({});
    await mountAt(`/reset-password?token=${TOKEN}`);
    typePassword('salaam123');

    expect(await screen.findByText('Use at least 12 characters. This one has 9.')).not.toBeNull();
    expect(calls).toHaveLength(0);
    await waitFor(() => expect(document.activeElement).toBe(password()));
  });

  it('says a breached password was refused, on the field', async () => {
    scriptFetch({ '/v1/auth/password/reset': apiError(422, 'BREACHED_PASSWORD') });
    await mountAt(`/reset-password?token=${TOKEN}`);
    typePassword('password1234');

    expect(
      await screen.findByText('This password appears in known data breaches. Choose a different one.'),
    ).not.toBeNull();
  });

  it('on an expired or used link, offers a new one', async () => {
    scriptFetch({ '/v1/auth/password/reset': apiError(400, 'TOKEN_CONSUMED') });
    await mountAt(`/reset-password?token=${TOKEN}`);
    typePassword('correct-horse-battery-staple');

    expect(await screen.findByRole('heading', { name: "This link doesn't work any more" })).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Email me a new link' }));
    expect(screen.getByRole('heading', { name: 'Reset your password' })).not.toBeNull();
  });

  it('treats a cut-short token as a broken link and sends nothing', async () => {
    const calls = scriptFetch({});
    await mountAt('/reset-password?token=abc');
    expect(screen.getByRole('heading', { name: "This link doesn't work any more" })).not.toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('on a 429, keeps the password, holds the button and names a 12-hour time', async () => {
    scriptFetch({ '/v1/auth/password/reset': apiError(429, 'RATE_LIMITED', { 'Retry-After': '120' }) });
    await mountAt(`/reset-password?token=${TOKEN}`);
    typePassword('correct-horse-battery-staple');

    expect(await screen.findByText('Too many attempts from this device')).not.toBeNull();
    expect(password().value).toBe('correct-horse-battery-staple');
    expect(screen.getByRole('button', { name: 'Set new password' }).getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByText(/You can try again at/).textContent).toMatch(TWELVE_HOUR);
  });

  it('on a dropped connection or a 5xx, keeps the password and offers a retry', async () => {
    scriptFetch({ '/v1/auth/password/reset': [apiError(503, 'INTERNAL_ERROR'), json(204)] });
    await mountAt(`/reset-password?token=${TOKEN}`);
    typePassword('correct-horse-battery-staple');

    expect(await screen.findByText("We couldn't reach HalalGoes")).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { name: 'Your new password is set' })).not.toBeNull();
  });
});
