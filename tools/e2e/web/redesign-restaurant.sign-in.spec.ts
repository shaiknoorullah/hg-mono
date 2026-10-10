/**
 * Restaurant redesign WP2: sign-in and account access (canvas SI; manifest §2.1, §6 row WP2).
 * Runs at desktop 1440×900 and tablet 1024×768, flag on.
 *
 * - Mock mode (default): the app on `pnpm mock`. States the stateless mock cannot give are
 *   answered with `page.route`, each naming the contract envelope it stands in for (login error
 *   variants and a restaurant owner's SessionGrant have no fixture yet: requested in #676).
 * - Real mode (`E2E_MODE=real`): the app on `services/hg` with devworld personas; these journeys
 *   drive the sign-in form itself (the support file signs in through the API for other specs).
 *   Register → verify → sign in → forgot → reset → sign in runs on a new owner each time, and
 *   reads the emailed links from the local database the way devworld does (`E2E_PSQL_CMD`).
 */
import { execSync } from 'node:child_process';
import { copyFileSync, mkdirSync } from 'node:fs';
import { expect, test, type Page, type Route, type TestInfo } from '@playwright/test';
import { documentScrolls, LIVE_OWNER, MODE, REAL_API, restaurantPrincipal } from './redesign-restaurant.support';

const SHOTS = process.env.WP2_SHOTS_DIR ?? '/tmp/claude-0/-home-user-hg-mono/d41301d3-8d3a-541d-a6f4-40d847c8b738/scratchpad/shots/wp2';

/** Every public page: the document never scrolls (only `<main>` may) and nothing overflows sideways. */
async function expectNoDocumentScroll(page: Page) {
  const m = await documentScrolls(page);
  expect(m.scrollHeight, 'document must not scroll vertically').toBeLessThanOrEqual(m.innerHeight);
  expect(m.scrollWidth, 'document must not scroll horizontally').toBeLessThanOrEqual(m.innerWidth);
}

async function shot(page: Page, info: TestInfo, state: string) {
  const name = `${info.project.name}-${state}.png`;
  const path = info.outputPath(name);
  await page.screenshot({ path });
  try {
    mkdirSync(SHOTS, { recursive: true });
    copyFileSync(path, `${SHOTS}/${name}`);
  } catch {
    /* the copy is a convenience for review */
  }
}

/** Settled, measured, saved: the three checks every state gets. */
async function check(page: Page, info: TestInfo, state: string) {
  await page.waitForLoadState('networkidle');
  await expectNoDocumentScroll(page);
  await shot(page, info, state);
}

function error(code: string, status: number, extra: { details?: unknown; headers?: Record<string, string> } = {}) {
  return (route: Route) =>
    route.fulfill({
      status,
      // Named, not '*': the auth calls carry credentials, and '*' exposes nothing to those.
      headers: { 'Access-Control-Expose-Headers': 'Retry-After, Date, X-Request-ID', ...(extra.headers ?? {}) },
      json: { error: { code, message: code, request_id: 'req_e2e', ...(extra.details === undefined ? {} : { details: extra.details }) } },
    });
}

async function fillSignIn(page: Page, email: string, password: string) {
  await page.getByLabel(/^Email/).fill(email);
  await page.getByLabel(/^Password/).fill(password);
}

