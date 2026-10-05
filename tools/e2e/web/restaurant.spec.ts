import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { adminOrder, placeOrder, world } from '../lib/api.mjs';
import { OUT } from '../lib/paths.mjs';
import { stepper } from './shots';

// The restaurant web app (apps/restaurant) against the API:
// Tests the owner operations (order handling, menu management, operating hours, payouts, mobile nav).

async function signIn(page: Page, email?: string): Promise<void> {
  const w = world();
  await page.goto('/login');
  await page.getByLabel('Business email').fill(email ?? w.restaurant.ownerEmail);
  await page.getByLabel('Password').fill(w.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  // Onboarding is finished, so the app moves on to the orders.
  await expect(page.getByRole('heading', { name: 'Live orders' })).toBeVisible();
}

/** The card for one order: the nearest block around its code that holds a button. */
function orderCard(page: Page, code: string) {
  return page.getByText(`#${code}`, { exact: true }).locator('xpath=ancestor::*[.//button][1]');
}

/** Clicks Refresh until the order shows (the page does not poll yet). */
async function waitForOrder(page: Page, code: string): Promise<void> {
  await expect(async () => {
    await page.getByRole('button', { name: 'Refresh' }).click();
    await expect(page.getByText(`#${code}`, { exact: true })).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 60_000 });
}

// ---------------------------------------------------------------------------
// 1. Order queue flow: order placed through the API accepted by restaurant
// ---------------------------------------------------------------------------
test('restaurant: sign in, see the live order queue, accept an order placed through the API', { tag: '@api-order' }, async ({ page }) => {
  const step = stepper('restaurant', 'api-order');

  await step(page, 'sign-in', async () => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'HalalGoes for restaurants' })).toBeVisible();
  });

  await step(page, 'live-orders', async () => {
    await signIn(page);
  });

  // A customer orders through the API; the fake payment client authorises it at once,
  // and the restaurant then has 180 seconds to accept.
  const order = await placeOrder('api');
  expect(order.state).toBe('RESTAURANT_PENDING');
  // For the admin flow, which opens this order when the phone flows did not make one.
  const orders = path.join(OUT, 'orders');
  mkdirSync(orders, { recursive: true });
  writeFileSync(path.join(orders, 'api.json'), JSON.stringify(order));

  await step(page, 'new-order', async () => {
    await waitForOrder(page, order.code);
    const card = orderCard(page, order.code);
    await expect(card.getByRole('button', { name: 'Accept' })).toBeVisible();
    await expect(card.getByText(world().restaurant.menuItemName, { exact: false })).toBeVisible();
  });

  await step(page, 'accepted', async () => {
    await orderCard(page, order.code).getByRole('button', { name: 'Accept' }).click();
    await expect(orderCard(page, order.code).getByText('Preparing', { exact: true })).toBeVisible();
  });

  // The API agrees: the order is in the kitchen.
  expect((await adminOrder(order.id)).state).toBe('PREPARING');
});

/** The order the customer placed on the emulator, from run.sh; the test skips without it. */
function crossOrder(): { id: string; code: string } {
  const code = process.env.E2E_CROSS_ORDER_CODE ?? '';
  const id = process.env.E2E_CROSS_ORDER_ID ?? '';
  test.skip(!code || !id, 'no order from the customer flow (E2E_CROSS_ORDER_CODE, E2E_CROSS_ORDER_ID)');
  return { id, code };
}

// ---------------------------------------------------------------------------
// 2. Cross-app smoke: customer phone order accepted and marked ready
// ---------------------------------------------------------------------------
test('restaurant: accept the order the customer placed on the phone', { tag: '@cross-accept' }, async ({ page }) => {
  const { id, code } = crossOrder();
  const step = stepper('restaurant', 'cross');

  await step(page, 'customer-order', async () => {
    await signIn(page);
    await waitForOrder(page, code);
  });

  await step(page, 'accepted', async () => {
    await orderCard(page, code).getByRole('button', { name: 'Accept' }).click();
    await expect(orderCard(page, code).getByRole('button', { name: 'Mark ready for pickup' })).toBeVisible();
  });

  expect((await adminOrder(id)).state).toBe('PREPARING');
});

