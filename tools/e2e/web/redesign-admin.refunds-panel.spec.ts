import { expect, test, type Page, type Route } from '@playwright/test';

import { E2E_MODE } from './mode';
import { choose, fixture, never, openAdmin, orderIdOf, refuse, shoot, type AdminRoutes } from './redesign-admin.refunds-staff.support';
import type { StaffRole } from './redesign-admin.support';

test.skip(E2E_MODE !== 'mock', 'written against the mock server; run with E2E_MODE=mock');

/**
 * The refund panel in the order workspace of the redesigned admin console, each state captured for
 * the design board it must match (tools/e2e/README.md, "Design captures"): the form, the review
 * step before money moves, the server's answer (201, 202 and the refusals the contract lists for
 * issuing) and the order's refund rows.
 *
 * Every response is a contract fixture, served by the mock server by scenario name
 * (`X-Mock-Scenario`), and the browser clock is the fixtures' frozen clock. The boards draw the
 * order workspace of one sample order (HG-7XQ3NE) in two shapes, with and without an earlier
 * refund, and the fixtures describe another restaurant's orders, so every name and figure differs;
 * that is https://github.com/shaiknoorullah/hg-mono/issues/961, not a screen difference. Each
 * board's variant is mapped to the fixture for the same state, as the orders area does:
 *
 * - `deliveredplain`: `order_admin_view_delivered` (delivered, no refunds)
 * - `delivered`: `order_admin_view_delivered_refund_failed` (one refund settled, one failed)
 * - `disputed`, `preparing`, `refundstates`: the fixtures of the same names
 *
 * What the form says is typed as the boards type it. The boards that no capture can pair with a
 * screen are declared in redesign-admin.refunds-staff-unpairable.spec.ts. Board ids are written
 * out in full on purpose: tools/e2e/web/check-boards.mjs validates only literal ids.
 */
const BASE = process.env.E2E_ADMIN_REDESIGN_URL ?? process.env.BASE_URL;
if (BASE) test.use({ baseURL: BASE });

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.metadata.viewport === 'tablet', 'the boards are drawn at 1440 wide');
});

const PLAIN = 'order_admin_view_delivered';
const WITH_REFUNDS = 'order_admin_view_delivered_refund_failed';

const WHOLE_TEXT = 'Customer reports the platter was cold and undercooked.';
const CASE_ID = '0192c3f0-7b1e-7c4a-9d2e-5f8a1b3c4d6e';

/** Opens the order workspace of the order `scenario` describes. */
async function openOrder(page: Page, scenario: string, routes: AdminRoutes & { role?: StaffRole } = {}) {
  const id = await orderIdOf(page, scenario);
  await openAdmin(page, `#/orders/${id}`, { list: fixture('order_admin_list_every_state'), order: fixture(scenario), ...routes });
  await expect(page.locator('#order-heading')).toBeVisible();
}

const form = (page: Page) => page.getByRole('region', { name: /Issue a refund/ });
const review = (page: Page) => page.getByRole('region', { name: /Review before money moves/ });

/** Starts a refund: the visible button once money has been taken, or the More actions menu before. */
async function start(page: Page, how: 'button' | 'menu' = 'button') {
  if (how === 'button') {
    await page.getByRole('button', { name: 'Issue refund', exact: true }).click();
  } else {
    await page.getByRole('button', { name: /More actions/ }).click();
    await page.getByRole('menuitem', { name: /Issue refund/ }).click();
  }
  await expect(form(page)).toBeVisible();
}

interface Draft {
  scope?: 'Whole order' | 'Selected items' | 'Goodwill amount';
  reason?: string;
  text: string;
  /** Dollars and cents typed into the Goodwill amount field. */
  goodwill?: string;
  /** Tick the first line of the order. */
  firstLine?: boolean;
  caseId?: string;
}

async function fill(page: Page, d: Draft) {
  const panel = form(page);
  if (d.scope && d.scope !== 'Whole order') await panel.getByRole('radio', { name: new RegExp(d.scope) }).click();
  if (d.firstLine) await panel.getByRole('checkbox').first().check();
  if (d.goodwill !== undefined) {
    await panel.getByRole('textbox', { name: /Goodwill amount/ }).fill(d.goodwill);
    await page.keyboard.press('Tab');
  }
  if (d.reason) await choose(page, 'Reason', d.reason);
  await panel.getByLabel(/What happened/).fill(d.text);
  if (d.caseId) await panel.getByLabel(/Case id/).fill(d.caseId);
}

