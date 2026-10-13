import { expect, type Page } from '@playwright/test';

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
