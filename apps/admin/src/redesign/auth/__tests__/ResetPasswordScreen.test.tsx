import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { captureLinkToken } from '@hg/ui-web/link-token';

import { fixture, mockApi, renderRedesign, resetSession, type MockApi } from '../../testing';
import { ResetPasswordScreen } from '..';

// A well-formed link token for the test (32+ URL-safe characters), not a credential.
const TOKEN = 'reset-link-token-for-tests'.padEnd(36, 'x');
const EMAIL = 'sana.qureshi@halalgoes.ca';
const GOOD = 'kettle-orchard-violet-41';
const LINK_PATHS = ['/reset-password', '/accept-invite'];

function openLink(token: string | null) {
  window.history.replaceState(null, '', token === null ? '/reset-password' : `/reset-password?token=${token}`);
  captureLinkToken(LINK_PATHS);
}

function render() {
  return renderRedesign(<ResetPasswordScreen />, { signedIn: false });
}

const emailField = () => screen.getByLabelText(/^Work email/, { selector: 'input' }) as HTMLInputElement;
const passwordField = () => screen.getByLabelText(/^New password/, { selector: 'input' }) as HTMLInputElement;

let api: MockApi;
beforeEach(() => {
  api = mockApi({ requestPasswordReset: { status: 200, body: { data: { acknowledged: true } } }, resetPassword: { status: 204 } });
});

afterEach(() => {
  cleanup();
  resetSession();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
  captureLinkToken(LINK_PATHS);
});

