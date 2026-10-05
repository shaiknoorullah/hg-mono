import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { adminOrder, placeOrder, world } from '../lib/api.mjs';
import { OUT } from '../lib/paths.mjs';
import { stepper } from './shots';

// The restaurant web app (apps/restaurant) against the real API: the owner of Bismillah Grill
// signs in with email and password, sees the live order queue and works orders in it.

async function signIn(page: Page): Promise<void> {
  const w = world();
  await page.goto('/login');
  await page.getByLabel('Business email').fill(w.restaurant.ownerEmail);
  await page.getByLabel('Password').fill(w.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  // Onboarding is finished, so the app moves on to the orders.
  await expect(page.getByRole('heading', { name: 'Live orders', level: 1 })).toBeVisible();
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

test('restaurant: sign in, see the live order queue, accept an order placed through the API', { tag: '@api-order' }, async ({ page }) => {
  const step = stepper('restaurant', 'api-order');

  await step(page, 'sign-in', async () => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'HalalGoes for restaurants' })).toBeVisible();
  });

  await step(page, 'live-orders', async () => {
    await signIn(page);
  });

  // A second customer orders through the API; the fake payment client authorises it at once,
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

// The cross-app smoke, in two parts: the restaurant accepts the customer's order within its
// 180 seconds, and marks it ready once the rider is online (run.sh waits for that), so that
// dispatch offers it to the rider.
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
