import { expect, test, type Page } from '@playwright/test';

import { expectDesign } from './design';
import { E2E_MODE } from './mode';
import type { Json } from './redesign-admin.rider-onboarding.scene';
import {
  approvedCert,
  approvedDocs,
  arrive,
  BLOCKERS,
  capture,
  choose,
  CLAIM_ENDS,
  DOC_ID,
  karahiApp,
  KARAHI,
  kdoc,
  openAt,
  refuse,
  reviewDocs,
  sep,
  type Ctx,
  type Scene,
} from './redesign-admin.verification.scene';

test.skip(E2E_MODE !== 'mock', 'written against the mock server; run with E2E_MODE=mock');

/**
 * The redesigned admin console's application workspace (`#/restaurants/:id`: the application, its
 * documents and the scan in panes, with the decisions in a panel in the scan's place), each state
 * captured for the design board it must match (tools/e2e/README.md, "Design captures"). Mock
 * mode: the calls are answered with `page.route` (see redesign-admin.verification.scene.ts),
 * which is the only way to give the stateless mock a claim held by the signed-in reviewer, an
 * application in a given state, or a decision the server refuses.
 *
 * Boards are drawn at 1440 wide; the two narrow ones (1280 and 720) are taken by resizing the
 * page, so the tablet project takes no capture.
 *
 * What the boards draw that the screen does not, found while writing these captures (the pair will
 * show it as a difference): the applications list strip beside the panes (every board but the not
 * found and the 200 percent zoom), the decision record (who decided, when and why), and the
 * "halal certificate is still in review" notice above a request for changes. Each is a feature the
 * screen's own header comment lists as not built.
 *
 * Board ids are written out in full on purpose: tools/e2e/web/check-boards.mjs validates only
 * literal ids.
 */
const BASE = process.env.E2E_ADMIN_REDESIGN_URL ?? process.env.BASE_URL;
if (BASE) test.use({ baseURL: BASE });

const readyApp = (c: Ctx, over: Json = {}) => karahiApp(c, { documents: approvedDocs(), halal_certificate: approvedCert(c), blockers: [], ...over });

/** The application after a decision: nobody holds it, every document is approved. */
const decidedApp = (c: Ctx, state: string, over: Json = {}) =>
  readyApp(c, { onboarding_state: state, assigned_admin_id: null, review_lock_expires_at: null, ...over });

/** The record the application page keeps asking for, so a review that succeeds shows on the next load. */
interface Live {
  app?: Json;
}

/** Opens the application at `id` and waits for the workspace. */
async function openApp(page: Page, scene: Scene, id: string = KARAHI.id) {
  await arrive(page, scene);
  await openAt(page, `#/restaurants/${id}`);
  await expect(page.getByTestId('ApplicationWorkspace')).toBeVisible();
}

/** Selects the food safety certificate, as every board that draws a review does. */
async function foodSafety(page: Page, version = 1) {
  await page.getByRole('button', { name: new RegExp(`^Review Food safety certificate, version ${version}`) }).click();
  await expect(page.getByTestId('DocumentReview')).toBeVisible();
}

/** Opens the decision panel named by its button and returns it. */
async function openPanel(page: Page, button: string, region: RegExp | string) {
  await page.getByRole('button', { name: button }).click();
  const panel = page.getByRole('region', { name: region });
  await expect(panel).toBeVisible();
  return panel;
}

