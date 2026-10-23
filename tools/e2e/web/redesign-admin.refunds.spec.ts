import { expect, test, type Page } from '@playwright/test';

import { E2E_MODE } from './mode';
import { emptyPage, fixture, never, openAdmin, shoot, failing } from './redesign-admin.refunds-staff.support';

test.skip(E2E_MODE !== 'mock', 'written against the mock server; run with E2E_MODE=mock');

/**
 * The Refunds page of the redesigned admin console (`#/refunds`), each state captured for the
 * design board it must match (tools/e2e/README.md, "Design captures"): the failed-refunds queue,
 * the lookup of one order by its code, and what the lookup finds.
 *
 * Every response is a contract fixture, served by the mock server by scenario name
 * (`X-Mock-Scenario`), and the browser clock is the fixtures' frozen clock. The boards draw one
 * set of sample orders (HG-7XQ3NE from Zaytoun Grill and so on) and the fixtures describe another
 * (Karachi Kitchen), so every figure and name differs from the board's; that is the seeded data
 * against board copy difference tracked in
 * https://github.com/shaiknoorullah/hg-mono/issues/961, not a screen difference.
 *
 * The refund panel in the order workspace is redesign-admin.refunds-panel.spec.ts; the boards of
 * the area that no capture can pair with a screen are declared in
 * redesign-admin.refunds-staff-unpairable.spec.ts. Board ids are written out in full on purpose:
 * tools/e2e/web/check-boards.mjs validates only literal ids.
 */
const BASE = process.env.E2E_ADMIN_REDESIGN_URL ?? process.env.BASE_URL;
if (BASE) test.use({ baseURL: BASE });

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.metadata.viewport === 'tablet', 'the boards are drawn at 1440 wide');
});

const FAILED = fixture('admin_refund_queue_failed');
const EVERY_STATE = fixture('order_admin_list_every_state');

const failedGrid = (page: Page) => page.getByRole('grid', { name: 'Failed refunds' });

async function find(page: Page, code: string) {
  await page.getByLabel('Order code').fill(code);
  await page.getByRole('button', { name: 'Find order' }).click();
}

test.describe('redesigned admin · refunds page (mock)', () => {
  test.use({ colorScheme: 'light' });

  test('failed refunds first, then look up one order', async ({ page }) => {
    await openAdmin(page, '#/refunds', { failed: FAILED });
    await expect(failedGrid(page).getByText('HG-COED-9X')).toBeVisible();
    await shoot(page, { 1440: 'admin/refunds/Refunds' });
  });

  test('as a support agent', async ({ page }) => {
    await openAdmin(page, '#/refunds', { role: 'SUPPORT_AGENT', failed: FAILED });
    await expect(failedGrid(page).getByText('HG-COED-9X')).toBeVisible();
    await shoot(page, { 1440: 'admin/refunds/RefundsSupportLookup' });
  });

  test('finding the order', async ({ page }) => {
    await openAdmin(page, '#/refunds', { failed: FAILED, list: never });
    await expect(failedGrid(page).getByText('HG-COED-9X')).toBeVisible();
    await find(page, 'HG-7XQ3NE');
    await shoot(page, { 1440: 'admin/refunds/RefundsSearching' }, { idle: false });
  });

  test('no order has that code', async ({ page }) => {
    await openAdmin(page, '#/refunds', { failed: FAILED, list: emptyPage });
    await expect(failedGrid(page).getByText('HG-COED-9X')).toBeVisible();
    await find(page, 'HG-7Q2M4K');
    await expect(page.getByText('No order has the code HG-7Q2M4K')).toBeVisible();
    await shoot(page, { 1440: 'admin/refunds/RefundsNotFound' });
  });

  test('the lookup fails', async ({ page }) => {
    await openAdmin(page, '#/refunds', { failed: FAILED, list: failing });
    await expect(failedGrid(page).getByText('HG-COED-9X')).toBeVisible();
    await find(page, 'HG-7XQ3NE');
    await expect(page.getByText("The lookup didn't finish.")).toBeVisible();
    await shoot(page, { 1440: 'admin/refunds/RefundsLookupError' });
  });

  test('offline', async ({ page }) => {
    await openAdmin(page, '#/refunds', { failed: FAILED });
    await expect(failedGrid(page).getByText('HG-COED-9X')).toBeVisible();
    await page.context().setOffline(true);
    await expect(page.getByText('You’re offline.', { exact: true })).toBeVisible();
    await shoot(page, { 1440: 'admin/refunds/RefundsOffline' });
  });

  test('no failed refunds', async ({ page }) => {
    await openAdmin(page, '#/refunds', { failed: fixture('admin_refund_queue_empty') });
    await expect(page.getByText('No failed refunds').first()).toBeVisible();
    await shoot(page, { 1440: 'admin/refunds/RefundsNoFailed' });
  });

  test('failed refunds loading', async ({ page }) => {
    await openAdmin(page, '#/refunds', { failed: never });
    await expect(page.getByRole('heading', { name: 'Failed refunds' })).toBeVisible();
    await shoot(page, { 1440: 'admin/refunds/RefundsFailedLoading' }, { idle: false });
  });

  test('failed refunds did not load', async ({ page }) => {
    await openAdmin(page, '#/refunds', { failed: failing });
    await expect(page.getByText('Failed refunds didn’t load')).toBeVisible();
    await shoot(page, { 1440: 'admin/refunds/RefundsFailedError' });
  });

  test('a new refund after a failure, from the queue', async ({ page }) => {
    await openAdmin(page, '#/refunds', { failed: FAILED, order: fixture('order_admin_view_delivered') });
    await expect(failedGrid(page).getByText('HG-COED-9X')).toBeVisible();
    await failedGrid(page).getByRole('button', { name: /Actions for the failed refund/ }).first().click();
    await page.getByRole('menuitem', { name: 'Issue a new refund' }).click();
    await expect(page.getByRole('region', { name: /Issue a refund/ })).toBeVisible();
    await expect(page.getByText('Started from a failed refund')).toBeVisible();
    await shoot(page, { 1440: 'admin/refunds/RefundsRetry' });
  });
});