test('restaurant: mark the customer\'s order ready for pickup', { tag: '@cross-ready' }, async ({ page }) => {
  const { id, code } = crossOrder();
  const step = stepper('restaurant', 'cross-ready');

  await step(page, 'ready-for-pickup', async () => {
    await signIn(page);
    await waitForOrder(page, code);
    await orderCard(page, code).getByRole('button', { name: 'Mark ready for pickup' }).click();
    await expect(orderCard(page, code).getByText('Ready for pickup', { exact: true })).toBeVisible();
  });

  expect((await adminOrder(id)).state).toBe('READY_FOR_PICKUP');
});

// ---------------------------------------------------------------------------
// 3. Complete browser journeys: register, menu, hours, payouts, mobile nav
// ---------------------------------------------------------------------------
test('restaurant web app: journeys (register, menu, hours, payouts, responsive nav)', async ({ page }) => {
  const step = stepper('restaurant', 'journey');

  // Register form validation
  await step(page, '01-register-form', async () => {
    await page.goto('/register');
    await expect(page.getByRole('heading', { name: 'Register your restaurant' })).toBeVisible();
    await page.getByLabel('Business name').fill('E2E New Grill');
    await page.getByLabel('Business email').fill(`e2e+reg_${Date.now()}@halalgoes.test`);
    await page.getByLabel('Password').fill('SecurePassword123!');
  });

  await step(page, '02-register-submit-terms-version-bug', async () => {
    await page.getByRole('button', { name: 'Create account' }).click();
    const alert = page.getByRole('alert');
    await expect(alert).toBeVisible();
    await expect(alert).toContainText('terms version is out of date');
  });

  // Sign in as active partner
  await step(page, '03-sign-in-partner', async () => {
    await signIn(page);
    await expect(page.getByRole('heading', { name: 'Live orders' })).toBeVisible();
  });

  // Menu Management
  await step(page, '04-menu-overview', async () => {
    await page.goto('/menu');
    await expect(page.getByRole('heading', { name: 'Menu', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add item' })).toBeVisible();
  });

  await step(page, '05-menu-add-category-and-item', async () => {
    await page.getByRole('button', { name: 'Add item' }).click();
    await expect(page.getByRole('heading', { name: 'Add menu item' })).toBeVisible();

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
    const toggle = page.getByRole('switch', { name: /available/i }).first();
    if (await toggle.isVisible()) {
      await toggle.click();
      await page.waitForTimeout(800);
    }
  });

  // Operating Hours
  await step(page, '09-hours-overview', async () => {
    await page.goto('/hours');
    await expect(page.getByRole('heading', { name: 'Hours & availability' })).toBeVisible();
    await expect(page.getByLabel('Accepting orders')).toBeVisible();
  });

  await step(page, '10-toggle-accepting-orders-focus', async () => {
    const switchEl = page.getByLabel('Accepting orders');
    await switchEl.focus();
    await expect(switchEl).toBeFocused();
    await switchEl.click();
    await page.waitForTimeout(800);
    await switchEl.click();
    await page.waitForTimeout(800);
  });

  // Payouts Page
  await step(page, '11-payouts-overview', async () => {
    await page.goto('/payouts');
    await expect(page.getByRole('heading', { name: 'Payouts', exact: true })).toBeVisible();
    await expect(page.getByText('Weekly, every Monday', { exact: false })).toBeVisible();
  });

  // Responsive Mobile Navigation (390px Viewport)
  await step(page, '12-mobile-responsive-bottom-nav', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/orders');
    await expect(page.getByRole('heading', { name: 'Live orders' })).toBeVisible();

    const mobileNav = page.locator('nav[aria-label="Primary"]');
    await expect(mobileNav).toBeVisible();

    const activeTile = mobileNav.locator('button[aria-current="page"]');
    await expect(activeTile).toBeVisible();
    await expect(activeTile).toContainText('Orders');
  });
});
