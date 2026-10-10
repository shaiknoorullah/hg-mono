/**
 * WP2 — the email-link pages (canvas SI `CheckEmail-*`, `Verify-*`, `Forgot-*`, `Reset-*`).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { captureLinkToken } from '@hg/ui-web/link-token';
import { installFakeApi, type Handler } from '../test/fakeApi';
import { apiError, renderPublic } from '../test/authKit';
import { getSession, setSession } from '../../lib/api';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  sessionStorage.clear();
  window.history.replaceState(null, '', '/');
});

const TOKEN = 'tok_0123456789abcdefghijklmnopqrstuvwxyz';
const location = () => screen.getByTestId('location').textContent;

function withConfig(routes: Record<string, Handler>): Record<string, Handler> {
  return { 'GET /v1/config/public': 'public_config', ...routes };
}

/** An email link opened at boot: the token is captured and stripped before the app renders. */
function openLink(path: string, token: string | null) {
  window.history.replaceState(null, '', token === null ? path : `${path}?token=${token}`);
  captureLinkToken(['/verify-email', '/reset-password']);
  expect(window.location.search).not.toContain('token');
}

describe('check your email', () => {
  const entry = { email: 'samir@zaytoungrill.ca', business_name: 'Zaytoun Grill', start: 'default' };

  it('Default: names the address and the restaurant; Send a new link starts the one-minute wait from the response', async () => {
    const api = installFakeApi(withConfig({ 'POST /v1/auth/email/resend': { status: 202, body: { acknowledged: true } } }));
    await renderPublic('/check-email', entry);
    const card = await screen.findByTestId('check-email-card');
    expect(within(card).getByRole('heading', { level: 1, name: 'Check your email' })).toBeTruthy();
    expect(card.textContent).toContain('Open the link we sent to samir@zaytoungrill.ca to continue setting up Zaytoun Grill.');
    expect(screen.getByRole('link', { name: 'Register again with the right one' }).getAttribute('href')).toBe('/register');
    expect(screen.getByText('The link works for 24 hours. Can’t find it? Check your spam folder, or send a new link.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Back to sign in' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Send a new link' }));
    expect(await screen.findByText('A new link is on its way. Earlier links no longer work, so use the newest email.')).toBeTruthy();
    expect(await api.callsTo('POST /v1/auth/email/resend')[0]!.json()).toEqual({ email: 'samir@zaytoungrill.ca' });
    const button = screen.getByRole('button', { name: 'Send a new link' });
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.getAttribute('aria-describedby')).toBe('wait-reason');
    expect(document.getElementById('wait-reason')!.textContent).toBe('You can send another in 1:00');
  });

  it('DailyLimit: a 429 whose Retry-After is over a minute is the daily limit', async () => {
    installFakeApi(withConfig({ 'POST /v1/auth/email/resend': apiError(429, 'RATE_LIMITED', { headers: { 'Retry-After': '86400' } }) }));
    await renderPublic('/check-email', entry);
    fireEvent.click(await screen.findByRole('button', { name: 'Send a new link' }));
    const alert = await screen.findByTestId('InlineAlert');
    expect(alert.getAttribute('role')).toBe('status');
    expect(within(alert).getByText('You’ve asked for 5 links today')).toBeTruthy();
    expect(within(alert).getByText('That’s the daily limit. Use the newest email you have, or call partner support.')).toBeTruthy();
    expect(screen.getByRole('timer', { name: 'until tomorrow’s limit resets' }).textContent).toBe('24:00:00');
  });

  it('Offline: a neutral alert takes focus; the button keeps its label', async () => {
    installFakeApi(withConfig({ 'POST /v1/auth/email/resend': apiError(500, 'INTERNAL_ERROR') }));
    await renderPublic('/check-email', entry);
    fireEvent.click(await screen.findByRole('button', { name: 'Send a new link' }));
    const alert = await screen.findByTestId('InlineAlert');
    expect(alert.getAttribute('role')).toBe('alert');
    expect(document.activeElement).toBe(alert);
    expect(within(alert).getByText('We couldn’t send a new link')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Send a new link' }).getAttribute('aria-disabled')).toBeNull();
  });
});

describe('verify email', () => {
  it('Working, then confirmed: the token goes only in the POST body and no session starts', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const api = installFakeApi(withConfig({ 'POST /v1/auth/email/verify': async () => (await gate, { status: 204 }) }));
    openLink('/verify-email', TOKEN);
    await renderPublic('/verify-email');
    expect(await screen.findByRole('heading', { name: 'Confirming your email' })).toBeTruthy();
    expect(screen.getByText('Confirming your email…').getAttribute('role')).toBe('status');
    release();
    expect(await screen.findByRole('heading', { name: 'Your email is confirmed' })).toBeTruthy();
    const [req] = api.callsTo('POST /v1/auth/email/verify');
    expect(await req!.json()).toEqual({ token: TOKEN });
    expect(req!.url).not.toContain(TOKEN);
    expect(getSession()).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(location()).toBe('/login'));
  });

  it('Used: 410 VERIFICATION_TOKEN_USED is not an error; Sign in, no resend', async () => {
    installFakeApi(withConfig({ 'POST /v1/auth/email/verify': 'error_verification_token_used' }));
    openLink('/verify-email', TOKEN);
    await renderPublic('/verify-email');
    expect(await screen.findByRole('heading', { name: 'This link has already been used' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Send a new link' })).toBeNull();
  });

  it('Expired → sending → Check your email in its wait', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const api = installFakeApi(
      withConfig({
        'POST /v1/auth/email/verify': 'error_verification_token_expired',
        'POST /v1/auth/email/resend': async () => (await gate, { status: 202, body: { acknowledged: true } }),
      }),
    );
    openLink('/verify-email', TOKEN);
    await renderPublic('/verify-email');
    expect(await screen.findByRole('heading', { name: 'This link has expired' })).toBeTruthy();
    expect(screen.getByText('Already confirmed your email?', { exact: false })).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/^Email/), { target: { value: 'samir@zaytoungrill.ca' } });
    fireEvent.submit(screen.getByLabelText(/^Email/).closest('form')!);
    // ExpiredSending: read-only email, busy form, no "Already confirmed" line.
    await waitFor(() => expect(screen.getByLabelText(/^Email/).hasAttribute('readonly')).toBe(true));
    expect(screen.getByLabelText(/^Email/).closest('form')!.getAttribute('aria-busy')).toBe('true');
    expect(screen.queryByText('Already confirmed your email?', { exact: false })).toBeNull();
    release();
    await waitFor(() => expect(location()).toBe('/check-email'));
    expect(await screen.findByText('A new link is on its way. Earlier links no longer work, so use the newest email.')).toBeTruthy();
    expect(await api.callsTo('POST /v1/auth/email/resend')[0]!.json()).toEqual({ email: 'samir@zaytoungrill.ca' });
  });

  it('a malformed token is the expired state, and nothing is sent', async () => {
    const api = installFakeApi(withConfig({}));
    openLink('/verify-email', 'short');
    await renderPublic('/verify-email');
    expect(await screen.findByRole('heading', { name: 'This link has expired' })).toBeTruthy();
    expect(api.callsTo('POST /v1/auth/email/verify')).toHaveLength(0);
  });

  it('ExpiredError: resend fails → danger alert with Try again, email kept', async () => {
    installFakeApi(
      withConfig({
        'POST /v1/auth/email/verify': 'error_verification_token_expired',
        'POST /v1/auth/email/resend': apiError(503, 'TIMEOUT'),
      }),
    );
    openLink('/verify-email', TOKEN);
    await renderPublic('/verify-email');
    fireEvent.change(await screen.findByLabelText(/^Email/), { target: { value: 'samir@zaytoungrill.ca' } });
    fireEvent.submit(screen.getByLabelText(/^Email/).closest('form')!);
    const alert = await screen.findByTestId('InlineAlert');
    expect(alert.getAttribute('data-tone')).toBe('danger');
    expect(within(alert).getByText('We couldn’t send a new link')).toBeTruthy();
    expect(document.activeElement).toBe(alert);
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
    expect((screen.getByLabelText(/^Email/) as HTMLInputElement).value).toBe('samir@zaytoungrill.ca');
  });

  it('Error: network failure → alert container with Try again, which re-sends the same token', async () => {
    const api = installFakeApi(
      withConfig({ 'POST /v1/auth/email/verify': (_req, n) => (n === 1 ? apiError(500, 'INTERNAL_ERROR') : { status: 204 }) }),
    );
    openLink('/verify-email', TOKEN);
    await renderPublic('/verify-email');
    expect(await screen.findByRole('heading', { name: 'We couldn’t confirm your email' })).toBeTruthy();
    expect(screen.getByText('We couldn’t reach HalalGoes. Check your connection and try again. Your link still works.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { name: 'Your email is confirmed' })).toBeTruthy();
    const calls = api.callsTo('POST /v1/auth/email/verify');
    expect(calls).toHaveLength(2);
    expect(await calls[1]!.json()).toEqual({ token: TOKEN });
  });
});

describe('forgot password', () => {
  it('prefills the email from sign-in, sends, and Sent never says whether the account exists', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const api = installFakeApi(withConfig({ 'POST /v1/auth/password/forgot': async () => (await gate, { body: { acknowledged: true } }) }));
    await renderPublic('/forgot-password', { email: 'samir@zaytoungrill.ca' });
    expect(await screen.findByRole('heading', { name: 'Reset your password' })).toBeTruthy();
    expect(screen.getByText('Enter the email you registered with. We’ll send a link to set a new password.')).toBeTruthy();
    const field = screen.getByLabelText(/^Email/) as HTMLInputElement;
    expect(field.value).toBe('samir@zaytoungrill.ca');
    expect(field.getAttribute('autocomplete')).toBe('username');
    expect(await screen.findByTestId('support-sentence')).toBeTruthy();
    fireEvent.submit(field.closest('form')!);
    await waitFor(() => expect(field.hasAttribute('readonly')).toBe(true));
    release();
    expect(await screen.findByRole('heading', { name: 'Check your email' })).toBeTruthy();
    expect(screen.getByTestId('forgot-sent').textContent).toContain(
      'If samir@zaytoungrill.ca has a HalalGoes partner account, we’ve sent it a link to set a new password.',
    );
    expect(screen.getByText('The link works for 30 minutes and only once. Can’t find it? Check your spam folder, or ask for another.')).toBeTruthy();
    expect(screen.queryByTestId('support-sentence')).toBeNull();
    expect(await api.callsTo('POST /v1/auth/password/forgot')[0]!.json()).toEqual({ email: 'samir@zaytoungrill.ca' });
    fireEvent.click(screen.getByRole('button', { name: 'Send another link' }));
    expect(await screen.findByRole('heading', { name: 'Reset your password' })).toBeTruthy();
  });

  it('Error: a neutral alert takes focus, the email is kept, the button says Try again', async () => {
    installFakeApi(withConfig({ 'POST /v1/auth/password/forgot': apiError(500, 'INTERNAL_ERROR') }));
    await renderPublic('/forgot-password', { email: 'samir@zaytoungrill.ca' });
    fireEvent.submit((await screen.findByLabelText(/^Email/)).closest('form')!);
    const alert = await screen.findByTestId('InlineAlert');
    expect(within(alert).getByText('We couldn’t send the link')).toBeTruthy();
    expect(document.activeElement).toBe(alert);
    expect((screen.getByLabelText(/^Email/) as HTMLInputElement).value).toBe('samir@zaytoungrill.ca');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });
});

describe('reset password', () => {
  async function typeAndSave(password: string) {
    const field = await screen.findByLabelText(/^New password/);
    fireEvent.change(field, { target: { value: password } });
    fireEvent.submit(field.closest('form')!);
    return field;
  }

  it('Set: copy, autocomplete and the sign-out warning; a short password is refused here and never spends the link', async () => {
    const api = installFakeApi(withConfig({ 'POST /v1/auth/password/reset': { status: 204 } }));
    openLink('/reset-password', TOKEN);
    await renderPublic('/reset-password');
    expect(await screen.findByRole('heading', { name: 'Set a new password' })).toBeTruthy();
    expect(screen.getByText('At least 12 characters. Any characters are fine; we refuse passwords known from data breaches.')).toBeTruthy();
    expect(screen.getByLabelText(/^New password/).getAttribute('autocomplete')).toBe('new-password');
    expect(screen.getByText(/^Setting a new password signs you out on every device/)).toBeTruthy();
    const field = await typeAndSave('elevenchars');
    expect(await screen.findByText('Use at least 12 characters.')).toBeTruthy();
    expect(document.activeElement).toBe(field);
    expect(api.callsTo('POST /v1/auth/password/reset')).toHaveLength(0);
  });

  it('PasswordError: 422 BREACHED_PASSWORD puts the error on the field and focus moves there', async () => {
    installFakeApi(withConfig({ 'POST /v1/auth/password/reset': 'error_breached_password' }));
    openLink('/reset-password', TOKEN);
    await renderPublic('/reset-password');
    const field = await typeAndSave('password1234567');
    expect(await screen.findByText('This password appears in known data breaches. Choose a different one.')).toBeTruthy();
    expect(document.activeElement).toBe(field);
  });

  it('LinkInvalid: 400 TOKEN_CONSUMED, or no token at all', async () => {
    installFakeApi(withConfig({ 'POST /v1/auth/password/reset': 'error_reset_token_not_valid' }));
    openLink('/reset-password', TOKEN);
    await renderPublic('/reset-password');
    await typeAndSave('a fine new password');
    expect(await screen.findByRole('heading', { name: 'This link doesn’t work any more' })).toBeTruthy();
    expect(screen.getByText('Reset links work for 30 minutes and only once. Ask for a new one and use the newest email.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Back to sign in' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Email me a new link' }));
    await waitFor(() => expect(location()).toBe('/forgot-password'));
    cleanup();
    installFakeApi(withConfig({}));
    openLink('/reset-password', null);
    await renderPublic('/reset-password');
    expect(await screen.findByRole('heading', { name: 'This link doesn’t work any more' })).toBeTruthy();
  });

  it('Saving then Done: the sign-out paragraph hides while saving; Done clears this device’s session and goes to sign in', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const api = installFakeApi(withConfig({ 'POST /v1/auth/password/reset': async () => (await gate, { status: 204 }) }));
    openLink('/reset-password', TOKEN);
    await renderPublic('/reset-password');
    setSession({ accessToken: 'old-token' });
    const field = await typeAndSave('a fine new password');
    await waitFor(() => expect(field.hasAttribute('readonly')).toBe(true));
    expect(screen.queryByText(/^Setting a new password signs you out/)).toBeNull();
    release();
    expect(await screen.findByRole('heading', { name: 'Your new password is set' })).toBeTruthy();
    expect(await api.callsTo('POST /v1/auth/password/reset')[0]!.json()).toEqual({ token: TOKEN, new_password: 'a fine new password' });
    expect(getSession()).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(location()).toBe('/login'));
  });

  it('a network failure keeps the password and the link', async () => {
    installFakeApi(withConfig({}));
    openLink('/reset-password', TOKEN);
    await renderPublic('/reset-password');
    await screen.findByLabelText(/^New password/);
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))));
    await typeAndSave('a fine new password');
    const alert = await screen.findByTestId('InlineAlert');
    expect(alert.getAttribute('role')).toBe('alert');
    expect((screen.getByLabelText(/^New password/) as HTMLInputElement).value).toBe('a fine new password');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });
});