test.describe('redesigned admin · application workspace (mock)', () => {
  test.use({ colorScheme: 'light' });

  // Every board of the area is drawn at 1440 wide, and the panes a panel squeezes at 1024 are a
  // finding of their own, not this spec's: the desktop project takes the captures.
  test.skip(({ viewport }) => viewport?.width !== 1440, 'the verification boards are drawn at 1440 wide');

  // ── the page itself ─────────────────────────────────────────────────────────

  test('claimed by you, the food safety certificate open', async ({ page }) => {
    await openApp(page, { app: (c) => karahiApp(c) });
    await foodSafety(page);
    await expect(page.getByText('Your claim ends at 2:48 pm')).toBeVisible();
    await capture(page, { 1440: 'admin/restaurant-verification/App' });
  });

  test('loading', async ({ page }) => {
    await arrive(page, { app: 'never' });
    await openAt(page, `#/restaurants/${KARAHI.id}`);
    await expect(page.getByTestId('ApplicationLoading')).toBeVisible();
    await capture(page, { 1440: 'admin/restaurant-verification/App-Loading' }, { settled: false });
  });

  test('not found', async ({ page }) => {
    await arrive(page, { app: 'notfound' });
    await openAt(page, `#/restaurants/${KARAHI.id}`);
    await expect(page.getByText('This application doesn’t exist')).toBeVisible();
    await capture(page, { 1440: 'admin/restaurant-verification/App-NotFound' });
  });

  for (const [width, board] of [
    [1280, 'admin/restaurant-verification/App-1280'],
    [720, 'admin/restaurant-verification/App-Zoom200'],
  ] as const) {
    test(`${width} px`, async ({ page }, info) => {
      test.skip(info.project.metadata.viewport !== 'desktop', 'drawn at its own width: taken once, by the desktop project');
      await page.setViewportSize({ width, height: 900 });
      await openApp(page, { app: (c) => karahiApp(c) });
      await foodSafety(page);
      await page.waitForLoadState('networkidle');
      await expect(page.getByText('Not built yet')).toHaveCount(0);
      await expectDesign(page, board);
    });
  }

  // ── who may do what ─────────────────────────────────────────────────────────

  test('inspecting an application nobody has claimed', async ({ page }) => {
    await openApp(page, { app: (c) => karahiApp(c, { assigned_admin_id: null, review_lock_expires_at: null }) });
    await foodSafety(page);
    await expect(page.getByText('Not claimed · You are inspecting')).toBeVisible();
    await capture(page, { 1440: 'admin/restaurant-verification/App-Inspect' });
  });

  test('claimed by another reviewer', async ({ page }) => {
    await openApp(page, { app: (c) => karahiApp(c, { assigned_admin_id: '5b1f6c2e-8a41-4c0d-9d3a-2f7e8c1b4a60', review_lock_expires_at: sep(28, 14, 32) }) });
    await foodSafety(page);
    await expect(page.getByText(/Another reviewer holds this until 2:32 pm/)).toBeVisible();
    await capture(page, { 1440: 'admin/restaurant-verification/App-ReadOnly' });
  });

  test('a support agent', async ({ page }) => {
    await openApp(page, { role: 'SUPPORT_AGENT', app: (c) => karahiApp(c) });
    await expect(page.getByText('Read-only for support')).toBeVisible();
    await capture(page, { 1440: 'admin/restaurant-verification/App-Support' });
  });

  // ── the application's state ─────────────────────────────────────────────────

  test('nothing stops approval', async ({ page }) => {
    await openApp(page, { app: (c) => readyApp(c) });
    await foodSafety(page);
    await expect(page.getByText('Nothing stops approval')).toBeVisible();
    await capture(page, { 1440: 'admin/restaurant-verification/App-Ready' });
  });

  test('approved, payout pending', async ({ page }) => {
    await openApp(page, { app: (c) => decidedApp(c, 'PAYOUT_PENDING') });
    await expect(page.getByTestId('DecisionRecord')).toBeVisible();
    await capture(page, { 1440: 'admin/restaurant-verification/App-Decided' });
  });

  test('changes requested, waiting on the restaurant', async ({ page }) => {
    await openApp(page, { app: (c) => changesRequested(c) });
    await expect(page.getByText('Changes requested. It returns to the queue when they resubmit.')).toBeVisible();
    await capture(page, { 1440: 'admin/restaurant-verification/App-ChangesRequested' });
  });

  test('withdrawn', async ({ page }) => {
    await openApp(page, { app: (c) => karahiApp(c, { onboarding_state: 'WITHDRAWN', assigned_admin_id: null, review_lock_expires_at: null }) });
    await expect(page.getByText('The restaurant withdrew this application.')).toBeVisible();
    await capture(page, { 1440: 'admin/restaurant-verification/App-Withdrawn' });
  });

  test('no halal certificate record', async ({ page }) => {
    await openApp(page, { app: (c) => noCertificate(c) });
    await foodSafety(page);
    await expect(page.getByText('No halal certificate record')).toBeVisible();
    await capture(page, { 1440: 'admin/restaurant-verification/App-NoCertificate' });
  });

  test('the halal certificate row routes to the console', async ({ page }) => {
    await openApp(page, { app: (c) => karahiApp(c) });
    await page.getByRole('button', { name: /^Open Halal certificate, version 1/ }).click();
    await expect(page.getByText('Verified in the halal console, not here.')).toBeVisible();
    await capture(page, { 1440: 'admin/restaurant-verification/App-HalalRow' });
  });

  test('after the halal certificate was rejected', async ({ page }) => {
    await openApp(page, { app: (c) => halalRejected(c) });
    await page.getByRole('button', { name: /^Open Halal certificate, version 1/ }).click();
    await expect(page.getByText('Verified in the halal console, not here.')).toBeVisible();
    await capture(page, { 1440: 'admin/restaurant-verification/App-HalalRejected' });
  });

  test('every document state', async ({ page }) => {
    await openApp(page, { app: (c) => docStates(c) });
    await foodSafety(page, 2);
    await capture(page, { 1440: 'admin/restaurant-verification/App-DocStates' });
  });

  // ── documents ───────────────────────────────────────────────────────────────

  test('a document approved', async ({ page }) => {
    const live: Live = {};
    await openApp(page, {
      app: (c) => live.app ?? (live.app = karahiApp(c)),
      review: async (route) => {
        const id = /restaurant-documents\/([^/]+)\/review/.exec(route.request().url())?.[1];
        const found = (live.app!.documents as Json[]).find((d) => d.id === id)!;
        found.state = 'APPROVED';
        found.reviewed_at = sep(28, 14, 6);
        live.app!.blockers = ['No approved halal certificate'];
        return route.fulfill({ json: { data: found } });
      },
    });
    await foodSafety(page);
    const review = page.getByTestId('DocumentReview');
    for (const label of ['Issuing health unit present', 'Premises address matches', 'Expiry at least 14 days away', 'Holder name matches']) {
      await review.getByRole('radiogroup', { name: label }).getByRole('radio', { name: 'Pass' }).check();
    }
    await review.getByRole('button', { name: 'Approve document' }).click();
    await expect(page.getByText('Food safety certificate approved')).toBeVisible();
    await page.getByRole('button', { name: /^Open Halal certificate, version 1/ }).click();
    await capture(page, { 1440: 'admin/restaurant-verification/App-Success' });
  });

  test('reject a document', async ({ page }) => {
    await openApp(page, { app: (c) => karahiApp(c) });
    await foodSafety(page);
    const review = page.getByTestId('DocumentReview');
    for (const label of ['Issuing health unit present', 'Expiry at least 14 days away', 'Holder name matches']) {
      await review.getByRole('radiogroup', { name: label }).getByRole('radio', { name: 'Pass' }).check();
    }
    await review.getByRole('radiogroup', { name: 'Premises address matches' }).getByRole('radio', { name: 'Fail' }).check();
    const panel = await openPanel(page, 'Reject document…', /^Reject the food safety certificate/);
    await panel.getByLabel(/^Note to the restaurant/).fill('The certificate is for your previous address on Midland Avenue. Please upload the one for 3025 Kennedy Rd.');
    await capture(page, { 1440: 'admin/restaurant-verification/App-DocReject' });
  });

  // ── the decision panels ─────────────────────────────────────────────────────

  test('approve', async ({ page }) => {
    await openApp(page, { app: (c) => readyApp(c) });
    await openPanel(page, 'Approve…', 'Approve Karahi House?');
    await capture(page, { 1440: 'admin/restaurant-verification/App-Approve' });
  });

  test('approve, sending', async ({ page }) => {
    await openApp(page, { app: (c) => readyApp(c), decide: () => new Promise<void>(() => undefined) });
    const panel = await openPanel(page, 'Approve…', 'Approve Karahi House?');
    const asked = page.waitForRequest((request) => request.url().endsWith('/decision'));
    await panel.getByRole('button', { name: 'Approve application' }).click();
    await asked;
    await capture(page, { 1440: 'admin/restaurant-verification/App-Approve-Submitting' }, { settled: false });
  });

  test('reject', async ({ page }) => {
    await openApp(page, { app: (c) => karahiApp(c) });
    await openPanel(page, 'Reject…', /^Reject Karahi House/);
    await capture(page, { 1440: 'admin/restaurant-verification/App-Reject' });
  });

  test('reject, not sent', async ({ page }) => {
    await openApp(page, { app: (c) => karahiApp(c), decide: (route) => route.abort('internetdisconnected') });
    const panel = await openPanel(page, 'Reject…', /^Reject Karahi House/);
    await choose(page, 'Reason', 'Documents not sufficient');
    await panel
      .getByLabel(/^Message to the restaurant/)
      .fill('Your documents don’t show a food premises licence for 3025 Kennedy Rd. You can apply again once you have one.');
    await panel.getByRole('button', { name: 'Reject application' }).click();
    await expect(panel.getByText('The rejection wasn’t sent')).toBeVisible();
    await capture(page, { 1440: 'admin/restaurant-verification/App-Reject-Offline' });
  });

  test('request changes', async ({ page }) => {
    await openApp(page, { app: (c) => karahiApp(c) });
    const panel = await openPanel(page, 'Request changes…', /^Request changes from Karahi House/);
    await panel.getByRole('checkbox', { name: 'Food safety certificate' }).check();
    await choose(page, 'Reason', 'Documents not sufficient');
    await panel
      .getByLabel(/^Message to the restaurant/)
      .fill('Please upload the food safety certificate for 3025 Kennedy Rd. The one you sent is for a different address.');
    await panel.getByLabel(/^Internal note/).fill('Owner said on the phone they moved in August. Business licence already shows the new address.');
    await capture(page, { 1440: 'admin/restaurant-verification/App-Decision' });
  });

  test('request changes, fields to fix', async ({ page }) => {
    await openApp(page, { app: (c) => karahiApp(c) });
    const panel = await openPanel(page, 'Request changes…', /^Request changes from Karahi House/);
    await panel.getByRole('button', { name: 'Send request for changes' }).click();
    await expect(panel.getByText('The request wasn’t sent: 3 things to fix')).toBeVisible();
    await capture(page, { 1440: 'admin/restaurant-verification/App-Decision-Invalid' });
  });

  test('request changes from the halal rejection', async ({ page }) => {
    await openApp(page, { app: (c) => halalRejected(c) });
    const panel = await openPanel(page, 'Request changes…', /^Request changes from Karahi House/);
    await expect(panel.getByText('Halal certificate is ticked because you rejected it')).toBeVisible();
    await capture(page, { 1440: 'admin/restaurant-verification/App-HalalRedo' });
  });

  test('request changes with no certificate record', async ({ page }) => {
    await openApp(page, { app: (c) => noCertificate(c) });
    const panel = await openPanel(page, 'Request changes…', /^Request changes from Karahi House/);
    await expect(panel.getByText('Halal certificate is ticked because none was uploaded')).toBeVisible();
    await capture(page, { 1440: 'admin/restaurant-verification/App-NoCertRequest' });
  });

  // ── what the server refuses ─────────────────────────────────────────────────

  /**
   * Presses Approve application on an application the page thinks is ready, with the server
   * answering `refusal` and the next load answering `refreshed`. With `now`, the page is open
   * with the claim live for another two minutes.
   */
  async function approveRefused(page: Page, refusal: [status: number, code: string, message: string, details?: unknown], refreshed: (c: Ctx) => Json, now?: string) {
    const live: Live = {};
    await openApp(page, {
      ...(now ? { now } : {}),
      app: (c) => live.app ?? (live.app = readyApp(c, now ? { review_lock_expires_at: sep(28, 15, 0) } : {})),
      decide: async (route, c) => {
        live.app = refreshed(c);
        await refuse(route, ...refusal);
      },
    });
    const panel = await openPanel(page, 'Approve…', 'Approve Karahi House?');
    await panel.getByRole('button', { name: 'Approve application' }).click();
  }

  test('approval refused: two things stop it', async ({ page }) => {
    await approveRefused(page, [409, 'PRECONDITION_NOT_MET', 'The application is not yet approvable.', { blockers: BLOCKERS }], (c) => karahiApp(c));
    await expect(page.getByText('Not approved: 2 things stop approval')).toBeVisible();
    await capture(page, { 1440: 'admin/restaurant-verification/App-Blocked' });
  });

  test('decision refused: already decided', async ({ page }) => {
    await approveRefused(page, [409, 'ALREADY_DECIDED', 'The application is already decided.'], (c) => decidedApp(c, 'PAYOUT_PENDING'));
    await expect(page.getByText('Already decided').first()).toBeVisible();
    await capture(page, { 1440: 'admin/restaurant-verification/App-Blocked-Decided' });
  });

  test('decision refused: your claim ended', async ({ page }) => {
    // Ten minutes past the claim's end, 2:58 pm; the page was opened with the claim still live.
    await approveRefused(
      page,
      [409, 'REVIEW_LOCK_LOST', 'Your review lock expired and another admin has this application.'],
      (c) => readyApp(c, { review_lock_expires_at: CLAIM_ENDS }),
      sep(28, 14, 58),
    );
    await expect(page.getByText('Your claim ended').first()).toBeVisible();
    await capture(page, { 1440: 'admin/restaurant-verification/App-Blocked-ClaimLost' });
  });
});

