import { expect, test, type Page } from '@playwright/test';

import { expectDesignFor } from './design';
import { MODE, openSignedIn } from './redesign-restaurant.support';
import { projectMeta } from './mode';

test.skip(MODE !== 'mock', 'written against the mock server; run with E2E_MODE=mock');

/**
 * The redesigned restaurant console's frame below 768 px (issue #954): the side navigation as a
 * menu button and drawer, the orders strip as one row, panels full screen. The phone boards draw
 * the frame only inside the settings and payouts reflow boards, so those are the boards the frame
 * is captured against; the pages inside them are those pages' own work, and their capture can
 * differ for reasons outside the frame (the Card border defect and the Hours view that does not
 * render, both listed on the pull request). The frame itself is asserted from the page, below.
 *
 * What the phone boards do NOT draw, and so what is not asserted to match anything: the service
 * status bar (health, open state, the Orders switch, Pause) at phone width; the account menu; the
 * drawer once open; waiting orders in the strip. The status bar and waiting orders are only kept
 * from overflowing the page.
 *
 * Board ids are written out in full on purpose: tools/e2e/web/check-boards.mjs validates only
 * literal ids.
 */

const ROUTES = ['/orders/history', '/menu', '/hours', '/payouts', '/settings'] as const;

async function overflow(page: Page) {
  return page.evaluate(() => document.scrollingElement!.scrollWidth - window.innerWidth);
}

test.describe('redesigned restaurant · frame at 320 px (mock)', () => {
  test.use({ colorScheme: 'light', viewport: { width: 320, height: 1000 } });

  for (const path of ROUTES) {
    test(`${path}: a menu button instead of the rail, and nothing past the right edge`, async ({ page }) => {
      test.skip(projectMeta().viewport !== 'desktop', 'one run at 320 px, not one per project');
      await openSignedIn(page, path);
      await page.waitForLoadState('networkidle');
      await expect(page.getByTestId('open-navigation')).toBeVisible();
      await expect(page.getByTestId('console-rail')).toHaveCount(0);
      expect(await overflow(page), 'the page must not scroll sideways').toBeLessThanOrEqual(0);
      // The status bar is not drawn on the phone boards; it must still stay inside the page.
      const bar = await page.getByTestId('status-bar').boundingBox();
      expect(bar!.x + bar!.width).toBeLessThanOrEqual(320);
      // The orders strip is the one-line row (nothing is waiting in the mock).
      const strip = page.getByTestId('new-order-strip');
      if (await strip.count()) {
        await expect(strip).toHaveAttribute('data-phone-row', '');
        const box = await strip.boundingBox();
        expect(box!.height).toBeLessThanOrEqual(48);
      }
    });
  }

  test('the menu button opens the links in a drawer, and choosing one closes it', async ({ page }) => {
    test.skip(projectMeta().viewport !== 'desktop', 'one run at 320 px, not one per project');
    await openSignedIn(page, '/payouts');
    await page.getByRole('button', { name: /^Open navigation/ }).click();
    const drawer = page.getByTestId('console-drawer-nav');
    await expect(drawer.getByRole('link')).toHaveCount(6);
    await expect(drawer.getByRole('link', { name: /^Payouts/ })).toHaveAttribute('aria-current', 'page');
    await drawer.getByRole('link', { name: /^Hours/ }).click();
    await expect(drawer).toHaveCount(0);
    await expect(page).toHaveURL(/\/hours$/);
  });

  test('a panel opens over the whole page', async ({ page }) => {
    test.skip(projectMeta().viewport !== 'desktop', 'one run at 320 px, not one per project');
    await openSignedIn(page, '/payouts?panel=health');
    const panel = page.getByRole('complementary', { name: /Screen health/i });
    await expect(panel).toBeVisible();
    await expect(page.locator('#main')).toBeHidden();
    const box = await panel.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(320);
    expect(box!.width).toBeGreaterThan(280);
    expect(await overflow(page)).toBeLessThanOrEqual(0);
  });

  test('settings at 320 px', async ({ page }) => {
    test.skip(projectMeta().viewport !== 'desktop', 'one capture at 320 px, not one per project');
    await openSignedIn(page, '/settings');
    await page.waitForLoadState('networkidle');
    await expectDesignFor(page, { 320: 'restaurant/settings/Reflow-Settings-320' });
  });
});

test.describe('redesigned restaurant · frame at 720 px, 200% zoom of a 1440 px screen (mock)', () => {
  test.use({ colorScheme: 'light', viewport: { width: 720, height: 1000 } });

  test('settings at 720 px is the phone frame', async ({ page }) => {
    test.skip(projectMeta().viewport !== 'desktop', 'one capture at 720 px, not one per project');
    await openSignedIn(page, '/settings');
    await page.waitForLoadState('networkidle');
    await expect(page.getByTestId('open-navigation')).toBeVisible();
    await expectDesignFor(page, { 720: 'restaurant/settings/Reflow-Settings-720' });
  });
});
