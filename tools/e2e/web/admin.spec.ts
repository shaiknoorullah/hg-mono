import { expect, test, type Page } from '@playwright/test';
import { world } from '../lib/api.mjs';
import { freshTotp } from '../lib/totp.mjs';
import { stepper } from './shots';

// The admin web app (apps/admin) against the real API: a super admin signs in with email,
// password and the authenticator code, opens an order, then the restaurant verification
// register: the review queue and the halal verification of each seeded restaurant's
// certificate.
//
// The admin keeps its session in memory only, so the test moves between screens inside the app
// (links and the URL hash), never by reloading the page.

async function openHash(page: Page, hash: string): Promise<void> {
  await page.evaluate((h) => {
    window.location.hash = h;
  }, hash);
}

test('admin: sign in with TOTP, open the order, open the verification register', async ({ page }) => {
  const w = world();
  const code = process.env.E2E_ADMIN_ORDER_CODE;
  const step = stepper('admin', 'admin');

  await step(page, 'sign-in', async () => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Admin sign in' })).toBeVisible();
    await page.getByLabel('Email').fill(w.admin.email);
    await page.getByLabel('Password').fill(w.password);
    await page.getByLabel('Authenticator code').first().fill(await freshTotp(w.admin.totpSecret));
  });

  await step(page, 'review-queue', async () => {
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Restaurant onboarding queue' })).toBeVisible();
  });

  if (code) {
    await step(page, 'orders', async () => {
      await page.getByRole('link', { name: 'Orders' }).click();
      await expect(page.getByRole('heading', { name: 'Orders', exact: true })).toBeVisible();
      await page.getByLabel('Order code').fill(code);
      await page.getByRole('button', { name: 'Search' }).click();
      await expect(page.getByRole('gridcell', { name: code })).toBeVisible();
    });

    await step(page, 'order-detail', async () => {
      await page.getByRole('gridcell', { name: code }).click();
      await expect(page.getByRole('heading', { name: code })).toBeVisible();
      await expect(page.getByText(w.restaurant.name).first()).toBeVisible();
    });
  }

  await step(page, 'certified-restaurant', async () => {
    await openHash(page, `#/certificates/${w.restaurant.certificateId}`);
    await expect(page.getByRole('heading', { name: 'Halal verification' })).toBeVisible();
    await expect(page.getByText(w.restaurant.certificateNumber).first()).toBeVisible();
  });

  await step(page, 'expired-restaurant', async () => {
    await openHash(page, `#/certificates/${w.expiredRestaurant.certificateId}`);
    await expect(page.getByRole('heading', { name: 'Halal verification' })).toBeVisible();
    await expect(page.getByText(w.expiredRestaurant.certificateNumber).first()).toBeVisible();
  });

  test.info().annotations.push({
    type: 'order',
    description: code ? `opened order ${code}` : 'no order code given (E2E_ADMIN_ORDER_CODE): order steps skipped',
  });
  expect(code, 'run.sh passes the code of an order an earlier flow placed').toBeTruthy();
});
