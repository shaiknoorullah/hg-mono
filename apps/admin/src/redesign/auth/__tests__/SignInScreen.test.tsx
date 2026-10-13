import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import type { Schema } from '@hg/api-client';

import { endSession, getSession, markSessionEnded, startSession } from '../../data/session';
import { setToken } from '../../../lib/token';
import { mockApi, principalFor, renderRedesign, resetSession, type MockApi } from '../../testing';
import { SignInScreen } from '..';
import { markSignedOutOnPurpose, resetAuthMemory } from '../memory';

const EMAIL = 'aminah.r@halalgoes.ca';
// A test password (12+ characters), not a credential.
const PASSWORD = ['kettle', 'orchard', 'violet', '41'].join('-');

function envelope(code: string, message: string) {
  return { error: { code, message, request_id: '01JTESTREQUEST0000000000000' } };
}

function grant(principal: Schema['Principal']) {
  return {
    data: { access_token: 'fresh-access-token', refresh_token: null, expires_in: 900, is_new_account: false, principal },
  };
}

function render() {
  return renderRedesign(<SignInScreen />, { signedIn: false });
}

function fill(email = EMAIL, password = PASSWORD) {
  fireEvent.change(screen.getByLabelText(/^Work email/, { selector: 'input' }), { target: { value: email } });
  fireEvent.change(screen.getByLabelText(/^Password/, { selector: 'input' }), { target: { value: password } });
}

function submit() {
  fireEvent.click(screen.getByRole('button', { name: /^Sign in/ }));
}

function codeField(): HTMLInputElement | null {
  return document.querySelector<HTMLInputElement>('input[data-variant="otp"]');
}

let api: MockApi;

beforeEach(() => {
  resetSession();
  resetAuthMemory();
  api = mockApi({ login: { status: 200, body: grant(principalFor('ADMIN')) } });
});

