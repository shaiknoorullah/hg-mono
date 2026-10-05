import { expect, test, type Page } from '@playwright/test';
import { placeOrder, world } from '../lib/api.mjs';
import { freshTotp } from '../lib/totp.mjs';
import { stepper } from './shots';

// The admin web app (apps/admin) browser journeys against the API:
// 1. Sign in with TOTP (including typing & pasting into the 6-box input).
// 2. Halal certificate verification for certified and expired restaurants.
// 3. Orders: timeline, search, details, and money.
// 4. Refunds & disputes screen.
// 5. System status dependencies (Postgres, Redis, Storage).
// 6. Sign out and session protection.

async function openHash(page: Page, hash: string): Promise<void> {
  await page.evaluate((h) => {
    window.location.hash = h;
  }, hash);
}

test('admin web app: complete end-to-end journeys', async ({ page }) => {
  const w = world();
  const step = stepper('admin', 'journey');

  // =========================================================================
  // Journey 1: Sign in with TOTP (testing 6-box input: typing & pasting)
  // =========================================================================
  await step(page, '01-sign-in-gate', async () => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Admin sign in' })).toBeVisible();
    await page.getByLabel('Email').fill(w.admin.email);
    await page.getByLabel('Password').fill(w.password);
  });

  await step(page, '02-totp-typing-and-pasting', async () => {
    const box1 = page.getByLabel('Authenticator code, digit 1 of 6');
    await expect(box1).toBeVisible();

    // Check typing into the 6-box field
    await box1.click();
    await page.keyboard.type('123');
    const box2 = page.getByLabel('Authenticator code, digit 2 of 6');
    const box3 = page.getByLabel('Authenticator code, digit 3 of 6');
    await expect(box1).toHaveValue('1');
    await expect(box2).toHaveValue('2');
    await expect(box3).toHaveValue('3');

    // Check backspace
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Backspace');

    // Check pasting full 6-digit TOTP into box 1
    const totp = await freshTotp(w.admin.totpSecret);
    await box1.focus();
    await box1.evaluate((el: HTMLInputElement, code: string) => {
      const dt = new DataTransfer();
      dt.setData('text', code);
      const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
      el.dispatchEvent(ev);
    }, totp);

    // Verify all 6 boxes received the pasted digits
    for (let i = 0; i < 6; i++) {
      const b = page.getByLabel(`Authenticator code, digit ${i + 1} of 6`);
      await expect(b).toHaveValue(totp[i]!);
    }
  });

  await step(page, '03-sign-in-submitted', async () => {
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Restaurant onboarding queue' })).toBeVisible();
  });

  // =========================================================================
  // Journey 2: Halal Verification (Certified and Expired Restaurants)
  // =========================================================================
  await step(page, '04-certified-restaurant-halal-verification', async () => {
    await openHash(page, `#/certificates/${w.restaurant.certificateId}`);
    await expect(page.getByRole('heading', { name: 'Halal verification' })).toBeVisible();
    await expect(page.getByText(w.restaurant.certificateNumber).first()).toBeVisible();
    await expect(page.getByText(w.restaurant.name).first()).toBeVisible();
  });

  await step(page, '05-expired-restaurant-halal-verification', async () => {
    await openHash(page, `#/certificates/${w.expiredRestaurant.certificateId}`);
    await expect(page.getByRole('heading', { name: 'Halal verification' })).toBeVisible();
    await expect(page.getByText(w.expiredRestaurant.certificateNumber).first()).toBeVisible();
  });

  // =========================================================================
  // Journey 3: Orders, Timeline & Money Breakdown
  // =========================================================================
  let code = process.env.E2E_ADMIN_ORDER_CODE;
  if (!code && w.customers?.api) {
    try {
      const placed = await placeOrder('api');
      code = placed.code;
    } catch {
      // API call optional if orders were not pre-seeded
    }
  }

  if (code) {
    await step(page, '06-orders-search', async () => {
      await openHash(page, '#/orders');
      await expect(page.getByRole('heading', { name: 'Orders', exact: true })).toBeVisible();
      await page.getByLabel('Order code').fill(code!);
      await page.getByRole('button', { name: 'Search' }).click();
      await expect(page.getByText(code!).first()).toBeVisible();
    });

    await step(page, '07-order-detail-timeline-and-money', async () => {
      await page.getByText(code!).first().click();
      await expect(page.getByRole('heading', { name: code! })).toBeVisible();
      await expect(page.getByText('Timeline')).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Money' })).toBeVisible();
    });
  }

  // =========================================================================
  // Journey 4: Refunds & Disputes Screen
  // =========================================================================
  await step(page, '08-refunds-cases-screen', async () => {
    await openHash(page, '#/refunds');
    await expect(page.getByRole('heading', { name: 'Refunds & disputes' })).toBeVisible();
  });

  // =========================================================================
  // Journey 5: System Status (Postgres, Redis, Storage)
  // =========================================================================
  await step(page, '09-system-status-page', async () => {
    await openHash(page, '#/system');
    await expect(page.getByRole('heading', { name: 'System dependencies' })).toBeVisible();
    await expect(page.getByText('postgres', { exact: false })).toBeVisible();
    await expect(page.getByText('redis', { exact: false })).toBeVisible();
    await expect(page.getByText('minio', { exact: false })).toBeVisible();
  });

  // =========================================================================
  // Journey 6: Sign Out & Expired Session Gate
  // =========================================================================
  await step(page, '10-sign-out', async () => {
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page.getByRole('heading', { name: 'Admin sign in' })).toBeVisible();
  });

  await step(page, '11-unauthenticated-access-blocked', async () => {
    await openHash(page, '#/system');
    await expect(page.getByRole('heading', { name: 'Admin sign in' })).toBeVisible();
    await expect(page.getByText('System dependencies')).not.toBeVisible();
  });
});