test.describe('restaurant redesign · sign in (mock)', () => {
  test.skip(MODE === 'real', 'mock-mode states');

  test('Main: the board, Enter submits, and a restaurant owner lands on orders', async ({ page }, info) => {
    const principal = await restaurantPrincipal(page);
    await page.route('**/v1/auth/me', (route) => route.fulfill({ json: { data: principal } }));
    // Stands in for a restaurant owner's SessionGrant (fixture requested in #676).
    await page.route('**/v1/auth/login', async (route) => {
      expect(route.request().headers()['x-hg-client']).toBe('restaurant-web');
      expect(route.request().postDataJSON()).not.toHaveProperty('totp_code');
      await route.fulfill({ json: { data: { access_token: 'mock-access-token', refresh_token: null, expires_in: 900, is_new_account: false, principal } } });
    });
    await page.goto('/login');
    await expect(page.getByRole('heading', { level: 1, name: 'Sign in to your restaurant' })).toBeVisible();
    await expect(page.getByText('Restaurant partner')).toBeVisible();
    await expect(page.getByRole('navigation')).toHaveCount(0);
    await expect(page.getByTestId('support-sentence')).toContainText('Need help signing in? Call partner support on');
    await check(page, info, 'main');
    await fillSignIn(page, 'samir@zaytoungrill.ca', 'correct horse battery');
    await page.getByLabel(/^Password/).press('Enter');
    await expect(page).toHaveURL(/\/orders$/);
    await expect(page.getByTestId('console-rail')).toBeVisible();
  });

  test('Submitting: the form is busy and the button shows progress', async ({ page }, info) => {
    await page.route('**/v1/auth/login', () => undefined); // never answers
    await page.goto('/login');
    await fillSignIn(page, 'samir@zaytoungrill.ca', 'correct horse battery');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.locator('form[aria-busy="true"]')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign in' })).toHaveAttribute('aria-busy', 'true');
    await expectNoDocumentScroll(page);
    await shot(page, info, 'submitting');
  });

  test('Invalid: focus moves to the alert, the password is cleared', async ({ page }, info) => {
    await page.route('**/v1/auth/login', error('INVALID_CREDENTIALS', 401));
    await page.goto('/login');
    await fillSignIn(page, 'samir@zaytoungrill.ca', 'wrong password!');
    await page.getByLabel(/^Password/).press('Enter');
    const alert = page.getByTestId('InlineAlert');
    await expect(alert).toContainText('Email or password is incorrect');
    await expect(alert).toBeFocused();
    await expect(page.getByLabel(/^Password/)).toHaveValue('');
    await expect(page.getByLabel(/^Email/)).toHaveValue('samir@zaytoungrill.ca');
    await check(page, info, 'invalid');
  });

  test('Unverified: Send a new link opens Check your email in its wait', async ({ page }, info) => {
    await page.route('**/v1/auth/login', error('INVALID_CREDENTIALS', 401, { details: { email_verification_required: true } }));
    await page.goto('/login');
    await fillSignIn(page, 'samir@zaytoungrill.ca', 'correct horse battery');
    await page.getByLabel(/^Password/).press('Enter');
    await expect(page.getByText('Confirm your email to sign in')).toBeVisible();
    await check(page, info, 'unverified');
    await page.getByRole('button', { name: 'Send a new link' }).click();
    await expect(page).toHaveURL(/\/check-email$/);
    await expect(page.getByText('A new link is on its way. Earlier links no longer work, so use the newest email.')).toBeVisible();
    await expect(page.locator('#wait-reason')).toContainText('You can send another in');
    await check(page, info, 'check-email-cooldown');
  });

  test('TooMany: Try again waits for Retry-After', async ({ page }, info) => {
    await page.route('**/v1/auth/login', error('RATE_LIMITED', 429, { headers: { 'Retry-After': '60' } }));
    await page.goto('/login');
    await fillSignIn(page, 'samir@zaytoungrill.ca', 'correct horse battery');
    await page.getByLabel(/^Password/).press('Enter');
    await expect(page.getByText('Too many attempts from this device')).toBeVisible();
    const button = page.getByRole('button', { name: 'Try again' });
    await expect(button).toHaveAttribute('aria-disabled', 'true');
    await expect(button).toHaveAttribute('aria-describedby', 'wait-reason');
    await expect(page.locator('#wait-reason')).toContainText(/You can try again in (0:5\d|1:00)/);
    await check(page, info, 'too-many');
  });

  test('Locked (backend 429 ACCOUNT_TEMPORARILY_LOCKED): focus on the alert, Call partner support, 15-minute wait', async ({ page }, info) => {
    await page.route('**/v1/auth/login', error('ACCOUNT_TEMPORARILY_LOCKED', 429, { headers: { 'Retry-After': '900' } }));
    await page.goto('/login');
    await expect(page.getByTestId('support-sentence')).toBeVisible();
    await fillSignIn(page, 'samir@zaytoungrill.ca', 'correct horse battery');
    await page.getByLabel(/^Password/).press('Enter');
    await expect(page.getByTestId('InlineAlert')).toBeFocused();
    await expect(page.getByRole('link', { name: 'Call partner support' })).toHaveAttribute('href', /^tel:\+/);
    await expect(page.getByRole('button', { name: 'Sign in' })).toHaveAttribute('aria-disabled', 'true');
    await expect(page.getByRole('timer')).toHaveText(/^1[45]:\d\d$/);
    await check(page, info, 'locked');
    // aria-disabled, yet live: activating it says the wait again and sends nothing.
    let attempts = 0;
    page.on('request', (r) => {
      if (r.url().endsWith('/v1/auth/login') && r.method() === 'POST') attempts += 1;
    });
    // Keyboard activation (Playwright's click refuses an aria-disabled target, as a mouse user
    // would see it as disabled; a keyboard or screen-reader user can still activate it).
    await page.getByRole('button', { name: 'Sign in' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('announcer-polite')).toHaveText(/^You can try again in 1[45] minutes/);
    expect(attempts).toBe(0);
  });

  test('Offline and server-busy share the Offline layout', async ({ page }, info) => {
    await page.route('**/v1/auth/login', (route) => route.abort('internetdisconnected'));
    await page.goto('/login');
    await fillSignIn(page, 'samir@zaytoungrill.ca', 'correct horse battery');
    await page.getByLabel(/^Password/).press('Enter');
    await expect(page.getByTestId('InlineAlert')).toContainText('We couldn’t reach HalalGoes');
    await expect(page.getByTestId('InlineAlert')).toBeFocused();
    await check(page, info, 'offline');
    await page.unroute('**/v1/auth/login');
    await page.route('**/v1/auth/login', error('TIMEOUT', 503));
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByTestId('InlineAlert')).toContainText('Try again in a moment.');
    await check(page, info, 'busy');
  });

  test('SessionExpired and ReuseDetected boards from the shell’s Sign in again', async ({ page }, info) => {
    await page.goto('/login?signed_out=expired&return_to=%2Forders');
    await expect(page.getByRole('heading', { name: 'You’ve been signed out' })).toBeVisible();
    await expect(page.getByTestId('InlineAlert')).toContainText('will time out after 3 minutes');
    await check(page, info, 'session-expired');
    await page.goto('/login?signed_out=reuse-detected');
    await expect(page.getByRole('heading', { name: 'We signed you out on every device' })).toBeVisible();
    await check(page, info, 'reuse-detected');
  });

  test('NotRestaurant: the mock’s customer grant is refused and explained', async ({ page }, info) => {
    await page.goto('/login');
    await fillSignIn(page, 'amina@example.ca', 'correct horse battery');
    await page.getByLabel(/^Password/).press('Enter');
    await expect(page.getByRole('heading', { name: 'This isn’t a restaurant account' })).toBeVisible();
    await check(page, info, 'not-restaurant');
    await page.getByRole('button', { name: 'Sign in with a different email' }).click();
    await expect(page.getByLabel(/^Email/)).toHaveValue('');
  });

  for (const [code, status, title, state] of [
    ['ACCOUNT_LOCKED', 423, 'This account is locked', 'locked-permanent'],
    ['ACCOUNT_SUSPENDED', 403, 'Your sign-in account is suspended', 'suspended'],
    ['ACCOUNT_NOT_ACTIVE', 403, 'This account isn’t active', 'not-active'],
  ] as const) {
    test(`Account card: ${code}`, async ({ page }, info) => {
      await page.route('**/v1/auth/login', error(code, status));
      await page.goto('/login');
      await fillSignIn(page, 'samir@zaytoungrill.ca', 'correct horse battery');
      await page.getByLabel(/^Password/).press('Enter');
      await expect(page.getByRole('heading', { name: title })).toBeVisible();
      await expect(page.getByTestId('support-block')).toBeVisible();
      await check(page, info, state);
      await page.getByRole('link', { name: 'Back to sign in' }).click();
      await expect(page.getByRole('heading', { name: 'Sign in to your restaurant' })).toBeVisible();
    });
  }

  test('Register: default, errors, email taken, terms changed, net error, rate limited, then created', async ({ page }, info) => {
    await page.goto('/register');
    await expect(page.getByRole('heading', { level: 1, name: 'Register your restaurant' })).toBeVisible();
    await expect(page.getByText(/^Version /)).toBeVisible();
    await expect(page.getByRole('checkbox', { name: 'I have read and accept the partner terms' })).toHaveAttribute('aria-checked', 'false');
    await check(page, info, 'register-default');

    await page.getByRole('button', { name: 'Create account' }).click();
    const summary = page.getByTestId('InlineAlert');
    await expect(summary).toContainText('4 things need changing before we can create your account');
    await expect(summary).toBeFocused();
    await check(page, info, 'register-errors');

    await page.getByLabel(/^Restaurant name/).fill('Zaytoun Grill');
    await page.getByLabel(/^Work email/).fill('samir@zaytoungrill.ca');
    await page.getByLabel(/^Password/).fill('a long kitchen password');
    await page.getByRole('checkbox', { name: 'I have read and accept the partner terms' }).click();

    const keys: string[] = [];
    let mode: 'taken' | 'terms' | 'net' | 'rate' | 'ok' = 'taken';
    await page.route('**/v1/auth/register/restaurant', async (route) => {
      keys.push(route.request().headers()['idempotency-key'] ?? '');
      if (mode === 'taken') return error('EMAIL_ALREADY_REGISTERED', 409)(route);
      if (mode === 'terms') return error('TERMS_VERSION_STALE', 409, { details: { current: '2026-10' } })(route);
      if (mode === 'net') return error('INTERNAL_ERROR', 500)(route);
      if (mode === 'rate') return error('RATE_LIMITED', 429, { headers: { 'Retry-After': '60' } })(route);
      return route.fulfill({ status: 201, json: { data: { restaurant_id: '927cc55c-8ddd-4d9f-a353-353ba2a8982b', email: 'samir@zaytoungrill.ca', onboarding_state: 'REGISTERED' } } });
    });

    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByTestId('InlineAlert')).toContainText('An account already uses this email');
    await check(page, info, 'register-email-taken');

    mode = 'terms';
    await page.getByLabel(/^Work email/).fill('owner@zaytoungrill.ca');
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByTestId('InlineAlert')).toContainText('The partner terms have changed');
    await expect(page.getByText('Read the updated partner terms')).toBeVisible();
    await expect(page.getByRole('checkbox', { name: 'I have read and accept the partner terms' })).toHaveAttribute('aria-checked', 'false');
    await check(page, info, 'register-terms-updated');

    mode = 'net';
    await page.getByRole('checkbox', { name: 'I have read and accept the partner terms' }).click();
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByTestId('InlineAlert')).toContainText('Your account wasn’t created');
    await check(page, info, 'register-net-error');

    mode = 'rate';
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByTestId('InlineAlert')).toContainText('Too many attempts from this device');
    await expect(page.getByRole('button', { name: 'Create account' })).toHaveAttribute('aria-disabled', 'true');
    await check(page, info, 'register-rate-limited');
    // The same answers are the same intent: the key did not change across these retries.
    expect(keys.at(-1)).toBe(keys.at(-2));
  });

  test('Register: created → Check your email (no session)', async ({ page }, info) => {
    await page.route('**/v1/auth/register/restaurant', (route) =>
      route.fulfill({ status: 201, json: { data: { restaurant_id: '927cc55c-8ddd-4d9f-a353-353ba2a8982b', email: 'samir@zaytoungrill.ca', onboarding_state: 'REGISTERED' } } }),
    );
    await page.goto('/register');
    await page.getByLabel(/^Restaurant name/).fill('Zaytoun Grill');
    await page.getByLabel(/^Work email/).fill('samir@zaytoungrill.ca');
    await page.getByLabel(/^Password/).fill('a long kitchen password');
    await page.getByRole('checkbox', { name: 'I have read and accept the partner terms' }).click();
    await page.getByLabel(/^Password/).press('Enter');
    await expect(page).toHaveURL(/\/check-email$/);
    await expect(page.getByTestId('check-email-card')).toContainText('Open the link we sent to samir@zaytoungrill.ca to continue setting up Zaytoun Grill.');
    await check(page, info, 'check-email-default');
    expect(await page.evaluate(() => localStorage.getItem('hg_restaurant_session_v1'))).toBeNull();
  });

  test('Register reflows at 320px (400% zoom): one column, no sideways scroll', async ({ page }, info) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto('/register');
    await expect(page.getByRole('heading', { name: 'Register your restaurant' })).toBeVisible();
    await expect(page.getByText('Restaurant partner')).toBeHidden();
    await check(page, info, 'register-320');
  });

  test('Check your email: daily limit and offline', async ({ page }, info) => {
    await page.route('**/v1/auth/login', error('INVALID_CREDENTIALS', 401, { details: { email_verification_required: true } }));
    await page.route('**/v1/auth/email/resend', error('RATE_LIMITED', 429, { headers: { 'Retry-After': '86400' } }));
    await page.goto('/login');
    await fillSignIn(page, 'samir@zaytoungrill.ca', 'correct horse battery');
    await page.getByLabel(/^Password/).press('Enter');
    await page.getByRole('button', { name: 'Send a new link' }).click();
    await expect(page.getByText('You’ve asked for 5 links today')).toBeVisible();
    await check(page, info, 'check-email-daily');
    await page.unroute('**/v1/auth/email/resend');
    await page.route('**/v1/auth/email/resend', (route) => route.abort('internetdisconnected'));
    // A later visit in the same tab (no router state, the address remembered for this tab).
    await page.evaluate(() => window.history.replaceState(null, '', '/check-email'));
    await page.reload();
    await page.getByRole('button', { name: 'Send a new link' }).click();
    await expect(page.getByTestId('InlineAlert')).toContainText('We couldn’t send a new link');
    await check(page, info, 'check-email-offline');
  });

  test('Verify link: working, used, expired (and sending, error), error', async ({ page }, info) => {
    const token = 'tok_e2e_0123456789abcdefghijklmnopqrstuv';
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    await page.route('**/v1/auth/email/verify', async (route) => {
      await gate;
      await route.fulfill({ status: 204 });
    });
    await page.goto(`/verify-email?token=${token}`);
    await expect(page.getByText('Confirming your email…')).toBeVisible();
    // The token left the address bar at boot.
    expect(page.url()).not.toContain(token);
    await expectNoDocumentScroll(page);
    await shot(page, info, 'verify-working');
    release();
    await expect(page.getByRole('heading', { name: 'Your email is confirmed' })).toBeVisible();

    await page.unroute('**/v1/auth/email/verify');
    await page.route('**/v1/auth/email/verify', error('VERIFICATION_TOKEN_USED', 410));
    await page.goto(`/verify-email?token=${token}`);
    await expect(page.getByRole('heading', { name: 'This link has already been used' })).toBeVisible();
    await check(page, info, 'verify-used');

    await page.unroute('**/v1/auth/email/verify');
    await page.route('**/v1/auth/email/verify', error('VERIFICATION_TOKEN_EXPIRED', 410));
    await page.route('**/v1/auth/email/resend', (route) => route.abort('internetdisconnected'));
    await page.goto(`/verify-email?token=${token}`);
    await expect(page.getByRole('heading', { name: 'This link has expired' })).toBeVisible();
    await check(page, info, 'verify-expired');
    await page.getByLabel(/^Email/).fill('samir@zaytoungrill.ca');
    await page.getByLabel(/^Email/).press('Enter');
    await expect(page.getByTestId('InlineAlert')).toContainText('We couldn’t send a new link');
    await check(page, info, 'verify-expired-error');

    await page.unroute('**/v1/auth/email/verify');
    await page.route('**/v1/auth/email/verify', (route) => route.abort('internetdisconnected'));
    await page.goto(`/verify-email?token=${token}`);
    await expect(page.getByRole('heading', { name: 'We couldn’t confirm your email' })).toBeVisible();
    await check(page, info, 'verify-error');
  });

  test('Forgot password: enter email, error, sent', async ({ page }, info) => {
    await page.goto('/login');
    await page.getByLabel(/^Email/).fill('samir@zaytoungrill.ca');
    await page.getByRole('link', { name: 'Reset it by email' }).click();
    await expect(page).toHaveURL(/\/forgot-password$/);
    await expect(page.getByLabel(/^Email/)).toHaveValue('samir@zaytoungrill.ca');
    await check(page, info, 'forgot');
    await page.route('**/v1/auth/password/forgot', (route) => route.abort('internetdisconnected'));
    await page.getByRole('button', { name: 'Email me a reset link' }).click();
    await expect(page.getByTestId('InlineAlert')).toContainText('We couldn’t send the link');
    await check(page, info, 'forgot-error');
    await page.unroute('**/v1/auth/password/forgot');
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
    await expect(page.getByTestId('forgot-sent')).toContainText('If samir@zaytoungrill.ca has a HalalGoes partner account');
    await check(page, info, 'forgot-sent');
  });

  test('Reset password: set, not accepted, link invalid, done', async ({ page }, info) => {
    const token = 'tok_e2e_reset_0123456789abcdefghijklmnop';
    let mode: 'breached' | 'consumed' | 'ok' = 'breached';
    await page.route('**/v1/auth/password/reset', (route) => {
      if (mode === 'breached') return error('BREACHED_PASSWORD', 422)(route);
      if (mode === 'consumed') return error('TOKEN_CONSUMED', 400)(route);
      return route.fulfill({ status: 204 });
    });
    await page.goto(`/reset-password?token=${token}`);
    await expect(page.getByRole('heading', { name: 'Set a new password' })).toBeVisible();
    await check(page, info, 'reset');
    await page.getByLabel(/^New password/).fill('password1234567');
    await page.getByLabel(/^New password/).press('Enter');
    await expect(page.getByText('This password appears in known data breaches. Choose a different one.')).toBeVisible();
    await expect(page.getByLabel(/^New password/)).toBeFocused();
    await check(page, info, 'reset-password-error');
    mode = 'ok';
    await page.getByLabel(/^New password/).fill('a much better kitchen passphrase');
    await page.getByLabel(/^New password/).press('Enter');
    await expect(page.getByRole('heading', { name: 'Your new password is set' })).toBeVisible();
    await check(page, info, 'reset-done');
    mode = 'consumed';
    await page.goto(`/reset-password?token=${token}`);
    await page.getByLabel(/^New password/).fill('a much better kitchen passphrase');
    await page.getByLabel(/^New password/).press('Enter');
    await expect(page.getByRole('heading', { name: 'This link doesn’t work any more' })).toBeVisible();
    await check(page, info, 'reset-link-invalid');
  });
});