const toReview = async (page: Page) => {
  await form(page).getByRole('button', { name: 'Review refund' }).click();
  await expect(review(page)).toBeVisible();
};
const issue = (page: Page) => review(page).getByRole('button', { name: /^(Issue refund|Try again)$/ }).click();

const WHOLE: Draft = { reason: 'Food quality', text: WHOLE_TEXT };

test.describe('redesigned admin · refund form (mock)', () => {
  test.use({ colorScheme: 'light' });

  test('whole order, food quality', async ({ page }) => {
    await openOrder(page, PLAIN);
    await start(page);
    await fill(page, WHOLE);
    await shoot(page, { 1440: 'admin/refunds/RefundFull' });
  });

  test('selected items', async ({ page }) => {
    await openOrder(page, WITH_REFUNDS);
    await start(page);
    await fill(page, { scope: 'Selected items', reason: 'Wrong item', firstLine: true, text: 'Customer received a beef plate instead of chicken.' });
    await shoot(page, { 1440: 'admin/refunds/RefundItems' });
  });

  test('goodwill amount', async ({ page }) => {
    await openOrder(page, WITH_REFUNDS);
    await start(page);
    await fill(page, { scope: 'Goodwill amount', goodwill: '15.00', text: 'Customer waited 40 minutes past the estimate; offering goodwill.' });
    await shoot(page, { 1440: 'admin/refunds/RefundGoodwill' });
  });

  test('an order still being prepared', async ({ page }) => {
    await openOrder(page, 'order_admin_view_preparing');
    await start(page, 'menu');
    await fill(page, { reason: 'Duplicate charge', text: 'Customer’s bank shows this order charged twice at 6:44 pm.' });
    await shoot(page, { 1440: 'admin/refunds/RefundRunning' });
  });

  test('a disputed order, reason from what went wrong', async ({ page }) => {
    await openOrder(page, 'order_admin_view_disputed');
    await start(page);
    await fill(page, { reason: 'Food quality', text: 'Bag arrived open and the food was cold; customer sent photos to support.' });
    await shoot(page, { 1440: 'admin/refunds/RefundDisputed' });
  });

  test('fields that need fixing', async ({ page }) => {
    await openOrder(page, WITH_REFUNDS);
    await start(page);
    await fill(page, { scope: 'Selected items', reason: 'Wrong item', text: 'Wrong' });
    await form(page).getByRole('button', { name: 'Review refund' }).click();
    await expect(page.getByText('Choose at least one item to refund.')).toBeVisible();
    await shoot(page, { 1440: 'admin/refunds/RefundFieldErrors' });
  });

  test('a goodwill amount that is not whole cents', async ({ page }) => {
    await openOrder(page, WITH_REFUNDS);
    await start(page);
    await fill(page, { scope: 'Goodwill amount', goodwill: '12.345', text: 'Customer waited 40 minutes past the estimate; offering goodwill.' });
    await form(page).getByRole('button', { name: 'Review refund' }).click();
    await shoot(page, { 1440: 'admin/refunds/RefundGoodwillErrors' });
  });

  test('review before money moves', async ({ page }) => {
    await openOrder(page, PLAIN);
    await start(page);
    await fill(page, { ...WHOLE, caseId: CASE_ID });
    await toReview(page);
    await shoot(page, { 1440: 'admin/refunds/RefundConfirm' });
  });

  test('sending', async ({ page }) => {
    await openOrder(page, PLAIN, { issue: never });
    await start(page);
    await fill(page, { ...WHOLE, caseId: CASE_ID });
    await toReview(page);
    await issue(page);
    await shoot(page, { 1440: 'admin/refunds/RefundSubmitting' }, { idle: false });
  });

  test('no answer, try the same request', async ({ page }) => {
    await openOrder(page, PLAIN, { issue: refuse(503, 'INTERNAL_ERROR', 'Upstream timeout.') });
    await start(page);
    await fill(page, WHOLE);
    await toReview(page);
    await issue(page);
    await expect(page.getByText('The server didn’t answer in time')).toBeVisible();
    await shoot(page, { 1440: 'admin/refunds/RefundTimeout' });
  });

  test('the session ended, draft kept', async ({ page }) => {
    await openOrder(page, PLAIN, { issue: fixture('error_session_expired') });
    await start(page);
    await fill(page, WHOLE);
    await toReview(page);
    await issue(page);
    await expect(page.getByRole('dialog')).toBeVisible();
    await shoot(page, { 1440: 'admin/refunds/RefundsReauth' });
  });
});