/**
 * An order found by its code: `[board, code, order fixture, text the page shows]`. The codes are
 * the boards'; the order is the fixture for the same state, since the page shows the order the
 * server answers whatever code was typed.
 */
const FOUND: ReadonlyArray<readonly [string, string, string, string]> = [
  ['admin/refunds/RefundNothingCaptured', 'HG-3MW9FD', 'order_admin_view_authorized', 'Nothing captured yet, so there is nothing to refund'],
  ['admin/refunds/RefundsNothingRejected', 'HG-4T7MXB', 'order_admin_view_rejected', 'Nothing was charged, so there is nothing to refund'],
  ['admin/refunds/RefundsNothingVoided', 'HG-5TW3KD', 'order_admin_view_cancelled', 'Nothing was charged, so there is nothing to refund'],
  ['admin/refunds/RefundsNothingFailed', 'HG-9TK3MA', 'order_admin_view_failed', 'Nothing was charged, so there is nothing to refund'],
  ['admin/refunds/RefundsFullyRefunded', 'HG-7DT1PZ', 'order_admin_view_cancelled_after_acceptance', 'Everything captured has already been refunded'],
  ['admin/refunds/RefundsHalalConcern', 'HG-6HC3QA', 'order_admin_view_halal_concern_refund', 'Open order'],
  ['admin/refunds/RefundsNoHalal', 'HG-2VN7QT', 'order_admin_view_delivered_no_halal', 'Open order'],
];

test.describe('redesigned admin · refunds page, an order found by its code (mock)', () => {
  test.use({ colorScheme: 'light' });

  for (const [board, code, scenario, text] of FOUND) {
    test(`${scenario.replace('order_admin_view_', '').replace(/_/g, ' ')}`, async ({ page }) => {
      await openAdmin(page, '#/refunds', { failed: FAILED, list: EVERY_STATE, order: fixture(scenario) });
      await expect(failedGrid(page).getByText('HG-COED-9X')).toBeVisible();
      await find(page, code);
      await expect(page.getByText(text).first()).toBeVisible();
      await shoot(page, { 1440: board });
    });
  }
});

test.describe('redesigned admin · refunds page, goodwill sent for a second approval (mock)', () => {
  test.use({ colorScheme: 'light' });

  test('an admin’s large goodwill refund', async ({ page }) => {
    await openAdmin(page, '#/refunds', {
      failed: FAILED,
      list: EVERY_STATE,
      order: fixture('order_admin_view_completed'),
      issue: fixture('refund_approval_request_pending'),
    });
    await expect(failedGrid(page).getByText('HG-COED-9X')).toBeVisible();
    await find(page, 'HG-2RC9LA');
    await page.getByRole('button', { name: 'Issue refund…', exact: true }).click();
    const panel = page.getByRole('region', { name: /Issue a refund/ });
    await panel.getByRole('radio', { name: /Goodwill amount/ }).click();
    await panel.getByRole('textbox', { name: /Goodwill amount/ }).fill('60.00');
    await page.keyboard.press('Tab');
    await panel.getByLabel(/What happened/).fill('Customer waited 40 minutes past the estimate; offering goodwill.');
    await panel.getByRole('button', { name: 'Review refund' }).click();
    await page.getByRole('region', { name: /Review before money moves/ }).getByRole('button', { name: 'Issue refund', exact: true }).click();
    await expect(page.getByText(/Sent for approval. Nothing has moved yet./)).toBeVisible();
    await shoot(page, { 1440: 'admin/refunds/RefundApprovalAdmin' });
  });
});
