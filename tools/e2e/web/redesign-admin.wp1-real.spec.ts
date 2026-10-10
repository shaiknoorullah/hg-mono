import { expect, test, type Page } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { world } from '../lib/api.mjs';
import { OUT } from '../lib/paths.mjs';
import { freshTotp } from '../lib/totp.mjs';
import { E2E_MODE } from './mode';
import { stepper } from './shots';

// The real-API twin of redesign-admin.wp1.spec.ts (which runs in mock mode only): the same
// sign-in journey, but every request reaches services/hg, so the two-step branch is the server's
// own `MFA_REQUIRED` and the code is a real TOTP for the account.
test.skip(E2E_MODE === 'mock', 'signs in against the real API; run with E2E_MODE=real (the default)');

/**
 * The redesigned admin console, work package 1 (issue #90), against the REAL API: sign in with
 * email and password, the server asks for the code, a fresh TOTP lands the admin on Restaurant
 * applications with the admin's sidebar, sign out returns to the sign-in page with the signed-out
 * notice. A wrong password first shows the details-not-recognised alert, which names no field.
 *
 * Who signs in: the e2e stack (tools/e2e/stack/up.sh + seed/seed.sh, what CI runs) writes its
 * super admin, this run's password and the admin's TOTP secret to $E2E_OUT/world.json; a local
 * devworld has no world.json and uses the dev admin `make dev-admin` provisions
 * (dev-admin@halalgoes.test, its secret in /tmp/hg-admin-totp-secret.txt). E2E_ADMIN_EMAIL,
 * E2E_ADMIN_PASSWORD and E2E_ADMIN_TOTP_SECRET override either.
 *
 * The API allows 10 sign-in attempts per account in 15 minutes; each pass of this spec spends
 * three (wrong password, no code, code), so desktop then tablet spend six.
 *
 * Base URL: $E2E_ADMIN_REDESIGN_URL (the config's redesign-admin projects), else $BASE_URL. The
 * viewport is the project's (desktop 1440x900, tablet 1024x768); every step leaves a screenshot.
 */
const BASE = process.env.E2E_ADMIN_REDESIGN_URL ?? process.env.BASE_URL;
if (BASE) test.use({ baseURL: BASE });

interface LiveAdmin {
  email: string;
  password: string;
  totpSecret: string;
}

function liveAdmin(): LiveAdmin {
  const seeded = existsSync(path.join(OUT, 'world.json'))
    ? (world() as { admin: { email: string; totpSecret: string }; password: string })
    : null;
  return {
    email: process.env.E2E_ADMIN_EMAIL ?? seeded?.admin.email ?? 'dev-admin@halalgoes.test',
    password: process.env.E2E_ADMIN_PASSWORD ?? seeded?.password ?? 'DevAdmin!2026',
    totpSecret: process.env.E2E_ADMIN_TOTP_SECRET ?? seeded?.admin.totpSecret ?? devTotpSecret(),
  };
}

/** The devworld admin's secret, as `make dev-admin` writes it. Empty when it has not been run. */
function devTotpSecret(): string {
  const file = '/tmp/hg-admin-totp-secret.txt';
  return existsSync(file) ? readFileSync(file, 'utf8').trim() : '';
}

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

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const emailField = (page: Page) => page.getByLabel('Work email');
const passwordField = (page: Page) => page.getByRole('textbox', { name: 'Password', exact: true });
const signInButton = (page: Page) => page.getByRole('button', { name: 'Sign in', exact: true });
/** The OTP field, as the live DS draws it: six cells over ONE real field named "Authentication code". */
const codeField = (page: Page) => page.getByRole('textbox', { name: 'Authentication code', exact: true });
const appBar = (page: Page) => page.locator('#app-bar-heading');
const nav = (page: Page) => page.getByRole('navigation', { name: 'Admin' });

test('admin signs in against the real API with password and TOTP, sees the admin sidebar, signs out', async ({ page }) => {
  const admin = liveAdmin();
  expect(admin.totpSecret, 'no TOTP secret: seed the e2e world, run `make dev-admin`, or set E2E_ADMIN_TOTP_SECRET').not.toBe('');
  const step = stepper('redesign-admin', 'wp1-real');
  const logins: number[] = [];
  page.on('response', (response) => {
    if (response.url().endsWith('/v1/auth/login') && response.request().method() === 'POST') logins.push(response.status());
  });

  await step(page, 'sign-in', async () => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible();
    await expect(page.getByText('For HalalGoes staff. Sign in with your work email and password.')).toBeVisible();
    // D1: no code field until the server asks for one.
    await expect(codeField(page)).toHaveCount(0);
  });

  await step(page, 'wrong-password', async () => {
    await emailField(page).fill(admin.email);
    await passwordField(page).fill(`${admin.password}-not-it`);
    await signInButton(page).click();
    // Details not recognised: one blocking alert that takes focus and names neither field.
    const alert = page.getByRole('alert').filter({ hasText: 'The email or password isn’t right' });
    await expect(alert).toBeVisible();
    await expect(alert).toContainText('Check both and try again.');
    await expect(alert).toBeFocused();
    await expect(emailField(page)).not.toHaveAttribute('aria-invalid', 'true');
    await expect(passwordField(page)).not.toHaveAttribute('aria-invalid', 'true');
    await expect(codeField(page)).toHaveCount(0);
    expect(logins).toEqual([401]);
  });

  await step(page, 'code-needed', async () => {
    await passwordField(page).fill(admin.password);
    await signInButton(page).click();
    // The server's own MFA_REQUIRED: only now does the code field appear, focused and invalid.
    await expect(page.getByText('This account uses two-step sign-in')).toBeVisible();
    await expect(codeField(page)).toBeVisible();
    await expect(codeField(page)).toBeFocused();
    await expect(codeField(page)).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByText('The email or password isn’t right')).toHaveCount(0);
    expect(logins).toEqual([401, 403]);
  });

  await step(page, 'landed', async () => {
    const code = await freshTotp(admin.totpSecret);
    await codeField(page).click();
    await page.keyboard.type(code);
    await signInButton(page).click();
    await expect(appBar(page)).toHaveText('Restaurant applications');
    await expect(page).toHaveURL(/#\/restaurants$/);
    expect(logins).toEqual([401, 403, 200]);
  });

  await step(page, 'sidebar', async () => {
    const n = nav(page);
    await expect(n).toBeVisible();
    for (const label of ADMIN_NAV) {
      await expect(n.getByRole('link', { name: new RegExp(`^${escape(label)}`) })).toBeVisible();
    }
    await expect(n.getByRole('link', { name: /^Restaurant applications/ })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('button', { name: /^Sign out/ })).toBeVisible();
  });

  await step(page, 'signed-out', async () => {
    await page.getByRole('button', { name: /^Sign out/ }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible();
    await expect(page.getByText('You’re signed out')).toBeVisible();
    await expect(page.getByText('You signed out of HalalGoes on this device. Sign in again to continue.')).toBeVisible();
    await expect(nav(page)).toHaveCount(0);
    // The email is remembered for the next sign-in.
    await expect(emailField(page)).toHaveValue(admin.email);
  });
});