afterEach(() => {
  cleanup();
  resetSession();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('SignInScreen', () => {
  it('asks for email and password only, with neutral copy (D1)', () => {
    render();
    expect(screen.getByRole('heading', { level: 1, name: 'Sign in' })).toBeTruthy();
    expect(screen.getByText('For HalalGoes staff. Sign in with your work email and password.')).toBeTruthy();
    expect(screen.queryByText(/Every staff account signs in/)).toBeNull();
    expect(codeField()).toBeNull();
    expect(screen.getByText('You are signed out after 30 minutes without activity, and 12 hours after you sign in.')).toBeTruthy();
    expect(screen.getByText('Setting up a new staff account? Open the link in your invite email.')).toBeTruthy();
    expect(document.querySelector('form')).toBeTruthy();
  });

  it('signs in with email and password, sends no totp_code, and starts the session', async () => {
    render();
    fill();
    submit();
    await waitFor(() => expect(getSession().principal).not.toBeNull());
    const [call] = api.callsTo('login');
    expect(call?.body).toEqual({ email: EMAIL, password: PASSWORD });
    expect(call?.body).not.toHaveProperty('totp_code');
    expect(call?.headers['x-hg-client']).toBe('admin-web');
    expect(getSession().principal?.roles[0]?.role).toBe('ADMIN');
  });

  it('signing in: the button is busy and the fields read-only until the server answers', async () => {
    api.set({ login: { pending: true } });
    render();
    fill();
    submit();
    await waitFor(() => expect(screen.getByRole('button', { name: /^Sign in/ }).getAttribute('aria-busy')).toBe('true'));
    expect((screen.getByLabelText(/^Work email/, { selector: 'input' }) as HTMLInputElement).readOnly).toBe(true);
    expect((screen.getByLabelText(/^Password/, { selector: 'input' }) as HTMLInputElement).readOnly).toBe(true);
    expect(api.callsTo('login')).toHaveLength(1);
  });

  it('403 ACCOUNT_NOT_ACTIVE: says the account cannot sign in right now', async () => {
    api.set({ login: { status: 403, body: envelope('ACCOUNT_NOT_ACTIVE', 'Not active.') } });
    render();
    fill();
    submit();
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('This account can’t sign in right now');
    expect(alert.textContent).toContain('Ask a super admin to check your account.');
    expect(getSession().principal).toBeNull();
  });

  it('shows field errors only after submit and sends nothing when a field is empty', () => {
    render();
    expect(screen.queryByText('Enter your work email.')).toBeNull();
    submit();
    expect(screen.getByText('Enter your work email.')).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByLabelText(/^Work email/, { selector: 'input' }));
    expect(api.callsTo('login')).toHaveLength(0);
  });

  it('401: the alert takes focus and no field is marked', async () => {
    api.set({ login: { status: 401, body: envelope('INVALID_CREDENTIALS', 'Those credentials are not valid.') } });
    render();
    fill();
    submit();
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('The email or password isn’t right');
    expect(alert.textContent).toContain('Check both and try again.');
    await waitFor(() => expect(document.activeElement).toBe(alert));
    expect(document.querySelectorAll('[aria-invalid="true"]')).toHaveLength(0);
    expect(getSession().principal).toBeNull();
  });

  it.each([403, 401])('%s MFA_REQUIRED: the code field appears, takes focus, and only then is totp_code sent', async (status) => {
    let calls = 0;
    api.set({
      login: () => {
        calls += 1;
        return calls === 1
          ? { status, body: envelope('MFA_REQUIRED', 'A verification code is required to sign in.') }
          : { status: 200, body: grant(principalFor('SUPER_ADMIN')) };
      },
    });
    render();
    fill();
    submit();
    await waitFor(() => expect(codeField()).not.toBeNull());
    const first = codeField()!;
    await waitFor(() => expect(document.activeElement).toBe(first));
    expect(first.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByText('This account uses two-step sign-in')).toBeTruthy();
    expect(screen.queryByText(/Staff accounts need a code every time/)).toBeNull();
    expect(screen.getByRole('status').textContent).toContain('This account uses two-step sign-in');
    expect(api.callsTo('login')[0]?.body).not.toHaveProperty('totp_code');

    fireEvent.change(first, { target: { value: '481207' } });
    submit();
    await waitFor(() => expect(getSession().principal).not.toBeNull());
    expect(api.callsTo('login')[1]?.body).toEqual({ email: EMAIL, password: PASSWORD, totp_code: '481207' });
  });

  it('a wrong code then reads "The email, password or code isn’t right"', async () => {
    let calls = 0;
    api.set({
      login: () => {
        calls += 1;
        return calls === 1
          ? { status: 403, body: envelope('MFA_REQUIRED', 'A verification code is required to sign in.') }
          : { status: 401, body: envelope('INVALID_CREDENTIALS', 'Those credentials are not valid.') };
      },
    });
    render();
    fill();
    submit();
    await waitFor(() => expect(codeField()).not.toBeNull());
    fireEvent.change(codeField()!, { target: { value: '000000' } });
    submit();
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('The email, password or code isn’t right');
    expect(alert.textContent).toContain('Check all three and try again.');
    await waitFor(() => expect(document.activeElement).toBe(alert));
  });

  it('an incomplete code is caught here, not sent', async () => {
    api.set({ login: { status: 403, body: envelope('MFA_REQUIRED', 'A verification code is required to sign in.') } });
    render();
    fill();
    submit();
    await waitFor(() => expect(codeField()).not.toBeNull());
    fireEvent.change(codeField()!, { target: { value: '12' } });
    submit();
    expect(api.callsTo('login')).toHaveLength(1);
    expect(codeField()!.getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(codeField());
  });

  it.each([
    ['423', { status: 423, body: envelope('ACCOUNT_LOCKED', 'Locked.') }],
    [
      '429 ACCOUNT_TEMPORARILY_LOCKED',
      { status: 429, body: envelope('ACCOUNT_TEMPORARILY_LOCKED', 'Locked.'), headers: { 'Retry-After': '900' } },
    ],
  ])('%s: too many attempts, never names the account or an unlock time', async (_name, reply) => {
    api.set({ login: reply });
    render();
    fill();
    submit();
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Too many attempts');
    expect(alert.textContent).toContain('Wait a few minutes, then try again.');
    expect(alert.textContent).not.toMatch(/\d{1,2}:\d{2}/);
    expect(alert.textContent).not.toContain(EMAIL);
    await waitFor(() => expect(document.activeElement).toBe(alert));
    const button = screen.getByRole('button', { name: 'Sign in, unavailable for a few minutes' });
    expect(button.getAttribute('aria-disabled')).toBe('true');
  });

  it('429: too many requests, with the retry time on a 12-hour clock from Retry-After', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-09T18:03:00Z')); // 2:03 pm in Toronto
    api.set({ login: { status: 429, body: envelope('RATE_LIMITED', 'Too many requests.'), headers: { 'Retry-After': '120' } } });
    render();
    fill();
    submit();
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Too many requests from this device');
    expect(alert.textContent).toContain('Try again at 2:05 pm.');
    await waitFor(() => expect(document.activeElement).toBe(alert));
    expect(screen.getByRole('button', { name: 'Sign in, unavailable for a few minutes' }).getAttribute('aria-disabled')).toBe(
      'true',
    );
  });

  it('503: sign-in is busy', async () => {
    api.set({ login: { status: 503, body: envelope('TIMEOUT', 'Busy.'), headers: { 'Retry-After': '2' } } });
    render();
    fill();
    submit();
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Sign-in is busy right now');
  });

  it('no answer at all: says so and keeps what was typed', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    render();
    fill();
    submit();
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('We couldn’t reach HalalGoes');
    expect((screen.getByLabelText(/^Work email/, { selector: 'input' }) as HTMLInputElement).value).toBe(EMAIL);
  });

  it('refuses an account with no staff role and starts no session', async () => {
    const customer: Schema['Principal'] = {
      ...principalFor('ADMIN'),
      roles: [{ role: 'CUSTOMER', scope_type: 'GLOBAL', scope_id: null }],
    };
    api.set({ login: { status: 200, body: grant(customer) } });
    render();
    fill();
    submit();
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('This account can’t use the admin console');
    expect(getSession().principal).toBeNull();
    await waitFor(() => expect(api.callsTo('logout')).toHaveLength(1));
    expect(api.callsTo('logout')[0]?.headers.authorization).toBe('Bearer fresh-access-token');
  });

  it('"Can’t sign in?" help opens with its heading focused, and Back returns focus to the link', async () => {
    render();
    const link = screen.getByRole('button', { name: 'Forgotten your password or lost your authenticator?' });
    fireEvent.click(link);
    const heading = screen.getByRole('heading', { level: 1, name: 'Can’t sign in?' });
    expect(document.activeElement).toBe(heading);
    expect(screen.getByRole('link', { name: 'Reset my password' }).getAttribute('href')).toBe('/reset-password');
    expect(screen.getByText('There are no recovery codes.')).toBeTruthy();
    expect(screen.queryByText(/use a password and an authenticator code every time/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Back to sign in' }));
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole('button', { name: 'Forgotten your password or lost your authenticator?' }),
      ),
    );
  });

  it('lost authenticator help from the code step keeps the on-call placeholders, and Back returns to the code field', async () => {
    api.set({ login: { status: 403, body: envelope('MFA_REQUIRED', 'A verification code is required to sign in.') } });
    render();
    fill();
    submit();
    await waitFor(() => expect(codeField()).not.toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Lost your authenticator?' }));
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1, name: 'Lost your authenticator app?' }));
    expect(screen.getByText(/\[ON-CALL NAME\], \[ON-CALL PHONE\]/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Back to sign in' }));
    await waitFor(() => expect(document.activeElement).toBe(codeField()));
    // What was typed is kept.
    expect((screen.getByLabelText(/^Work email/, { selector: 'input' }) as HTMLInputElement).value).toBe(EMAIL);
  });

  it('opened from the reset page\'s "Lost your authenticator app instead?" link: the help, focused, and the query is dropped', async () => {
    window.history.replaceState(null, '', '/?help=lost');
    render();
    const heading = screen.getByRole('heading', { level: 1, name: 'Lost your authenticator app?' });
    await waitFor(() => expect(document.activeElement).toBe(heading));
    expect(window.location.search).toBe('');
    fireEvent.click(screen.getByRole('button', { name: 'Back to sign in' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Sign in' })).toBeTruthy();
  });

  it('code needed is a danger alert (RV/SignIn-Errors) over one six-cell code field', async () => {
    api.set({ login: { status: 403, body: envelope('MFA_REQUIRED', 'A verification code is required to sign in.') } });
    render();
    fill();
    submit();
    await waitFor(() => expect(codeField()).not.toBeNull());
    expect(screen.getByRole('status').getAttribute('data-tone')).toBe('danger');
    // One real field (autocomplete one-time-code) under six drawn cells.
    expect(document.querySelectorAll('input[data-variant="otp"]')).toHaveLength(1);
    expect(codeField()!.getAttribute('autocomplete')).toBe('one-time-code');
    expect(document.querySelectorAll('[data-hg-otp-cell]')).toHaveLength(6);
    fireEvent.change(codeField()!, { target: { value: '48a12' } });
    expect(codeField()!.value).toBe('4812');
    expect(document.querySelector('[data-hg-otp-cell="3"]')!.textContent).toBe('2');
  });

  it('after signing out on purpose: the signed-out notice, with the last email filled in', async () => {
    render();
    fill();
    submit();
    await waitFor(() => expect(getSession().principal).not.toBeNull());
    cleanup();
    // What the Sign out buttons do (`app/signOut.ts`): record it, then end the session.
    markSignedOutOnPurpose();
    endSession();
    render();
    const notice = screen.getByRole('status');
    expect(notice.textContent).toContain('You’re signed out');
    expect(notice.textContent).toContain('You signed out of HalalGoes on this device. Sign in again to continue.');
    expect((screen.getByLabelText(/^Work email/, { selector: 'input' }) as HTMLInputElement).value).toBe(EMAIL);
  });

  it('no signed-out notice when the session ended under the page (its dialog already said why)', () => {
    startSession('t', principalFor('ADMIN'));
    markSessionEnded('expired');
    endSession();
    render();
    expect(screen.queryByText('You’re signed out')).toBeNull();
  });

  it('a legacy screen clearing the token is a session that ended, not a sign-out: no notice', () => {
    startSession('t', principalFor('ADMIN'));
    // What `src/lib/api.ts` does on a 401 from a legacy fallback screen.
    setToken(null);
    expect(getSession().principal).not.toBeNull();
    expect(getSession().ended).toBe('expired');
    endSession();
    render();
    expect(screen.queryByText('You’re signed out')).toBeNull();
    expect(screen.queryByText(/You signed out of HalalGoes/)).toBeNull();
  });
});