describe('ResetPasswordScreen: ask for a link', () => {
  beforeEach(() => openLink(null));

  it('asks for the work email, then answers the same either way', async () => {
    render();
    expect(screen.getByRole('heading', { level: 1, name: 'Reset your password' })).toBeTruthy();
    expect(
      screen.getByText(
        'Enter your work email. If it belongs to a staff account, we send a link to choose a new password. It works for 30 minutes, once.',
      ),
    ).toBeTruthy();
    fireEvent.change(emailField(), { target: { value: EMAIL } });
    fireEvent.click(screen.getByRole('button', { name: 'Send reset link' }));
    const heading = await screen.findByRole('heading', { level: 1, name: 'Check your email' });
    await waitFor(() => expect(document.activeElement).toBe(heading));
    expect(
      screen.getByText(
        `If ${EMAIL} is a staff account, a reset link is on its way. It works for 30 minutes. Nothing changes until you choose a new password.`,
      ),
    ).toBeTruthy();
    expect(screen.getByText('No email after a few minutes? Check spam, or ask a super admin.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Back to sign in' }).getAttribute('href')).toBe('/');
    expect(api.callsTo('requestPasswordReset')[0]?.body).toEqual({ email: EMAIL });
  });

  it('sending: the field is read-only until the server answers', async () => {
    api.set({ requestPasswordReset: { pending: true } });
    render();
    fireEvent.change(emailField(), { target: { value: EMAIL } });
    fireEvent.click(screen.getByRole('button', { name: 'Send reset link' }));
    expect(await screen.findByText('Sending the link. The email field is read-only until the server answers.')).toBeTruthy();
    expect(emailField().readOnly).toBe(true);
  });

  it("didn't send: the alert takes focus and the email is kept", async () => {
    api.set({ requestPasswordReset: { status: 500, body: fixture('error_internal_error') } });
    render();
    fireEvent.change(emailField(), { target: { value: EMAIL } });
    fireEvent.click(screen.getByRole('button', { name: 'Send reset link' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('We couldn’t send the link.');
    expect(alert.textContent).toContain('Nothing was changed. Try again.');
    await waitFor(() => expect(document.activeElement).toBe(alert));
    expect(emailField().value).toBe(EMAIL);
  });

  it('links to the lost-authenticator help as a plain link (RV/SignIn-Forgot)', () => {
    render();
    const link = screen.getByRole('link', { name: 'Lost your authenticator app instead?' });
    expect(link.getAttribute('href')).toBe('/?help=lost');
    expect(screen.queryByRole('button', { name: 'Lost your authenticator app instead?' })).toBeNull();
  });

  it.each([
    ['', 'Enter your work email.'],
    ['staff@halalgoes', 'Enter an email address like name@halalgoes.ca.'],
  ])('checks the email shape before sending (%j)', async (typed, message) => {
    render();
    fireEvent.change(emailField(), { target: { value: typed } });
    fireEvent.click(screen.getByRole('button', { name: 'Send reset link' }));
    expect(await screen.findByText(message)).toBeTruthy();
    expect(emailField().getAttribute('aria-invalid')).toBe('true');
    await waitFor(() => expect(document.activeElement).toBe(emailField()));
    expect(api.callsTo('requestPasswordReset')).toHaveLength(0);
    // Fixing it clears the error; nothing is sent until the next submit.
    fireEvent.change(emailField(), { target: { value: EMAIL } });
    expect(emailField().getAttribute('aria-invalid')).toBeNull();
  });
});

describe('ResetPasswordScreen: from the emailed link', () => {
  beforeEach(() => openLink(TOKEN));

  it('takes the token out of the address bar and asks for a new password (no authenticator promise, Q3)', () => {
    expect(window.location.search).toBe('');
    render();
    expect(screen.getByRole('heading', { level: 1, name: 'Choose a new password' })).toBeTruthy();
    expect(
      screen.getByText(
        'Saving signs you out everywhere, on every device, and we email you to say the password changed. Then sign in with your new password.',
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/authenticator code/)).toBeNull();
  });

  it('too short: caught here, the link is not spent', async () => {
    render();
    fireEvent.change(passwordField(), { target: { value: 'salaam123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save password' }));
    expect(await screen.findByText('Use at least 12 characters. This one has 9.')).toBeTruthy();
    expect(passwordField().getAttribute('aria-invalid')).toBe('true');
    await waitFor(() => expect(document.activeElement).toBe(passwordField()));
    expect(api.callsTo('resetPassword')).toHaveLength(0);
  });

  it('breached (422): the field says why', async () => {
    api.set({ resetPassword: 'error_breached_password' });
    render();
    fireEvent.change(passwordField(), { target: { value: 'ramadanmubarak2026' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save password' }));
    expect(
      await screen.findByText(
        'This password has appeared in a data breach, so it isn’t safe. Choose a different one of at least 12 characters.',
      ),
    ).toBeTruthy();
    expect(passwordField().getAttribute('aria-invalid')).toBe('true');
  });

  it('saving: the field is read-only until the server answers', async () => {
    api.set({ resetPassword: { pending: true } });
    render();
    fireEvent.change(passwordField(), { target: { value: GOOD } });
    fireEvent.click(screen.getByRole('button', { name: 'Save password' }));
    expect(await screen.findByText('Saving. The field is read-only until the server answers.')).toBeTruthy();
    expect(passwordField().readOnly).toBe(true);
  });

  it("didn't save: the alert takes focus, the link still works", async () => {
    api.set({ resetPassword: { status: 503, body: fixture('error_internal_error') } });
    render();
    fireEvent.change(passwordField(), { target: { value: GOOD } });
    fireEvent.click(screen.getByRole('button', { name: 'Save password' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Your password wasn’t changed.');
    expect(alert.textContent).toContain('Try again; the link still works until it expires.');
    await waitFor(() => expect(document.activeElement).toBe(alert));
    expect(passwordField().value).toBe(GOOD);
  });

  it('expired or used (400 TOKEN_CONSUMED): ask for a new link', async () => {
    api.set({ resetPassword: 'error_reset_token_not_valid' });
    render();
    fireEvent.change(passwordField(), { target: { value: GOOD } });
    fireEvent.click(screen.getByRole('button', { name: 'Save password' }));
    expect(await screen.findByText('This link has expired or was already used', { selector: '[role="status"] *' })).toBeTruthy();
    expect(screen.getByText('Reset links work for 30 minutes, once. Nothing was changed. Ask for a new link.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Ask for a new link' }));
    const heading = screen.getByRole('heading', { level: 1, name: 'Reset your password' });
    await waitFor(() => expect(document.activeElement).toBe(heading));
  });

  it('done: password saved, signed out everywhere, go to sign in', async () => {
    render();
    fireEvent.change(passwordField(), { target: { value: GOOD } });
    fireEvent.click(screen.getByRole('button', { name: 'Save password' }));
    const heading = await screen.findByRole('heading', { level: 1, name: 'Password saved' });
    await waitFor(() => expect(document.activeElement).toBe(heading));
    expect(screen.getByText('You’ve been signed out everywhere. Sign in with your new password.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Go to sign in' }).getAttribute('href')).toBe('/');
    expect(api.callsTo('resetPassword')[0]?.body).toEqual({ token: TOKEN, new_password: GOOD });
  });
});

describe('ResetPasswordScreen: a link cut short', () => {
  it('a malformed token is the expired page, and nothing is sent', () => {
    openLink('short');
    render();
    expect(screen.getByRole('heading', { level: 1, name: 'This link has expired or was already used' })).toBeTruthy();
    expect(api.callsTo('resetPassword')).toHaveLength(0);
  });
});
