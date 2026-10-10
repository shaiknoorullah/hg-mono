/**
 * WP2 — `/register` (canvas SI `Register-*`): terms_version from config, never pre-ticked, the
 * error summary takes focus, the Idempotency-Key is reused on retry, 201 → Check your email.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { fixture, installFakeApi, type Handler } from '../test/fakeApi';
import { apiError, renderPublic } from '../test/authKit';
import { getSession } from '../../lib/api';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

const REGISTER = 'POST /v1/auth/register/restaurant';

function routes(register: Handler, extra: Record<string, Handler> = {}) {
  return { 'GET /v1/config/public': 'public_config', [REGISTER]: register, ...extra } as Record<string, Handler>;
}

async function fill({ name = 'Zaytoun Grill', email = 'samir@zaytoungrill.ca', password = 'a long kitchen password', accept = true } = {}) {
  fireEvent.change(await screen.findByLabelText(/^Restaurant name/), { target: { value: name } });
  fireEvent.change(screen.getByLabelText(/^Work email/), { target: { value: email } });
  fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: password } });
  if (accept) fireEvent.click(screen.getByRole('checkbox', { name: 'I have read and accept the partner terms' }));
}

function submit() {
  fireEvent.submit(screen.getByLabelText(/^Restaurant name/).closest('form')!);
}

describe('register', () => {
  it('Default: fields, helpers, the terms version from config and an unticked box', async () => {
    installFakeApi(routes('restaurant_registration'));
    await renderPublic('/register');
    expect(await screen.findByRole('heading', { level: 1, name: 'Register your restaurant' })).toBeTruthy();
    expect(screen.getByText('The name customers know you by. You’ll add the legal name later.')).toBeTruthy();
    expect(screen.getByText('We’ll send a confirmation link here.')).toBeTruthy();
    expect(screen.getByText('At least 12 characters. Use a password you don’t use anywhere else.')).toBeTruthy();
    expect(screen.getByLabelText(/^Work email/).getAttribute('autocomplete')).toBe('email');
    expect(screen.getByLabelText(/^Password/).getAttribute('autocomplete')).toBe('new-password');
    expect(await screen.findByText('Version 2026-05-01')).toBeTruthy();
    // Needs API: no terms URL, so the label is not a link.
    expect(screen.getByText('Read the partner terms').closest('a')).toBeNull();
    expect(screen.getByRole('checkbox', { name: 'I have read and accept the partner terms' }).getAttribute('aria-checked')).toBe('false');
    expect(screen.getByRole('link', { name: 'Sign in' }).getAttribute('href')).toBe('/login');
  });

  it('Errors: the summary takes focus, lists each field in order and its links move focus; nothing is sent', async () => {
    const api = installFakeApi(routes('restaurant_registration'));
    await renderPublic('/register');
    await screen.findByText('Version 2026-05-01');
    await fill({ name: 'Z', email: 'samir@', password: 'short', accept: false });
    submit();
    const summary = await screen.findByTestId('InlineAlert');
    expect(summary.getAttribute('role')).toBe('alert');
    expect(document.activeElement).toBe(summary);
    expect(within(summary).getByText('4 things need changing before we can create your account')).toBeTruthy();
    expect(within(summary).getAllByRole('link').map((a) => a.textContent)).toEqual(['Restaurant name', 'Work email', 'Password', 'Partner terms']);
    expect(screen.getByText('Enter at least 2 characters.')).toBeTruthy();
    expect(screen.getByText('Enter a full email address, like name@restaurant.ca.')).toBeTruthy();
    expect(screen.getByText('Use at least 12 characters.')).toBeTruthy();
    expect(screen.getByText('Accept the partner terms to create your account.')).toBeTruthy();
    fireEvent.click(within(summary).getByRole('link', { name: 'Work email' }));
    expect(document.activeElement).toBe(screen.getByLabelText(/^Work email/));
    fireEvent.click(within(summary).getByRole('link', { name: 'Partner terms' }));
    expect(document.activeElement).toBe(screen.getByRole('checkbox', { name: 'I have read and accept the partner terms' }));
    // Values kept, password as typed.
    expect((screen.getByLabelText(/^Password/) as HTMLInputElement).value).toBe('short');
    expect(api.callsTo(REGISTER)).toHaveLength(0);
  });

  it('201: sends terms_version from config with an Idempotency-Key, issues no session, opens Check your email', async () => {
    const api = installFakeApi(routes({ status: 201, body: { ...fixture('restaurant_registration'), email: 'samir@zaytoungrill.ca' } }));
    await renderPublic('/register');
    await screen.findByText('Version 2026-05-01');
    await fill();
    submit();
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/check-email'));
    const [req] = api.callsTo(REGISTER);
    expect(await req!.json()).toEqual({
      email: 'samir@zaytoungrill.ca',
      password: 'a long kitchen password',
      business_name: 'Zaytoun Grill',
      terms_version: '2026-05-01',
    });
    expect(req!.headers.get('Idempotency-Key')).toMatch(/.{16,}/);
    expect(req!.headers.get('X-HG-Client')).toBe('restaurant-web');
    expect(getSession()).toBeNull();
    const card = await screen.findByTestId('check-email-card');
    expect(within(card).getByRole('heading', { name: 'Check your email' })).toBeTruthy();
    expect(card.textContent).toContain('Open the link we sent to samir@zaytoungrill.ca to continue setting up Zaytoun Grill.');
  });

  it('NetError: the neutral alert takes focus, and Try again reuses the same Idempotency-Key', async () => {
    const api = installFakeApi(
      routes((_req, n) => (n === 1 ? apiError(503, 'RATE_LIMITER_UNAVAILABLE') : { status: 201, body: fixture('restaurant_registration') })),
    );
    await renderPublic('/register');
    await screen.findByText('Version 2026-05-01');
    await fill();
    submit();
    const alert = await screen.findByTestId('InlineAlert');
    expect(within(alert).getByText('Your account wasn’t created')).toBeTruthy();
    expect(document.activeElement).toBe(alert);
    // Values kept, box still ticked.
    expect(screen.getByRole('checkbox', { name: 'I have read and accept the partner terms' }).getAttribute('aria-checked')).toBe('true');
    submit();
    await waitFor(() => expect(api.callsTo(REGISTER)).toHaveLength(2));
    const [first, second] = api.callsTo(REGISTER);
    expect(second!.headers.get('Idempotency-Key')).toBe(first!.headers.get('Idempotency-Key'));
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/check-email'));
  });

  it('422 from the server: VALIDATION_FAILED field errors and BREACHED_PASSWORD land on their fields', async () => {
    installFakeApi(
      routes(
        apiError(422, 'VALIDATION_FAILED', { details: [{ field: 'email', code: 'format', message: 'not an email' }] }),
      ),
    );
    await renderPublic('/register');
    await screen.findByText('Version 2026-05-01');
    await fill();
    submit();
    const summary = await screen.findByTestId('InlineAlert');
    expect(within(summary).getByText('1 thing needs changing before we can create your account')).toBeTruthy();
    expect(screen.getByText('Enter a full email address, like name@restaurant.ca.')).toBeTruthy();
    cleanup();
    installFakeApi(routes('error_breached_password'));
    await renderPublic('/register');
    await screen.findByText('Version 2026-05-01');
    await fill();
    submit();
    expect(await screen.findByText('This password appears in known data breaches. Choose a different one.')).toBeTruthy();
  });

  it('EmailTaken: an info alert with Sign in, and the email field says why', async () => {
    installFakeApi(routes(apiError(409, 'EMAIL_ALREADY_REGISTERED')));
    await renderPublic('/register');
    await screen.findByText('Version 2026-05-01');
    await fill();
    submit();
    const alert = await screen.findByTestId('InlineAlert');
    expect(alert.getAttribute('data-tone')).toBe('info');
    expect(document.activeElement).toBe(alert);
    expect(within(alert).getByText('An account already uses this email')).toBeTruthy();
    expect(screen.getByText('Already registered. Sign in, or use a different email.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/login'));
  });

  it('TermsUpdated: re-reads config, shows the new version and unticks the box; the retry sends the new version', async () => {
    const api = installFakeApi(
      routes((_req, n) => (n === 1 ? apiError(409, 'TERMS_VERSION_STALE', { details: { current: '2026-10' } }) : { status: 201, body: fixture('restaurant_registration') }), {
        'GET /v1/config/public': (_req, n) => ({ body: { ...fixture('public_config'), terms_version: n === 1 ? '2026-05-01' : '2026-10' } }),
      }),
    );
    await renderPublic('/register');
    await screen.findByText('Version 2026-05-01');
    await fill();
    submit();
    const alert = await screen.findByTestId('InlineAlert');
    expect(within(alert).getByText('The partner terms have changed')).toBeTruthy();
    expect(screen.getByText('Read the updated partner terms')).toBeTruthy();
    expect(await screen.findByText('Version 2026-10')).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: 'I have read and accept the partner terms' }).getAttribute('aria-checked')).toBe('false');
    await waitFor(() => expect(api.callsTo('GET /v1/config/public').length).toBeGreaterThanOrEqual(2));
    expect((screen.getByLabelText(/^Restaurant name/) as HTMLInputElement).value).toBe('Zaytoun Grill');
    fireEvent.click(screen.getByRole('checkbox', { name: 'I have read and accept the partner terms' }));
    submit();
    await waitFor(() => expect(api.callsTo(REGISTER)).toHaveLength(2));
    expect((await api.callsTo(REGISTER)[1]!.json()).terms_version).toBe('2026-10');
  });

  it('RateLimited: a status (no focus move), Create account unavailable with the wait line', async () => {
    installFakeApi(routes({ status: 429, body: fixture('error_register_restaurant_rate_limited'), headers: { 'Retry-After': '60' } }));
    await renderPublic('/register');
    await screen.findByText('Version 2026-05-01');
    await fill();
    submit();
    const status = await screen.findByTestId('InlineAlert');
    expect(status.getAttribute('role')).toBe('status');
    expect(within(status).getByText('Too many attempts from this device')).toBeTruthy();
    const button = screen.getByRole('button', { name: 'Create account' });
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.getAttribute('aria-describedby')).toBe('wait-reason');
    expect(screen.getByRole('timer', { name: 'until you can try again' }).textContent).toBe('1:00');
  });

  it('Create account waits for the config (terms_version is never guessed)', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    installFakeApi(routes('restaurant_registration', { 'GET /v1/config/public': async () => (await gate, { body: fixture('public_config') }) }));
    await renderPublic('/register');
    const button = await screen.findByRole('button', { name: 'Create account' });
    expect(button.getAttribute('aria-disabled')).toBe('true');
    release();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Create account' }).getAttribute('aria-disabled')).toBeNull());
  });
});