/* ───── Real API (services/hg + devworld personas) ───── */

const RESET_LIMITS = process.env.E2E_RESET_LIMITS_CMD;

function resetLimits() {
  if (RESET_LIMITS) execSync(RESET_LIMITS, { stdio: 'ignore' });
}

/**
 * The newest single-use token emailed to `email` for `kind` (AUTH_EMAIL_VERIFICATION,
 * AUTH_PASSWORD_RESET). The local API logs emails instead of sending them; the delivery job keeps
 * the token, which is where devworld reads it too (`services/hg/internal/devworld/onboarding.go`).
 * Local database only.
 */
const PSQL = process.env.E2E_PSQL_CMD ?? 'docker exec -i hg-postgres-1 psql -U hg -d hg -tA';

function emailedToken(email: string, kind: string): string {
  if (!/^[\w.+-]+@[\w.-]+$/.test(email) || !/^[A-Z_]+$/.test(kind)) throw new Error('unexpected email or kind');
  const sql = `SELECT j.args->'overrides'->'EMAIL'->>'link_token' FROM river_job j
    JOIN notification n ON n.id = (j.args->>'notification_id')::uuid JOIN account a ON a.id = n.account_id
    WHERE j.kind = 'notify_deliver' AND lower(a.email) = lower('${email}') AND n.kind = '${kind}'
      AND j.args->'overrides'->'EMAIL'->>'link_token' IS NOT NULL ORDER BY j.id DESC LIMIT 1`;
  const deadline = Date.now() + 20_000;
  for (;;) {
    const token = execSync(PSQL, { input: sql, encoding: 'utf8' }).trim();
    if (token) return token;
    if (Date.now() > deadline) throw new Error(`no ${kind} email for ${email} on ${REAL_API} within 20s`);
    execSync('sleep 0.5');
  }
}

