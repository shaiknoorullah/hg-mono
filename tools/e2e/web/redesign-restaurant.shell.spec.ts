/**
 * Restaurant redesign WP1: the console shell (manifest §3 WP1, §6 row WP1). Runs at desktop
 * 1440×900 and tablet 1024×768 (the `redesign` projects), flag on.
 */
import { expect, test } from '@playwright/test';
import { documentScrolls, openSignedIn } from './redesign-restaurant.support';

const ROUTES = [
  { path: '/orders', nav: 'Live orders' },
  { path: '/orders/history', nav: 'History' },
  { path: '/menu', nav: 'Menu' },
  { path: '/hours', nav: 'Hours' },
  { path: '/payouts', nav: 'Payouts' },
  { path: '/settings', nav: 'Settings' },
];

test.describe('restaurant redesign · shell', () => {
  for (const { path, nav } of ROUTES) {
    test(`${path} renders in the console shell and the page never scrolls`, async ({ page }, info) => {
      await openSignedIn(page, path);
      const rail = page.getByTestId('console-rail');
      await expect(rail).toBeVisible();
      await expect(rail.getByRole('link', { name: new RegExp(`^${nav}`) })).toHaveAttribute('aria-current', 'page');
      await expect(page.getByRole('region', { name: 'Service status' })).toBeAttached();
      // Let the page settle (data loaded), then measure.
      await page.waitForLoadState('networkidle');
      const m = await documentScrolls(page);
      expect(m.scrollHeight, 'document must not scroll vertically').toBeLessThanOrEqual(m.innerHeight);
      expect(m.scrollWidth, 'document must not scroll horizontally').toBeLessThanOrEqual(m.innerWidth);
      await page.screenshot({ path: info.outputPath(`shell${path.replace(/\//g, '_')}.png`) });
    });
  }

  test('the rail has no Staff item, and the skip link goes to new orders', async ({ page }) => {
    await openSignedIn(page, '/orders');
    const rail = page.getByTestId('console-rail');
    await expect(rail.getByRole('link')).toHaveCount(6);
    await expect(rail.getByText('Staff')).toHaveCount(0);
    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', { name: 'Skip to new orders' });
    await expect(skip).toBeFocused();
    await expect(skip).toHaveAttribute('href', '#new-orders');
  });

  test('sign out asks to stop orders first, and Stay signed in keeps the console', async ({ page }) => {
    await openSignedIn(page, '/orders/history');
    await page.getByRole('button', { name: /^Account/ }).click();
    await page.getByRole('menuitem', { name: 'Sign out…' }).click();
    const confirm = page.getByRole('group', { name: 'Stop orders before you sign out?' });
    await expect(confirm).toBeVisible();
    await expect(confirm.getByRole('button', { name: 'Stay signed in' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(confirm).toHaveCount(0);
    await expect(page.getByTestId('console-rail')).toBeVisible();
  });
});
