import { expect, test, type Page, type Route } from '@playwright/test';

import { E2E_MODE } from './mode';
import { stepper } from './shots';
import { signOutAndExpectNotice } from './redesign-admin.support';

// This spec drives the console against the mock server: it reads `login` from the mock and
// rewrites the principal's role (below). On the e2e stack (E2E_MODE=real, what the `e2e` label
// runs) the same request reaches the real API, whose answer has no such principal, so the file
// runs in mock mode only: `E2E_MODE=mock`, see tools/e2e/README.md → Redesign.
test.skip(E2E_MODE !== 'mock', 'written against the mock server; run with E2E_MODE=mock');

/**
 * The redesigned admin console, work package 1 (issue #90): the shell and the public auth pages,
 * against the MOCK server (`pnpm mock`, :4010) and the console built with VITE_HG_REDESIGN=1.
 *
 * The mock answers `login` with its default SessionGrant fixture, whose principal is a CUSTOMER,
 * and the console (correctly) refuses a principal with no staff role. So the login response is
 * fetched from the mock and only `principal.roles` is rewritten to the staff role a journey needs.
 * The two-step branch is the mock's own `MFA_REQUIRED` fixture, chosen per request with the
 * `X-Mock-Scenario` header, because the app sets no scenario of its own.
 *
 * Base URL: $E2E_ADMIN_REDESIGN_URL, else $BASE_URL, else the config's. Each journey runs at
 * 1440x900 and at 1024x768; every step leaves a screenshot (`./shots.ts`).
 */
const BASE = process.env.E2E_ADMIN_REDESIGN_URL ?? process.env.BASE_URL;
if (BASE) test.use({ baseURL: BASE });

type StaffRole = 'SUPER_ADMIN' | 'ADMIN' | 'SUPPORT_AGENT';

const EMAIL = 'dev-admin@halalgoes.test';
const PASSWORD = 'DevAdmin!2026-e2e';
/** base64url, 43 characters: what `isWellFormedToken` accepts. */
const LINK_TOKEN = 'e2eRedesignAdminWp1LinkToken_abcdefghijklmn';

/** Every sidebar item an admin sees (`ASS/AdminSidebar`, round 2), by its visible label. */
const ADMIN_NAV = [
  'Halal certificates',
  'Restaurant applications',
  'Rider applications',
  'Issuing bodies',
  'Menu reviews',
  'Orders',
  'Refunds & disputes',
  'Live alerts',
  'Staff',
  'Your account',
] as const;
const ADMIN_ONLY = ['Rider applications', 'Menu reviews', 'Staff'] as const;

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Serves `login` from the mock, rewriting the principal's roles to `role`. With `mfa`, the first
 * attempt without a `totp_code` is answered by the mock's `MFA_REQUIRED` fixture.
 */
async function routeLogin(page: Page, role: StaffRole, opts: { mfa?: boolean } = {}): Promise<string[]> {
  const sent: string[] = [];
  await page.route('**/v1/auth/login', async (route: Route) => {
    const request = route.request();
    if (request.method() !== 'POST') return route.continue();
    const body = request.postData() ?? '';
    sent.push(body);
    const hasCode = /"totp_code"/.test(body);
    if (opts.mfa && !hasCode) {
      const response = await route.fetch({
        headers: { ...request.headers(), 'x-mock-scenario': 'error_refund_mfa_required' },
      });
      return route.fulfill({ response });
    }
    const response = await route.fetch();
    const json = (await response.json()) as { data: { principal: { roles: { role: string }[] } } };
    json.data.principal.roles = [{ ...json.data.principal.roles[0], role, scope_type: 'GLOBAL' } as { role: string }];
    return route.fulfill({ response, json });
  });
  return sent;
}