// ── the records ──────────────────────────────────────────────────────────────

/** Sent back to the restaurant: the food safety certificate was rejected, nobody holds the application. */
function changesRequested(c: Ctx): Json {
  return karahiApp(c, {
    onboarding_state: 'DOCUMENTS_REJECTED',
    assigned_admin_id: null,
    review_lock_expires_at: null,
    documents: reviewDocs().map((d) => (d.doc_type === 'FOOD_SAFETY' ? { ...d, state: 'REJECTED', rejection_reason_code: 'ADDRESS_MISMATCH', reviewed_at: sep(27, 15, 10) } : d)),
  });
}

/** An application with no halal certificate record: no document, no certificate. */
function noCertificate(c: Ctx): Json {
  return karahiApp(c, {
    documents: reviewDocs().filter((d) => d.doc_type !== 'HALAL_CERTIFICATE'),
    halal_certificate: null,
    blockers: ['Required document not approved: FOOD_SAFETY', 'No approved halal certificate'],
  });
}

/** The halal certificate was rejected; the rest of the application is as it was. */
function halalRejected(c: Ctx): Json {
  return karahiApp(c, {
    documents: reviewDocs().map((d) => (d.doc_type === 'HALAL_CERTIFICATE' ? { ...d, state: 'REJECTED', rejection_reason_code: 'OTHER', reviewed_at: sep(28, 14, 1) } : d)),
    halal_certificate: approvedCert(c, { status: 'REJECTED', rejection_reason_code: 'SCOPE_INSUFFICIENT', rejection_reason_text: 'The certificate covers your meat supplier only.' }),
    blockers: ['No approved halal certificate'],
  });
}