test.describe('restaurant redesign · sign in (real API)', () => {
  test.skip(MODE !== 'real', 'real-API journeys');
  test.beforeEach(() => resetLimits());

  test('the live owner signs in through the form and lands on orders', async ({ page }, info) => {
    await page.goto('/login');
    await fillSignIn(page, LIVE_OWNER.email, LIVE_OWNER.password);
    await page.getByLabel(/^Password/).press('Enter');
    await expect(page).toHaveURL(/\/orders$/);
    await expect(page.getByTestId('console-rail')).toBeVisible();
    await page.waitForLoadState('networkidle');
    await expectNoDocumentScroll(page);
    await shot(page, info, 'real-signed-in');
  });

  test('a wrong password is the Invalid state', async ({ page }, info) => {
    await page.goto('/login');
    await fillSignIn(page, LIVE_OWNER.email, 'not-the-password-2026');
    await page.getByLabel(/^Password/).press('Enter');
    const alert = page.getByTestId('InlineAlert');
    await expect(alert).toContainText('Email or password is incorrect');
    await expect(alert).toBeFocused();
    await expect(page.getByLabel(/^Password/)).toHaveValue('');
    await check(page, info, 'real-invalid');
  });

  test('an unverified owner (fresh) gets Unverified with Send a new link', async ({ page }, info) => {
    await page.goto('/login');
    await fillSignIn(page, 'fresh@seed.hg', LIVE_OWNER.password);
    await page.getByLabel(/^Password/).press('Enter');
    await expect(page.getByText('Confirm your email to sign in')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Send a new link' })).toBeVisible();
    await check(page, info, 'real-unverified');
    await page.getByRole('button', { name: 'Send a new link' }).click();
    await expect(page).toHaveURL(/\/check-email$/);
    await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
    await expect(page.getByTestId('check-email-card')).toContainText('fresh@seed.hg');
  });

  test('the session is kept in memory only: no token in localStorage after signing in', async ({ page }) => {
    await page.goto('/login');
    await fillSignIn(page, LIVE_OWNER.email, LIVE_OWNER.password);
    await page.getByLabel(/^Password/).press('Enter');
    await expect(page).toHaveURL(/\/orders$/);
    await expect(page.getByTestId('console-rail')).toBeVisible();
    expect(await page.evaluate(() => JSON.stringify(window.localStorage))).not.toContain('eyJ');
    expect(await page.evaluate(() => localStorage.getItem('hg_restaurant_session_v1'))).toBeNull();
  });

  test('the suspended persona (restaurant suspended, sign-in account active) signs in to its console', async ({ page }, info) => {
    await page.goto('/login');
    await fillSignIn(page, 'suspended@seed.hg', LIVE_OWNER.password);
    await page.getByLabel(/^Password/).press('Enter');
    // The SI account-state cards are for a suspended SIGN-IN account; this persona's sign-in is
    // active and only its restaurant is suspended, which the console itself shows.
    await expect(page).toHaveURL(/\/orders$/);
    await expect(page.getByTestId('console-rail')).toBeVisible();
    await expect(page.locator('[data-testid^="account-card-"]')).toHaveCount(0);
    await page.waitForLoadState('networkidle');
    await expectNoDocumentScroll(page);
    await shot(page, info, 'real-suspended');
  });

  test('register → check email → verify → sign in → onboarding; forgot → reset → sign in', async ({ page }, info) => {
    test.setTimeout(120_000);
    const email = `wp2-${info.project.name}-${Date.now()}@wp2.test`;
    const password = 'a long kitchen password 2026';
    const newPassword = 'another long kitchen password 2026';

    // Register. services/hg omits terms_version from the public config today (#738), so the
    // first submit is refused with TERMS_VERSION_STALE, which names the version; the owner reads
    // it, ticks the box again and resubmits. With the config fixed it goes straight through.
    await page.goto('/register');
    await page.getByLabel(/^Restaurant name/).fill('WP2 Journey Grill');
    await page.getByLabel(/^Work email/).fill(email);
    await page.getByLabel(/^Password/).fill(password);
    const box = page.getByRole('checkbox', { name: 'I have read and accept the partner terms' });
    await box.click();
    await page.getByRole('button', { name: 'Create account' }).click();
    const outcome = await Promise.race([
      page.waitForURL(/\/check-email$/).then(() => 'created' as const),
      page.getByText('The partner terms have changed').waitFor().then(() => 'terms' as const),
    ]);
    if (outcome === 'terms') {
      await expect(page.getByText(/^Version \S+/)).toBeVisible();
      await expect(box).toHaveAttribute('aria-checked', 'false');
      await check(page, info, 'real-register-terms-updated');
      await box.click();
      await page.getByRole('button', { name: 'Create account' }).click();
    }
    await expect(page).toHaveURL(/\/check-email$/);
    await expect(page.getByTestId('check-email-card')).toContainText(`Open the link we sent to ${email} to continue setting up WP2 Journey Grill.`);
    await check(page, info, 'real-check-email');

    // Not confirmed yet: signing in is the Unverified state.
    await page.goto('/login');
    await fillSignIn(page, email, password);
    await page.getByLabel(/^Password/).press('Enter');
    await expect(page.getByText('Confirm your email to sign in')).toBeVisible();

    // Verify with the emailed link.
    const verifyToken = emailedToken(email, 'AUTH_EMAIL_VERIFICATION');
    await page.goto(`/verify-email?token=${verifyToken}`);
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
    await check(page, info, 'real-verified');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/login/);

    // Sign in: a new restaurant is not DONE, so the server's onboarding status sends it there.
    await fillSignIn(page, email, password);
    await page.getByLabel(/^Password/).press('Enter');
    await expect(page).toHaveURL(/\/onboarding/);

    // Forgot → reset → sign in with the new password.
    await page.goto('/forgot-password');
    await page.getByLabel(/^Email/).fill(email);
    await page.getByLabel(/^Email/).press('Enter');
    await expect(page.getByTestId('forgot-sent')).toContainText(`If ${email} has a HalalGoes partner account`);
    const resetToken = emailedToken(email, 'AUTH_PASSWORD_RESET');
    await page.goto(`/reset-password?token=${resetToken}`);
    await expect(page.getByRole('heading', { name: 'Set a new password' })).toBeVisible();
    await page.getByLabel(/^New password/).fill(newPassword);
    await page.getByLabel(/^New password/).press('Enter');
    await expect(page.getByRole('heading', { name: 'Your new password is set' })).toBeVisible();
    await check(page, info, 'real-reset-done');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await fillSignIn(page, email, password);
    await page.getByLabel(/^Password/).press('Enter');
    await expect(page.getByTestId('InlineAlert')).toContainText('Email or password is incorrect');
    // services/hg denies every session of the account for up to 10 s after a reset, including new
    // ones (#748): a sign-in inside that window gets a session whose first request is refused.
    // Wait it out until the backend revokes only the sessions that existed at the reset.
    await page.waitForTimeout(11_000);
    await fillSignIn(page, email, newPassword);
    await page.getByLabel(/^Password/).press('Enter');
    await expect(page).toHaveURL(/\/onboarding/);
    // The used link is spent: the same token is now Link invalid.
    await page.goto(`/reset-password?token=${resetToken}`);
    await page.getByLabel(/^New password/).fill('yet another kitchen password 2026');
    await page.getByLabel(/^New password/).press('Enter');
    await expect(page.getByRole('heading', { name: 'This link doesn’t work any more' })).toBeVisible();
  });

  test('forgot password reaches Sent without saying whether the account exists', async ({ page }, info) => {
    await page.goto('/forgot-password');
    await page.getByLabel(/^Email/).fill(LIVE_OWNER.email);
    await page.getByLabel(/^Email/).press('Enter');
    await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
    await expect(page.getByTestId('forgot-sent')).toContainText(`If ${LIVE_OWNER.email} has a HalalGoes partner account`);
    await check(page, info, 'real-forgot-sent');
  });
});