async function signIn(page: Page): Promise<void> {
  await page.getByLabel('Work email').fill(EMAIL);
  await page.getByRole('textbox', { name: 'Password', exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
}

const appBar = (page: Page) => page.locator('#app-bar-heading');
/** The OTP field, as the live DS draws it: six cells over ONE real field named "Authentication code". */
const codeField = (page: Page) => page.getByRole('textbox', { name: 'Authentication code', exact: true });
async function typeCode(page: Page, digits: string): Promise<void> {
  await codeField(page).fill('');
  await codeField(page).click();
  await page.keyboard.type(digits);
}
const nav = (page: Page) => page.getByRole('navigation', { name: 'Admin' });

const VIEWPORTS = [
  { name: '1440', width: 1440, height: 900 },
  { name: '1024', width: 1024, height: 768 },
] as const;

for (const vp of VIEWPORTS) {
  test.describe(`redesigned admin WP-1 @${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height }, colorScheme: 'light' });

    test('admin signs in, lands on restaurant applications, sees every nav item, signs out', async ({ page }) => {
      const step = stepper('redesign-admin', `wp1-${vp.name}-admin`);
      const sent = await routeLogin(page, 'SUPER_ADMIN');

      await step(page, 'sign-in', async () => {
        await page.goto('/');
        await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible();
        await expect(page.getByText('For HalalGoes staff. Sign in with your work email and password.')).toBeVisible();
        // D1: no code field until the server asks for one.
        await expect(codeField(page)).toHaveCount(0);
      });

      await step(page, 'empty-submit-errors', async () => {
        await page.getByRole('button', { name: 'Sign in', exact: true }).click();
        await expect(page.getByText('Enter your work email.')).toBeVisible();
        expect(sent).toHaveLength(0);
      });

      await step(page, 'landed', async () => {
        await signIn(page);
        await expect(appBar(page)).toHaveText('Restaurant applications');
        await expect(page).toHaveURL(/#\/restaurants$/);
        expect(sent).toHaveLength(1);
        expect(JSON.parse(sent[0]!)).toEqual({ email: EMAIL, password: PASSWORD });
      });

      await step(page, 'nav-every-item', async () => {
        const n = nav(page);
        await expect(n).toBeVisible();
        // The 1024 boards draw the 80px rail; 1280 and wider draw it open.
        if (vp.width < 1280) await expect(n).toHaveAttribute('data-collapsed', 'true');
        else await expect(n).not.toHaveAttribute('data-collapsed', 'true');
        for (const label of ADMIN_NAV) {
          const link = n.getByRole('link', { name: new RegExp(`^${escape(label)}`) });
          await expect(link).toBeVisible();
          // Every item fits without scrolling the item list (the footer never covers it).
          if (vp.width < 1280) await expect(link).toBeInViewport({ ratio: 1 });
        }
        const whatsNew = page.getByRole('button', { name: /What’s new/ });
        await expect(whatsNew).toHaveAttribute('aria-disabled', 'true');
        await expect(whatsNew).toHaveAttribute('aria-expanded', 'false');
        await expect(whatsNew).toHaveAttribute('aria-controls', 'admin-whats-new-panel');
        await expect(whatsNew).toHaveAccessibleDescription('What’s new comes in a later update.');
        await expect(n.getByRole('link', { name: /^Restaurant applications/ })).toHaveAttribute('aria-current', 'page');
        await expect(page.getByRole('link', { name: /System status/ })).toBeVisible();
        if (vp.width < 1280) {
          // The rail folds "Signed in as" into Sign out's accessible name, as `ASS/AdminSidebar` does.
          await expect(page.getByRole('button', { name: 'Sign out, signed in as Super admin' })).toBeInViewport({ ratio: 1 });
        } else {
          await expect(page.getByText('Signed in as Super admin', { exact: false })).toBeVisible();
          await expect(page.getByRole('button', { name: /^Sign out/ })).toBeVisible();
        }
        // Profile changes is cut at launch.
        await expect(n.getByRole('link', { name: /Profile changes/ })).toHaveCount(0);
      });

      await step(page, 'certificates-entry', async () => {
        await nav(page).getByRole('link', { name: /^Halal certificates/ }).click();
        await expect(appBar(page)).toHaveText('Halal certificates');
        await expect(page.getByRole('heading', { name: 'Certificates are opened from a restaurant’s application' })).toBeVisible();
      });

      await step(page, 'not-found', async () => {
        await page.evaluate(() => {
          window.location.hash = '#/no-such-page';
        });
        await expect(appBar(page)).toHaveText('Page not found');
        await expect(page.getByText('There’s no page at this address')).toBeVisible();
        await expect(page.getByRole('button', { name: 'Back to restaurant applications' })).toBeVisible();
      });

      await step(page, 'signed-out', async () => {
        await signOutAndExpectNotice(page, EMAIL);
      });
    });

    test('two-step sign-in: the code field appears only after MFA_REQUIRED', async ({ page }) => {
      const step = stepper('redesign-admin', `wp1-${vp.name}-mfa`);
      const sent = await routeLogin(page, 'ADMIN', { mfa: true });

      await step(page, 'sign-in', async () => {
        await page.goto('/');
        await signIn(page);
      });

      await step(page, 'code-needed', async () => {
        await expect(page.getByText('This account uses two-step sign-in')).toBeVisible();
        await expect(codeField(page)).toBeVisible();
        await expect(codeField(page)).toBeFocused();
        await expect(codeField(page)).toHaveAttribute('aria-invalid', 'true');
        await expect(page.getByRole('button', { name: 'Lost your authenticator?', exact: true })).toBeVisible();
        expect(JSON.parse(sent[0]!)).not.toHaveProperty('totp_code');
      });

      await step(page, 'lost-authenticator', async () => {
        await page.getByRole('button', { name: 'Lost your authenticator?', exact: true }).click();
        await expect(page.getByRole('heading', { level: 1, name: 'Lost your authenticator app?' })).toBeFocused();
        await page.getByRole('button', { name: 'Back to sign in' }).click();
        await expect(codeField(page)).toBeFocused();
      });

      await step(page, 'code-short-not-sent', async () => {
        await typeCode(page, '123');
        await page.getByRole('button', { name: 'Sign in', exact: true }).click();
        await expect(page.getByText('Enter the 6-digit code from your authenticator app.').first()).toBeVisible();
        expect(sent).toHaveLength(1);
      });

      await step(page, 'landed', async () => {
        await typeCode(page, '123456');
        await page.getByRole('button', { name: 'Sign in', exact: true }).click();
        await expect(appBar(page)).toHaveText('Restaurant applications');
        expect(sent).toHaveLength(2);
        expect(JSON.parse(sent[1]!)).toEqual({ email: EMAIL, password: PASSWORD, totp_code: '123456' });
        for (const label of ADMIN_NAV) {
          await expect(nav(page).getByRole('link', { name: new RegExp(`^${escape(label)}`) })).toBeVisible();
        }
      });
    });

    test('support agent lands on live alerts and gets the 403 page for staff', async ({ page }) => {
      // The mock has no support principal of its own; the role is rewritten on the mock's grant.
      const step = stepper('redesign-admin', `wp1-${vp.name}-support`);
      await routeLogin(page, 'SUPPORT_AGENT');

      await step(page, 'landed', async () => {
        await page.goto('/');
        await signIn(page);
        await expect(appBar(page)).toHaveText('Live alerts');
        await expect(page).toHaveURL(/#\/alerts$/);
      });

      await step(page, 'nav-support', async () => {
        const n = nav(page);
        // In the rail (1024) the group heading is kept for assistive technology only.
        const heading = n.getByText('Review · view only');
        if (vp.width < 1280) await expect(heading).toBeAttached();
        else await expect(heading).toBeVisible();
        for (const label of ADMIN_NAV.filter((l) => !(ADMIN_ONLY as readonly string[]).includes(l))) {
          await expect(n.getByRole('link', { name: new RegExp(`^${escape(label)}`) })).toBeVisible();
        }
        for (const label of ADMIN_ONLY) {
          await expect(n.getByRole('link', { name: new RegExp(`^${escape(label)}`) })).toHaveCount(0);
        }
      });

      await step(page, 'forbidden', async () => {
        await page.evaluate(() => {
          window.location.hash = '#/staff';
        });
        await expect(appBar(page)).toHaveText('No permission');
        await expect(appBar(page)).toBeFocused();
        await expect(page.getByText('You don’t have permission for this')).toBeVisible();
        await expect(
          page.getByText(
            'Your role, Support agent, doesn’t include the permission this page needs: staff accounts. Nothing was changed. If you need it, ask a super admin.',
          ),
        ).toBeVisible();
        await expect(page.getByRole('button', { name: 'Back to live alerts' })).toBeVisible();
      });

      await step(page, 'back-to-landing', async () => {
        await page.getByRole('button', { name: 'Back to live alerts' }).click();
        await expect(appBar(page)).toHaveText('Live alerts');
      });
    });

    test('reset password: ask, sent, choose, saved; a bad link is expired', async ({ page }) => {
      const step = stepper('redesign-admin', `wp1-${vp.name}-reset`);

      await step(page, 'help', async () => {
        await page.goto('/');
        await page.getByRole('button', { name: 'Forgotten your password or lost your authenticator?' }).click();
        await expect(page.getByRole('heading', { level: 1, name: 'Can’t sign in?' })).toBeFocused();
        await expect(page.getByRole('link', { name: 'Reset my password' })).toHaveAttribute('href', '/reset-password');
      });

      await step(page, 'ask', async () => {
        await page.goto('/reset-password');
        await expect(page.getByRole('heading', { level: 1, name: 'Reset your password' })).toBeVisible();
        // A plain link to the lost-authenticator help, not an expander.
        await expect(page.getByRole('link', { name: 'Lost your authenticator app instead?' })).toHaveAttribute('href', '/?help=lost');
      });

      await step(page, 'ask-email-malformed', async () => {
        const asked: string[] = [];
        page.on('request', (request) => {
          if (request.url().includes('/v1/auth/password/forgot')) asked.push(request.url());
        });
        await page.getByLabel('Work email').fill('staff@halalgoes');
        await page.getByRole('button', { name: 'Send reset link' }).click();
        await expect(page.getByText('Enter an email address like name@halalgoes.ca.')).toBeVisible();
        await expect(page.getByLabel('Work email')).toBeFocused();
        await expect(page.getByLabel('Work email')).toHaveAttribute('aria-invalid', 'true');
        expect(asked).toHaveLength(0);
      });

      await step(page, 'sent', async () => {
        await page.getByLabel('Work email').fill('staff@halalgoes.ca');
        await page.getByRole('button', { name: 'Send reset link' }).click();
        await expect(page.getByRole('heading', { level: 1, name: 'Check your email' })).toBeFocused();
        await expect(page.getByText(/If staff@halalgoes\.ca is a staff account, a reset link is on its way/)).toBeVisible();
      });

      await step(page, 'choose', async () => {
        await page.goto(`/reset-password?token=${LINK_TOKEN}`);
        await expect(page.getByRole('heading', { level: 1, name: 'Choose a new password' })).toBeVisible();
        // The token left the address bar at boot.
        expect(new URL(page.url()).search).not.toContain(LINK_TOKEN);
      });

      await step(page, 'choose-breached', async () => {
        await page.route('**/v1/auth/password/reset', async (route) => {
          const response = await route.fetch({
            headers: { ...route.request().headers(), 'x-mock-scenario': 'error_breached_password' },
          });
          await route.fulfill({ response });
        }, { times: 1 });
        await page.getByLabel('New password').fill('password1234');
        await page.getByRole('button', { name: 'Save password' }).click();
        await expect(page.getByText(/This password has appeared in a data breach/)).toBeVisible();
      });

      await step(page, 'saved', async () => {
        await page.getByLabel('New password').fill('a-long-and-new-passphrase');
        await page.getByRole('button', { name: 'Save password' }).click();
        await expect(page.getByRole('heading', { level: 1, name: 'Password saved' })).toBeVisible();
        await expect(page.getByText('You’ve been signed out everywhere. Sign in with your new password.')).toBeVisible();
        await expect(page.getByRole('link', { name: 'Go to sign in' })).toBeVisible();
      });

      await step(page, 'expired', async () => {
        await page.goto('/reset-password?token=short');
        await expect(page.getByText('This link has expired or was already used').first()).toBeVisible();
        await expect(page.getByRole('button', { name: 'Ask for a new link' })).toBeVisible();
      });

      await step(page, 'lost-authenticator-link', async () => {
        await page.goto('/reset-password');
        await page.getByRole('link', { name: 'Lost your authenticator app instead?' }).click();
        await expect(page.getByRole('heading', { level: 1, name: 'Lost your authenticator app?' })).toBeFocused();
        expect(new URL(page.url()).search).toBe('');
        await page.getByRole('button', { name: 'Back to sign in' }).click();
        await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible();
      });
    });

    test('accept invite, step 1: set a password, then go to sign in', async ({ page }) => {
      const step = stepper('redesign-admin', `wp1-${vp.name}-invite`);

      await step(page, 'invalid-link', async () => {
        await page.goto('/accept-invite');
        await expect(page.getByRole('heading', { level: 1, name: 'This invite link doesn’t work' })).toBeVisible();
      });

      await step(page, 'set-password', async () => {
        await page.goto(`/accept-invite?token=${LINK_TOKEN}`);
        await expect(page.getByRole('heading', { level: 1, name: 'Set up your HalalGoes admin account' })).toBeVisible();
        await expect(
          page.getByText('You were invited to the HalalGoes admin console. Choose a password to finish setting up your account.'),
        ).toBeVisible();
        await expect(page.getByText('At least 12 characters. We check it against passwords exposed in data breaches.')).toBeVisible();
        // D1: one step, no step indicator.
        await expect(page.getByText(/Step 1 of 2/)).toHaveCount(0);
      });

      await step(page, 'too-short', async () => {
        await page.getByLabel('New password').fill('short');
        await page.getByRole('button', { name: 'Continue' }).click();
        await expect(page.getByLabel('New password')).toHaveAttribute('aria-invalid', 'true');
      });

      await step(page, 'done', async () => {
        await page.getByLabel('New password').fill('a-long-and-new-passphrase');
        await page.getByRole('button', { name: 'Continue' }).click();
        await expect(page.getByRole('heading', { level: 1, name: 'Your account is ready' })).toBeVisible();
        await expect(page.getByText('Setting up doesn’t sign you in. Sign in with your work email and your password.')).toBeVisible();
      });

      await step(page, 'go-to-sign-in', async () => {
        await page.getByRole('link', { name: 'Go to sign in' }).click();
        await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible();
      });
    });
  });
}