/** The documents the "every document state" board draws: two versions of two types, one expired, one optional. */
function docStates(c: Ctx): Json {
  const docs = [
    kdoc('BUSINESS_LICENCE', 'APPROVED', { valid_until: null }),
    kdoc('HALAL_CERTIFICATE', 'IN_REVIEW', { valid_until: '2027-01-14', certificate_number: 'HMA-ON-2026-0417', issuer: 'Halal Monitoring Authority (HMA Canada)' }),
    kdoc('FOOD_SAFETY', 'IN_REVIEW', { id: 'd0c00000-0000-4000-8000-000000000013', version: 2, valid_until: null }),
    kdoc('FOOD_SAFETY', 'SUPERSEDED', { id: DOC_ID.FOOD_SAFETY, version: 1, valid_until: '2026-03-02' }),
    kdoc('OWNER_ID', 'SUBMITTED', { id: 'd0c00000-0000-4000-8000-000000000014', version: 2, valid_until: null }),
    kdoc('OWNER_ID', 'REJECTED', { id: DOC_ID.OWNER_ID, version: 1, valid_until: '2029-06-09', rejection_reason_code: 'ILLEGIBLE' }),
    kdoc('LIABILITY_INSURANCE', 'EXPIRED', { valid_until: '2026-08-30' }),
  ];
  return karahiApp(c, {
    documents: docs,
    blockers: ['Required document not approved: FOOD_SAFETY', 'Required document not approved: OWNER_ID', 'No approved halal certificate', 'HALAL_ISSUER_UNDER_REVIEW'],
    address_pin_warning: 'The address has no map coordinates.',
  });
}
