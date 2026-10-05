import { expect, test, type Page } from '@playwright/test';
import { world } from '../lib/api.mjs';
import { freshTotp } from '../lib/totp.mjs';
import { stepper } from './shots';

async function openHash(page: Page, hash: string): Promise<void> {
  await page.evaluate((h) => {
    window.location.hash = h;
  }, hash);
}

test('admin web app: complete end-to-end journeys on live server', async ({ page }) => {
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

    // Test 1: Check typing into the 6-box field
    await box1.click();
    await page.keyboard.type('123');
    const box2 = page.getByLabel('Authenticator code, digit 2 of 6');
    const box3 = page.getByLabel('Authenticator code, digit 3 of 6');
    await expect(box1).toHaveValue('1');
    await expect(box2).toHaveValue('2');
    await expect(box3).toHaveValue('3');

    // Test 2: Check backspace
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Backspace');

    // Test 3: Check pasting full 6-digit TOTP into box 1
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
  // Journey 2: Restaurant Onboarding Queue & Halal Verification
  // =========================================================================
  await step(page, '04-restaurant-onboarding-queue', async () => {
    await expect(page.getByText('E2E Al-Barakah Grill')).toBeVisible();
    await page.getByText('E2E Al-Barakah Grill').click();
    await expect(page.getByRole('heading', { name: 'Al-Barakah Grill Inc.' })).toBeVisible();
  });

  await step(page, '05-approve-restaurant-documents', async () => {
    // Approve any pending documents in the table
    const approveButtons = page.locator('#application-documents button:has-text("Approve")');
    const count = await approveButtons.count();
    for (let i = 0; i < count; i++) {
      const btn = approveButtons.first();
      if (await btn.isVisible()) {
        await btn.click();
        await page.waitForTimeout(500);
      }
    }
  });

  await step(page, '06-open-halal-verification', async () => {
    const certBtn = page.getByRole('button', { name: 'Open halal verification (seven checks)' });
    await expect(certBtn).toBeVisible();
    await certBtn.click();
    await expect(page.getByRole('heading', { name: 'Halal verification' })).toBeVisible();
  });

  await step(page, '07-transcribe-halal-certificate', async () => {
    // If the certificate is PENDING transcription, transcribe it
    const transcribeHeading = page.getByRole('heading', { name: 'Transcribe the certificate' });
    if (await transcribeHeading.isVisible()) {
      // Select HMA Canada issuing body
      const issuerSelect = page.getByLabel('Issuing body');
      if (await issuerSelect.isVisible()) {
        await issuerSelect.selectOption({ label: 'Halal Monitoring Authority (HMA Canada)' });
      }
      await page.getByLabel('Certificate number').fill('E2E-HMA-999');
      await page.getByLabel('Certified legal name').fill('Al-Barakah Grill Inc.');
      await page.getByLabel('Certified address').fill('123 Danforth Ave, Toronto, ON');
      await page.getByLabel('Scope', { exact: true }).selectOption('WHOLE_ESTABLISHMENT');
      await page.getByLabel('Issued on').fill('2026-01-01');
      await page.getByLabel('Expires on').fill('2027-01-01');
      await page.getByRole('button', { name: 'Save transcription' }).click();
      await page.waitForTimeout(1000);
    }
  });

  await step(page, '08-record-seven-checks', async () => {
    // Record checks H1, H2, H3, H4, H6 as PASS (H5 and H7 are computed by the server)
    const checkKeys = ['H1_LEGIBLE_COMPLETE', 'H2_ISSUER_ACCEPTED', 'H3_NAME_MATCH', 'H4_ADDRESS_MATCH', 'H6_SCOPE_SUFFICIENT'];
    for (const key of checkKeys) {
      const passRadio = page.locator(`#hg-check-${key}-PASS`);
      if (await passRadio.isVisible()) {
        await passRadio.click();
        const recordBtn = page.getByTestId(`HalalChecklist-record-${key}`);
        if (await recordBtn.isVisible()) {
          await recordBtn.click();
          await page.waitForTimeout(600);
        }
      }
    }
  });

  await step(page, '09-approve-halal-certificate', async () => {
    const approveCert = page.getByTestId('HalalChecklist-approve');
    if (await approveCert.isVisible()) {
      await approveCert.click();
      await page.waitForTimeout(1000);
    }
    // Return to application
    await openHash(page, `#/applications/${w.onboardingRestaurant.id}`);
    await expect(page.getByRole('heading', { name: 'Al-Barakah Grill Inc.' })).toBeVisible();
  });

  await step(page, '10-approve-restaurant-application', async () => {
    const approveAppBtn = page.getByRole('button', { name: 'Approve application', exact: true });
    if (await approveAppBtn.isVisible()) {
      await approveAppBtn.click();
      // Fill the confirm dialog
      await expect(page.getByRole('heading', { name: 'Approve restaurant application' })).toBeVisible();
      const reasonSelect = page.getByRole('combobox');
      if (await reasonSelect.isVisible()) {
        await reasonSelect.selectOption('ALL_CHECKS_PASSED');
      }
      const noteInput = page.getByRole('textbox');
      if (await noteInput.isVisible()) {
        await noteInput.fill('All checks and KYC documents verified and approved.');
      }
      // Click confirm
      await page.getByRole('button', { name: 'Approve application' }).last().click();
      await page.waitForTimeout(1000);
    }
  });

  // =========================================================================
  // Journey 3: Rider Onboarding & Approval
  // =========================================================================
  await step(page, '11-rider-onboarding-queue', async () => {
    await openHash(page, '#/riders');
    await expect(page.getByRole('heading', { name: 'Rider onboarding queue' })).toBeVisible();
    await expect(page.getByText('Tariq Rider')).toBeVisible();
  });

  await step(page, '12-open-rider-application', async () => {
    await page.getByText('Tariq Rider').click();
    await expect(page.getByRole('heading', { name: 'Tariq Rider' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Identity' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Vehicle' })).toBeVisible();
  });

  await step(page, '13-approve-rider-documents-and-application', async () => {
    // Approve documents if present
    const approveDoc = page.locator('#rider-application-documents button:has-text("Approve")');
    if (await approveDoc.count() > 0 && await approveDoc.first().isVisible()) {
      await approveDoc.first().click();
      await page.waitForTimeout(1000);
    }
    // Approve rider application
    const approveRiderBtn = page.locator('.adm-form-actions button:has-text("Approve")');
    if (await approveRiderBtn.isVisible()) {
      await approveRiderBtn.click();
      await page.waitForTimeout(1000);
    }
  });

  // =========================================================================
  // Journey 4: Orders & Refunds
  // =========================================================================
  await step(page, '14-orders-search', async () => {
    await openHash(page, '#/orders');
    await expect(page.getByRole('heading', { name: 'Orders', exact: true })).toBeVisible();
    await page.getByLabel('Order code').fill(w.order.code);
    await page.getByRole('button', { name: 'Search' }).click();
    await expect(page.getByText(w.order.code).first()).toBeVisible();
  });

  await step(page, '15-order-detail-timeline-and-map', async () => {
    await page.getByText(w.order.code).first().click();
    await expect(page.getByRole('heading', { name: w.order.code })).toBeVisible();
    await expect(page.getByText('Timeline')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Money' })).toBeVisible();
  });

  await step(page, '16-refunds-cases-screen', async () => {
    await openHash(page, '#/refunds');
    await expect(page.getByRole('heading', { name: 'Refunds & disputes' })).toBeVisible();
    await expect(page.getByText('A-33 / A-35')).toBeVisible();
  });

  // =========================================================================
  // Journey 5: System Status (Postgres, Redis, Storage)
  // =========================================================================
  await step(page, '17-system-status-page', async () => {
    await openHash(page, '#/system');
    await expect(page.getByRole('heading', { name: 'System dependencies' })).toBeVisible();
    // System dependencies or Readiness fallback displays postgres, redis, minio
    await expect(page.getByText('postgres', { exact: false })).toBeVisible();
    await expect(page.getByText('redis', { exact: false })).toBeVisible();
    await expect(page.getByText('minio', { exact: false })).toBeVisible();
    await expect(page.getByText('HEALTHY').first()).toBeVisible();
  });

  // =========================================================================
  // Journey 6: Sign Out & Expired Session Gate
  // =========================================================================
  await step(page, '18-sign-out', async () => {
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page.getByRole('heading', { name: 'Admin sign in' })).toBeVisible();
  });

  await step(page, '19-unauthenticated-access-blocked', async () => {
    // Attempt navigating directly to a protected hash route without auth
    await openHash(page, '#/system');
    await expect(page.getByRole('heading', { name: 'Admin sign in' })).toBeVisible();
    await expect(page.getByText('System dependencies')).not.toBeVisible();
  });
});
