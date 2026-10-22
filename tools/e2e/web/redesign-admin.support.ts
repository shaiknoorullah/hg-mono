import { expect, type Page, type Route } from '@playwright/test';

import { expectDesignFor, type BoardFor } from './design';

/**
 * Shared steps for the redesigned admin console's specs (redesign-admin.*.spec.ts), on the mock
 * and on the real API alike.
 */

/** The console's sidebar. */
export const adminNav = (page: Page) => page.getByRole('navigation', { name: 'Admin' });

/**
 * Sign out from the sidebar, then check the sign-in page shows the signed-out notice, the shell
 * is gone, and the work email is remembered for the next sign-in.
 */
export async function signOutAndExpectNotice(page: Page, email: string): Promise<void> {
  await page.getByRole('button', { name: /^Sign out/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible();
  await expect(page.getByText('You’re signed out')).toBeVisible();
  await expect(page.getByText('You signed out of HalalGoes on this device. Sign in again to continue.')).toBeVisible();
  await expect(adminNav(page)).toHaveCount(0);
  await expect(page.getByLabel('Work email')).toHaveValue(email);
}

export type StaffRole = 'SUPER_ADMIN' | 'ADMIN' | 'SUPPORT_AGENT';

export const EMAIL = 'dev-admin@halalgoes.test';
export const PASSWORD = 'DevAdmin!2026-e2e';

/**
 * Serves `login` from the mock, rewriting the principal's roles to `role`. With `mfa`, the first
 * attempt without a `totp_code` is answered by the mock's `MFA_REQUIRED` fixture.
 */
export async function routeLogin(page: Page, role: StaffRole, opts: { mfa?: boolean } = {}): Promise<string[]> {
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

export async function signIn(page: Page): Promise<void> {
  await page.getByLabel('Work email').fill(EMAIL);
  await page.getByRole('textbox', { name: 'Password', exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
}


/**
 * Waits for the screen to settle and captures it for its board. Shared because every
 * redesign-admin capture spec needs the same two steps, and the "Not built yet" guard is the
 * one that saves a confusing diff: a build older than the screen draws it, and that is the
 * build being stale rather than a state the board draws.
 */
export async function captureBoard(page: Page, boards: BoardFor): Promise<void> {
  await page.waitForLoadState('networkidle');
  await expect(page.getByText('Not built yet')).toHaveCount(0);
  await expectDesignFor(page, boards);
}

/** Signs in as `role`, then opens `hash` on the redesigned console. */
export async function signInAndOpen(page: Page, role: StaffRole, hash: string): Promise<void> {
  await routeLogin(page, role);
  await page.goto('/');
  await signIn(page);
  await expect(page.locator('#app-bar-heading')).toBeVisible();
  await page.evaluate((h) => {
    window.location.hash = h;
  }, hash);
}