/** Fills, reviews and issues, then waits for the panel to say `answer`. */
async function issued(page: Page, draft: Draft, answer: RegExp | string) {
  await start(page);
  await fill(page, draft);
  await toReview(page);
  await issue(page);
  await expect(page.getByText(answer).first()).toBeVisible();
}

test.describe('redesigned admin · refund results (mock)', () => {
  test.use({ colorScheme: 'light' });

  test('whole order issued', async ({ page }) => {
    await openOrder(page, PLAIN);
    await issued(page, WHOLE, /Refund issued. Sent to the payment provider./);
    await shoot(page, { 1440: 'admin/refunds/RefundIssued' });
  });

  test('issued, split not returned', async ({ page }) => {
    await openOrder(page, PLAIN, { issue: fixture('refund_submitted_no_split') });
    await issued(page, WHOLE, /Refund issued. Sent to the payment provider./);
    await expect(page.getByText('Who bears it is set when the refund is authorised.').first()).toBeVisible();
    await shoot(page, { 1440: 'admin/refunds/RefundIssuedNoSplit' });
  });

  test('selected items issued', async ({ page }) => {
    await openOrder(page, WITH_REFUNDS);
    await issued(page, { scope: 'Selected items', reason: 'Wrong item', firstLine: true, text: 'Customer received a beef plate instead of chicken.' }, /Refund issued. Sent to the payment provider./);
    await shoot(page, { 1440: 'admin/refunds/RefundItemsIssued' });
  });

  test('goodwill issued', async ({ page }) => {
    await openOrder(page, WITH_REFUNDS);
    await issued(page, { scope: 'Goodwill amount', goodwill: '15.00', text: 'Customer waited 40 minutes past the estimate; offering goodwill.' }, /Refund issued. Sent to the payment provider./);
    await shoot(page, { 1440: 'admin/refunds/RefundGoodwillIssued' });
  });

  test('a disputed order, issued while the dispute is open', async ({ page }) => {
    await openOrder(page, 'order_admin_view_disputed');
    await issued(page, { reason: 'Food quality', text: 'Bag arrived open and the food was cold; customer sent photos to support.' }, /Refund issued. Sent to the payment provider./);
    await shoot(page, { 1440: 'admin/refunds/RefundDisputedIssued' });
  });

  test('a support agent above their limit, sent for approval', async ({ page }) => {
    await openOrder(page, PLAIN, { role: 'SUPPORT_AGENT', issue: fixture('refund_approval_request_pending') });
    await issued(page, WHOLE, /Sent for approval. Nothing has moved yet./);
    await shoot(page, { 1440: 'admin/refunds/RefundApproval' });
  });

  /** A 409 or 429 the contract lists for issuing: `[board, fixture or refusal, text on the panel]`. */
  const REFUSED: ReadonlyArray<readonly [string, (route: Route) => Promise<void>, string]> = [
    ['admin/refunds/RefundConflict', fixture('error_refund_conflict'), 'That’s more than is left to refund'],
    ['admin/refunds/RefundNotRefundable', fixture('error_refund_not_refundable'), 'This payment can’t be refunded right now'],
    ['admin/refunds/RefundRateLimited', fixture('error_rate_limited'), 'Too many money actions in a short time'],
  ];
  for (const [board, answer, text] of REFUSED) {
    test(`refused: ${board.split('/').pop()}`, async ({ page }) => {
      await openOrder(page, PLAIN, { issue: answer });
      await start(page);
      await fill(page, WHOLE);
      await toReview(page);
      await issue(page);
      await expect(page.getByText(text).first()).toBeVisible();
      await shoot(page, { 1440: board });
    });
  }

  test('goodwill above what is left', async ({ page }) => {
    await openOrder(page, WITH_REFUNDS, { issue: fixture('error_refund_goodwill_exceeds') });
    await start(page);
    await fill(page, { scope: 'Goodwill amount', goodwill: '25.00', text: 'Customer waited 40 minutes past the estimate; offering goodwill.' });
    await toReview(page);
    await issue(page);
    await expect(page.getByText('That’s more than is left to refund').first()).toBeVisible();
    await shoot(page, { 1440: 'admin/refunds/RefundGoodwillExceeds' });
  });

  test('the order’s refund rows in every state', async ({ page }) => {
    await openOrder(page, 'order_admin_view_refund_states');
    await shoot(page, { 1440: 'admin/refunds/RefundRowStates' });
  });
});
