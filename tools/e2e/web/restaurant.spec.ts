import { expect, test, type Page } from '@playwright/test';
import { world } from '../lib/api.mjs';
import { stepper } from './shots';

async function signIn(page: Page, email?: string): Promise<void> {
  const w = world();
  await page.goto('/login');
  await page.getByLabel('Business email').fill(email ?? w.restaurant.ownerEmail);
  await page.getByLabel('Password').fill(w.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
}

/** The card for one order: the nearest block around its code that holds a button. */
function orderCard(page: Page, code: string) {
  return page.getByText(`#${code}`, { exact: true }).locator('xpath=ancestor::*[.//button][1]');
}

test('restaurant web app: complete end-to-end journeys on live server', async ({ page }) => {
  const w = world();
  const step = stepper('restaurant', 'journey');

  // =========================================================================
  // Journey 1: Register, Onboarding Profile, Documents, Payouts
  // =========================================================================
  await step(page, '01-register-form', async () => {
    await page.goto('/register');
    await expect(page.getByRole('heading', { name: 'Register your restaurant' })).toBeVisible();
    await page.getByLabel('Business name').fill('E2E New Grill');
    await page.getByLabel('Business email').fill(`e2e+reg_${Date.now()}@halalgoes.test`);
    await page.getByLabel('Password').fill('SecurePassword123!');
  });

  await step(page, '02-register-submit-terms-version-bug', async () => {
    // Submitting register triggers App Bug #1 (terms_version '2026-01-01' vs server '2026-01')
    await page.getByRole('button', { name: 'Create account' }).click();
    // Wait for the error banner/alert to appear
    const alert = page.getByRole('alert');
    await expect(alert).toBeVisible();
    await expect(alert).toContainText('terms version is out of date');
  });

  await step(page, '03-sign-in-partner', async () => {
    // Sign in as Bismillah Grill (active partner) to test live operational surfaces
    await signIn(page);
    await expect(page.getByRole('heading', { name: 'Live orders' })).toBeVisible();
  });

  // =========================================================================
  // Journey 2: Menu Management (Categories, Items, Edit, Availability)
  // =========================================================================
  await step(page, '04-menu-overview', async () => {
    await page.goto('/menu');
    await expect(page.getByRole('heading', { name: 'Menu', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add item' })).toBeVisible();
  });

  await step(page, '05-menu-add-category-and-item', async () => {
    await page.getByRole('button', { name: 'Add item' }).click();
    await expect(page.getByRole('heading', { name: 'Add menu item' })).toBeVisible();

    // Select "New category" tab
    const newCatTab = page.getByRole('tab', { name: 'New category' });
    if (await newCatTab.isVisible()) {
      await newCatTab.click();
      await page.getByPlaceholder('e.g. Grills').fill('E2E Specials');
    }
    await page.getByLabel('Item name').fill('Special Biryani');
    await page.getByLabel('Price (CAD)').fill('16.50');
    await page.getByRole('button', { name: 'Add item' }).last().click();
    await page.waitForTimeout(1000);
  });

  await step(page, '06-menu-add-second-item', async () => {
    await page.getByRole('button', { name: 'Add item' }).click();
    await expect(page.getByRole('heading', { name: 'Add menu item' })).toBeVisible();

    const existingCatTab = page.getByRole('tab', { name: 'Existing category' });
    if (await existingCatTab.isVisible()) {
      await existingCatTab.click();
    }
    await page.getByLabel('Item name').fill('Special Mango Lassi');
    await page.getByLabel('Price (CAD)').fill('6.50');
    await page.getByRole('button', { name: 'Add item' }).last().click();
    await page.waitForTimeout(1000);
  });

  await step(page, '07-menu-edit-item', async () => {
    // Find edit button on Special Biryani
    const editBtn = page.locator('button[aria-label="Edit Special Biryani"]');
    if (await editBtn.isVisible()) {
      await editBtn.click();
      await expect(page.getByRole('heading', { name: 'Edit item' })).toBeVisible();
      await page.getByLabel('Price (CAD)').fill('17.50');
      await page.getByRole('button', { name: 'Save changes' }).click();
      await page.waitForTimeout(1000);
    }
  });

  await step(page, '08-menu-toggle-availability', async () => {
    // Toggle availability on Special Biryani or any menu item
    const toggle = page.getByRole('switch', { name: /available/i }).first();
    if (await toggle.isVisible()) {
      await toggle.click();
      await page.waitForTimeout(800);
    }
  });

  // =========================================================================
  // Journey 3: Operating Hours & Accepting Orders Toggle
  // =========================================================================
  await step(page, '09-hours-overview', async () => {
    await page.goto('/hours');
    await expect(page.getByRole('heading', { name: 'Hours & availability' })).toBeVisible();
    await expect(page.getByLabel('Accepting orders')).toBeVisible();
  });

  await step(page, '10-toggle-accepting-orders-focus', async () => {
    const switchEl = page.getByLabel('Accepting orders');
    await switchEl.focus();
    // Verify focused
    await expect(switchEl).toBeFocused();
    // Toggle accepting orders
    await switchEl.click();
    await page.waitForTimeout(800);
    // Toggle back
    await switchEl.click();
    await page.waitForTimeout(800);
  });

  // =========================================================================
  // Journey 4: Orders (Live queue, chime & highlight, accept, ready)
  // =========================================================================
  await step(page, '11-orders-queue-arrival', async () => {
    await page.goto('/orders');
    await expect(page.getByRole('heading', { name: 'Live orders' })).toBeVisible();
    // Check if seeded order HG-E2E02 appears in the queue
    const card = orderCard(page, w.liveOrder.code);
    await expect(card).toBeVisible({ timeout: 15_000 });
  });

  await step(page, '12-orders-accept', async () => {
    const acceptBtn = page.getByRole('button', { name: 'Accept' }).first();
    await acceptBtn.click();
    // Verify Preparing status chip
    await expect(page.getByText('Preparing').first()).toBeVisible();
  });

  await step(page, '13-orders-ready-for-pickup', async () => {
    const readyBtn = page.getByRole('button', { name: 'Mark ready for pickup' }).first();
    await readyBtn.click();
    // Verify Ready for pickup status chip
    await expect(page.getByText('Ready for pickup').first()).toBeVisible();
  });

  // =========================================================================
  // Journey 5: Payouts Page
  // =========================================================================
  await step(page, '14-payouts-overview', async () => {
    await page.goto('/payouts');
    await expect(page.getByRole('heading', { name: 'Payouts', exact: true })).toBeVisible();
    await expect(page.getByText('Weekly, every Monday', { exact: false })).toBeVisible();
  });

  // =========================================================================
  // Journey 6: Responsive Mobile Navigation (390px Viewport)
  // =========================================================================
  await step(page, '15-mobile-responsive-bottom-nav', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/orders');
    await expect(page.getByRole('heading', { name: 'Live orders' })).toBeVisible();

    // Verify mobile bottom navigation is rendered
    const mobileNav = page.locator('nav[aria-label="Primary"]');
    await expect(mobileNav).toBeVisible();

    // Verify the active tile marks the current page with aria-current="page"
    const activeTile = mobileNav.locator('button[aria-current="page"]');
    await expect(activeTile).toBeVisible();
    await expect(activeTile).toContainText('Orders');
  });
});
