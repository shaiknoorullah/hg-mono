import { expect, test, type Page } from '@playwright/test';

import { expectDesignFor, type BoardFor } from './design';
import { projectMeta } from './mode';
import {
  STATUS,
  choose,
  details,
  never,
  only,
  open,
  problem,
  save,
  serve,
  without,
  type Road,
  type Scene,
} from './redesign-restaurant.onboarding.scene';
import { MODE, documentScrolls, openSignedIn, restaurantPrincipal, scenarioPayload as fixture, torontoDateIn as torontoDate } from './redesign-restaurant.support';

test.skip(MODE !== 'mock', 'written against the mock server; run with E2E_MODE=mock');

/**
 * The redesigned restaurant console's Onboarding area, captured for the design board each state must
 * match (tools/e2e/README.md, "Design captures"). The area holds 139 boards
 * (`canvases/restaurant/onboarding/project/canvas.json` on `origin/claude/redesign-canvases`). This
 * file accounts for the 135 that `redesign-restaurant.onboarding.spec.ts` does not (that spec
 * captures `Docs-None`, `Docs-LoadError`, `App-NotApproved` and `Tab-AppNotApproved-1024`).
 *
 * Mock mode: every state is served with `page.route` from the mock's own fixtures. The packs of
 * documents are the `restaurant_document_pack_*` fixtures; the nine this file needs that did not exist
 * (a pack sent and waiting, partly approved, a halal certificate that expired while waiting, and the
 * rejections) were added with it ([#850](https://github.com/shaiknoorullah/hg-mono/issues/850)). The
 * upload road (create, the PUT to the presigned address, confirm, attach, submit) is walked for real,
 * as `redesign-restaurant.documents-upload.spec.ts` does.
 *
 * Sorted before it was written:
 *   - Captured and paired with a board, at the width the board is drawn for: 1440, 1024 where a
 *     `Tab-*` board shows the same state, and 320 where a `Reflow-*` board does.
 *   - Declared unpairable, each with its reason: the parts and specimens the page boards are made of,
 *     the boards that draw several rows in several error states at once, and the boards whose state
 *     the app cannot reach ([#1046](https://github.com/shaiknoorullah/hg-mono/issues/1046): screens not
 *     built; [#848](https://github.com/shaiknoorullah/hg-mono/issues/848): contract operations and fields
 *     that do not exist; [#849](https://github.com/shaiknoorullah/hg-mono/issues/849): the cuisine list).
 *   - Left out, and why: three states that need a push this spec does not drive. `Review-Stale` and
 *     `Payout-Stale` need the realtime socket to drop while the page is open, and `Payout-ContinueError`
 *     needs the re-read after Continue to reject (the page's reads keep what they have and go stale
 *     instead, so whether the board's state can happen is not settled).
 *
 * Sample data: the boards draw a sample restaurant ("Karachi Kitchen", "HMA Canada", file names such
 * as `business-licence-2026.pdf`); the fixtures draw the same restaurant with their own dates and the
 * file names this spec chooses. A first-visit profile, an upload at 64 per cent and a document list
 * with one row in each state cannot be had from a fixture, so those captures differ from their board
 * in content as well as in layout ([#961](https://github.com/shaiknoorullah/hg-mono/issues/961)).
 * Tablet and phone boards are taller than the viewport; the console scrolls inside its frame, so a
 * capture shows one screen where the board shows the whole page.
 *
 * Board ids are written out in full on purpose: tools/e2e/web/check-boards.mjs validates only
 * literal ids.
 */

/** The widths a board is drawn for, from the declaration. */
const widthsOf = (b: BoardFor): number[] => (typeof b === 'string' ? [1440] : Object.keys(b).map(Number));

async function settled(page: Page, board: BoardFor) {
  const m = await documentScrolls(page);
  // Recorded, not asserted: whether a layout reflows is the diff's finding, not a reason to lose the capture.
  if (m.scrollWidth > m.innerWidth) {
    test.info().annotations.push({ type: 'overflow', description: `the page is ${m.scrollWidth} wide in a ${m.innerWidth} viewport` });
  }
  await expectDesignFor(page, board);
}

// ── The states ───────────────────────────────────────────────────────────────────────────────

interface Case {
  name: string;
  boards: BoardFor;
  run: (page: Page) => Promise<void>;
}

const frame: Case[] = [
  {
    name: 'setup, loading',
    boards: 'restaurant/onboarding/Onb-Loading',
    run: async (page) => {
      await open(page, '/onboarding', { status: 'never' });
      await expect(page.getByTestId('onboarding-loading')).toBeVisible();
    },
  },
  {
    name: 'setup, does not load',
    boards: 'restaurant/onboarding/Onb-LoadError',
    run: async (page) => {
      await open(page, '/onboarding', { status: { status: 500 } });
      await expect(page.getByTestId('onboarding-load-error')).toBeVisible();
    },
  },
  {
    name: 'setup, a step this build does not know',
    boards: 'restaurant/onboarding/Onb-UnknownStep',
    run: async (page) => {
      await open(page, '/onboarding', { status: STATUS.documents, statusPatch: (s) => ({ ...s, current_step: 'A_STEP_FROM_THE_FUTURE' }) });
      await expect(page.getByTestId('unknown-step')).toBeVisible();
    },
  },
];

const profileScene: Scene = { status: STATUS.profile };
const profilePage = '/onboarding/profile';

async function putProfile(page: Page, how: 'never' | 'abort' | { status: number; code: string; details?: unknown[] }) {
  const profile = await fixture(page, 'restaurant_profile_account_pending');
  await page.route('**/v1/restaurant/profile', (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { data: profile } });
    if (how === 'never') return never();
    if (how === 'abort') return route.abort();
    return route.fulfill(problem(how.status, how.code, how.details));
  });
}

const saveAndContinue = (page: Page) => page.getByRole('button', { name: /^Save and continue/ });

const profile: Case[] = [
  {
    name: 'profile, first visit',
    boards: 'restaurant/onboarding/Profile-Empty',
    run: async (page) => {
      await open(page, profilePage, profileScene);
      await expect(page.getByTestId('profile-screen')).toBeVisible();
    },
  },
  {
    name: 'profile, loading',
    boards: 'restaurant/onboarding/Profile-Loading',
    run: async (page) => {
      await open(page, profilePage, { ...profileScene, profile: 'never' });
      await expect(page.getByText('Loading your profile…')).toBeVisible();
    },
  },
  {
    name: 'profile, does not load',
    boards: 'restaurant/onboarding/Profile-LoadError',
    run: async (page) => {
      await open(page, profilePage, { ...profileScene, profile: { status: 500 } });
      await expect(page.getByText('We couldn’t load your profile')).toBeVisible();
    },
  },
  {
    name: 'profile, saving',
    boards: 'restaurant/onboarding/Profile-Saving',
    run: async (page) => {
      await open(page, profilePage, profileScene);
      await putProfile(page, 'never');
      const put = page.waitForRequest((r) => r.method() === 'PUT' && /\/v1\/restaurant\/profile$/.test(r.url()));
      await saveAndContinue(page).click();
      await put;
    },
  },
  {
    name: 'profile, a field the server refuses',
    boards: 'restaurant/onboarding/Profile-Errors',
    run: async (page) => {
      await open(page, profilePage, profileScene);
      await putProfile(page, {
        status: 422,
        code: 'VALIDATION_FAILED',
        details: [
          { field: 'phone_e164', code: 'invalid', message: 'Enter a Canadian phone number.' },
          { field: 'postal_code', code: 'PROVINCE_NOT_SERVED', message: 'Outside the area we serve.' },
        ],
      });
      await saveAndContinue(page).click();
      await expect(page.getByTestId('profile-errors')).toBeVisible();
    },
  },
  {
    name: 'profile, the save did not arrive',
    boards: 'restaurant/onboarding/Profile-SaveError',
    run: async (page) => {
      await open(page, profilePage, profileScene);
      await putProfile(page, 'abort');
      await saveAndContinue(page).click();
      await expect(page.getByTestId('profile-save-error')).toBeVisible();
    },
  },
  {
    name: 'profile, setup moved on while the page was open',
    boards: 'restaurant/onboarding/Profile-Conflict',
    run: async (page) => {
      await open(page, profilePage, profileScene);
      await putProfile(page, { status: 409, code: 'STEP_NOT_AVAILABLE' });
      await saveAndContinue(page).click();
      await expect(page.getByTestId('profile-conflict')).toBeVisible();
    },
  },
  {
    name: 'profile, coming back to a draft kept in this tab',
    boards: 'restaurant/onboarding/Profile-Returning',
    run: async (page) => {
      const restaurantId = (await restaurantPrincipal(page)).roles[0].scope_id;
      await page.addInitScript(
        ([key, value]) => window.sessionStorage.setItem(key!, value!),
        [
          `hg_restaurant_profile_draft_v2:${restaurantId}`,
          JSON.stringify({ savedAt: new Date().toISOString(), values: { display_name: 'Karachi Kitchen', legal_name: 'Karachi Kitchen Inc.' } }),
        ],
      );
      await open(page, profilePage, profileScene);
      await expect(page.getByTestId('profile-returning')).toBeVisible();
    },
  },
];

const docsScene: Scene = { status: STATUS.documents };
const docsPage = '/onboarding/documents';
const READY = 'restaurant_document_pack_ready';

/** The documents step with row 1 (the halal certificate) holding a file whose details are still to fill. */
async function halalDetails(page: Page, r: Road) {
  await open(page, docsPage, docsScene, r);
  await expect(page.getByTestId('document-workspace')).toBeVisible();
  await choose(page, 'halal-certificate-hma.pdf');
  await expect(details(page, 'halal certificate')).toBeVisible();
}

const documents: Case[] = [
  {
    name: 'documents, loading',
    boards: 'restaurant/onboarding/Docs-Loading',
    run: async (page) => {
      await open(page, docsPage, { ...docsScene, docs: 'never' });
      await expect(page.getByText('Loading your documents…')).toBeVisible();
    },
  },
  {
    name: 'documents, four of four ready to send',
    boards: { 1440: 'restaurant/onboarding/Docs-Ready', 1024: 'restaurant/onboarding/Tab-Docs-1024' },
    run: async (page) => {
      await open(page, docsPage, { ...docsScene, docs: READY });
      await expect(page.getByTestId('send-footer')).toBeVisible();
    },
  },
  {
    name: 'documents, a file uploading beside one waiting for its details',
    boards: { 1440: 'restaurant/onboarding/Docs-Uploading', 320: 'restaurant/onboarding/Reflow-Docs-320' },
    run: async (page) => {
      await halalDetails(page, { pack: READY, filter: only('BUSINESS_LICENCE'), put: 'first-ok' });
      await page.locator('#row-food-safety').click();
      await choose(page, 'food-handler-certificate.jpg');
      await expect(page.getByTestId('upload-progress')).toBeVisible();
    },
  },
  {
    name: 'documents, an upload cancelled',
    boards: 'restaurant/onboarding/Docs-UploadCancelled',
    run: async (page) => {
      await halalDetails(page, { pack: READY, filter: only('BUSINESS_LICENCE'), put: 'first-ok' });
      await page.locator('#row-food-safety').click();
      await choose(page, 'food-handler-certificate.jpg');
      await expect(page.getByTestId('upload-progress')).toBeVisible();
      await page.getByRole('button', { name: 'Cancel upload of food safety certificate' }).click();
      await expect(page.getByTestId('upload-cancelled')).toBeVisible();
    },
  },
  {
    name: 'documents, the download link expired',
    boards: 'restaurant/onboarding/Docs-ViewError',
    run: async (page) => {
      await open(page, docsPage, { ...docsScene, docs: READY });
      await page.route('**/v1/documents/*/download-url', (route) => route.fulfill(problem(500, 'INTERNAL_ERROR')));
      await page.locator('#row-halal-certificate').click();
      await page.getByRole('button', { name: /^Download file: halal certificate/ }).click();
      await expect(page.getByTestId('download-error')).toBeVisible();
    },
  },
  {
    name: 'documents, the file is no longer available',
    boards: 'restaurant/onboarding/Docs-DownloadGone',
    run: async (page) => {
      await open(page, docsPage, { ...docsScene, docs: READY });
      await page.route('**/v1/documents/*/download-url', (route) => route.fulfill(problem(404, 'NOT_FOUND')));
      await page.locator('#row-halal-certificate').click();
      await page.getByRole('button', { name: /^Download file: halal certificate/ }).click();
      await expect(page.getByTestId('download-error')).toBeVisible();
    },
  },
  {
    name: 'documents, the pack is incomplete (422)',
    boards: 'restaurant/onboarding/Docs-Incomplete',
    run: async (page) => {
      const refusal = await fixture(page, 'error_documents_incomplete');
      await open(page, docsPage, docsScene, { pack: READY, filter: without('OWNER_ID'), submit: { status: 422, code: refusal.error.code, details: refusal.error.details } });
      await page.getByRole('button', { name: 'Send for review' }).click();
      await expect(page.getByTestId('incomplete-alert')).toBeVisible();
    },
  },
  {
    name: 'documents, sending failed (network or 5xx)',
    boards: 'restaurant/onboarding/Docs-SendError',
    run: async (page) => {
      await open(page, docsPage, docsScene, { pack: READY, submit: { status: 500, code: 'INTERNAL_ERROR' } });
      await page.getByRole('button', { name: 'Send for review' }).click();
      await expect(page.getByTestId('send-error')).toBeVisible();
    },
  },
  {
    name: 'documents, locked for review (409)',
    boards: 'restaurant/onboarding/Docs-Locked',
    run: async (page) => {
      await open(page, docsPage, docsScene, { pack: READY, submit: { status: 409, code: 'STEP_NOT_AVAILABLE' } });
      await page.getByRole('button', { name: 'Send for review' }).click();
      await expect(page.getByTestId('step-locked')).toBeVisible();
    },
  },
];

const reviewScene: Scene = { status: STATUS.review };
const reviewPage = '/onboarding/review';
const waitingRegion = (page: Page) => page.getByRole('region', { name: 'Review status' });

const review: Case[] = [
  {
    name: 'review, in review',
    boards: { 1440: 'restaurant/onboarding/Review-InReview', 1024: 'restaurant/onboarding/Tab-Review-1024' },
    run: async (page) => {
      // The tablet board draws 40 % done where the fixture says 60: the server's number, patched here.
      await open(page, reviewPage, { ...reviewScene, statusPatch: (s) => ({ ...s, progress_percent: 40 }), docs: 'restaurant_document_pack_in_review' });
      await expect(waitingRegion(page)).toBeVisible();
    },
  },
  {
    name: 'review, round 2, approved documents not sent again',
    boards: 'restaurant/onboarding/Review-Round2',
    run: async (page) => {
      await open(page, reviewPage, { ...reviewScene, statusPatch: (s) => ({ ...s, review_cycle: 2 }), docs: 'restaurant_document_pack_partly_approved' });
      await expect(waitingRegion(page)).toBeVisible();
    },
  },
  {
    name: 'review, some approved',
    boards: 'restaurant/onboarding/Review-Partial',
    run: async (page) => {
      await open(page, reviewPage, { ...reviewScene, docs: 'restaurant_document_pack_partly_approved' });
      await expect(waitingRegion(page)).toBeVisible();
    },
  },
  {
    name: 'review, the halal certificate expired while waiting',
    boards: 'restaurant/onboarding/Review-Expired',
    run: async (page) => {
      await open(page, reviewPage, { ...reviewScene, profile: 'restaurant_profile_halal_expired', docs: 'restaurant_document_pack_halal_expired' });
      await expect(page.getByTestId('expired-block')).toBeVisible();
    },
  },
  {
    name: 'review, the food safety certificate expired while waiting',
    boards: 'restaurant/onboarding/Review-Expired-FoodSafety',
    run: async (page) => {
      await open(page, reviewPage, { ...reviewScene, profile: 'restaurant_profile_halal_certified', docs: 'restaurant_document_pack_food_safety_expired' });
      await expect(page.getByTestId('expired-block')).toBeVisible();
    },
  },
  {
    name: 'review, the renewed certificate, details to fill',
    boards: 'restaurant/onboarding/Review-ExpiredDetails',
    run: async (page) => {
      await open(page, reviewPage, { ...reviewScene, profile: 'restaurant_profile_halal_expired' }, { pack: 'restaurant_document_pack_halal_expired' });
      await choose(page, 'halal-certificate-hma-2027.pdf');
      await expect(details(page, 'halal certificate')).toBeVisible();
    },
  },
  {
    name: 'review, the renewed certificate, the date has passed',
    boards: 'restaurant/onboarding/Review-ExpiredDetailsError',
    run: async (page) => {
      await open(page, reviewPage, { ...reviewScene, profile: 'restaurant_profile_halal_expired' }, { pack: 'restaurant_document_pack_halal_expired' });
      await choose(page, 'halal-certificate-hma-2027.pdf');
      await page.locator('#halal-certificate-valid').fill('2020-01-31');
      await save(page).click();
      await expect(page.getByTestId('draft-error')).toBeVisible();
    },
  },
  {
    name: 'review, everything approved, on to payout',
    boards: 'restaurant/onboarding/Review-AllApproved',
    run: async (page) => {
      await open(page, reviewPage, { status: STATUS.approved, docs: 'restaurant_document_pack_complete' });
      await expect(page.getByRole('region', { name: 'Next step' })).toBeVisible();
    },
  },
  {
    name: 'review, loading',
    boards: 'restaurant/onboarding/Review-Loading',
    run: async (page) => {
      await open(page, reviewPage, { ...reviewScene, docs: 'never' });
      await expect(page.getByText('Loading your documents…')).toBeVisible();
    },
  },
  {
    name: 'review, does not load',
    boards: 'restaurant/onboarding/Review-LoadError',
    run: async (page) => {
      await open(page, reviewPage, { ...reviewScene, docs: { status: 500 } });
      await expect(page.getByText('We couldn’t load your documents')).toBeVisible();
    },
  },
];

const fixScene: Scene = { status: STATUS.fix };
const fixPage = '/onboarding/fix';
const rejection = (page: Page) => page.getByTestId('rejection-block');
const HALAL_REJECTED = 'restaurant_document_pack_halal_rejected';

/** Fix documents with the halal certificate rejected and its replacement chosen. */
async function halalReplacement(page: Page, r: Partial<Road> = {}) {
  await open(page, fixPage, fixScene, { pack: HALAL_REJECTED, ...r });
  await expect(rejection(page)).toBeVisible();
  await choose(page, 'halal-certificate-hma-2027.pdf');
}

const fix: Case[] = [
  {
    name: 'fix, the halal certificate needs a new upload',
    boards: { 1440: 'restaurant/onboarding/Fix-Rejected', 320: 'restaurant/onboarding/Reflow-Fix-320' },
    run: async (page) => {
      await open(page, fixPage, { ...fixScene, docs: HALAL_REJECTED });
      await expect(rejection(page)).toBeVisible();
    },
  },
  {
    name: 'fix, two documents need a new upload',
    boards: { 1440: 'restaurant/onboarding/Fix-Multi', 1024: 'restaurant/onboarding/Tab-Fix-1024' },
    run: async (page) => {
      await open(page, fixPage, { ...fixScene, docs: 'restaurant_document_pack_two_rejected' });
      await expect(rejection(page)).toBeVisible();
    },
  },
  {
    name: 'fix, one of two replaced',
    boards: 'restaurant/onboarding/Fix-MultiOneReplaced',
    run: async (page) => {
      await open(page, fixPage, fixScene, { pack: 'restaurant_document_pack_two_rejected' });
      await expect(rejection(page)).toBeVisible();
      await choose(page, 'food-handler-certificate-2027.pdf');
      await page.locator('#food-safety-valid').fill(torontoDate(365));
      await save(page).click();
      await expect(page.getByTestId('fix-footer-pending')).toBeVisible();
    },
  },
  {
    name: 'fix, the certificate could not be verified',
    boards: 'restaurant/onboarding/Fix-Integrity',
    run: async (page) => {
      await open(page, fixPage, { ...fixScene, docs: 'restaurant_document_pack_halal_forgery' });
      await expect(rejection(page)).toBeVisible();
    },
  },
  {
    name: 'fix, the certificate is held by another restaurant',
    boards: 'restaurant/onboarding/Fix-Duplicate',
    run: async (page) => {
      await open(page, fixPage, { ...fixScene, docs: 'restaurant_document_pack_halal_duplicate' });
      await expect(rejection(page)).toBeVisible();
    },
  },
  {
    name: 'fix, the replacement uploading',
    boards: 'restaurant/onboarding/Fix-Uploading',
    run: async (page) => {
      await halalReplacement(page, { put: 'never' });
      await expect(page.getByTestId('upload-progress')).toBeVisible();
    },
  },
  {
    name: 'fix, the replacement, details to fill',
    boards: 'restaurant/onboarding/Fix-Details',
    run: async (page) => {
      await halalReplacement(page);
      await expect(details(page, 'halal certificate')).toBeVisible();
    },
  },
  {
    name: 'fix, the replacement, the date has passed',
    boards: 'restaurant/onboarding/Fix-DetailsError',
    run: async (page) => {
      await halalReplacement(page);
      await page.locator('#halal-certificate-valid').fill('2020-01-31');
      await save(page).click();
      await expect(page.getByTestId('draft-error')).toBeVisible();
    },
  },
  {
    name: 'fix, the replacement added, send again',
    boards: 'restaurant/onboarding/Fix-Replaced',
    run: async (page) => {
      await halalReplacement(page);
      await page.locator('#halal-certificate-valid').fill(torontoDate(730));
      await save(page).click();
      await expect(page.getByTestId('fix-footer-ready')).toBeVisible();
    },
  },
  {
    name: 'fix, sending again',
    boards: 'restaurant/onboarding/Fix-Sending',
    run: async (page) => {
      await halalReplacement(page, { submit: 'never' });
      await page.locator('#halal-certificate-valid').fill(torontoDate(730));
      await save(page).click();
      await expect(page.getByTestId('fix-footer-ready')).toBeVisible();
      const submit = page.waitForRequest((r) => r.method() === 'POST' && /\/documents\/submit$/.test(r.url()));
      await page.getByRole('button', { name: 'Send for review again' }).click();
      await submit;
    },
  },
  {
    name: 'fix, sending again is refused (422)',
    boards: 'restaurant/onboarding/Fix-SendFailed',
    run: async (page) => {
      await halalReplacement(page, { submit: { status: 422, code: 'VALIDATION_FAILED' } });
      await page.locator('#halal-certificate-valid').fill(torontoDate(730));
      await save(page).click();
      await page.getByRole('button', { name: 'Send for review again' }).click();
      await expect(page.getByTestId('send-error')).toBeVisible();
    },
  },
  {
    name: 'fix, sending again failed (network or 5xx)',
    boards: 'restaurant/onboarding/Fix-SendNetError',
    run: async (page) => {
      await halalReplacement(page, { submit: { status: 500, code: 'INTERNAL_ERROR' } });
      await page.locator('#halal-certificate-valid').fill(torontoDate(730));
      await save(page).click();
      await page.getByRole('button', { name: 'Send for review again' }).click();
      await expect(page.getByTestId('send-error')).toBeVisible();
    },
  },
];

const payoutScene: Scene = { status: STATUS.payout };
const payoutPage = '/onboarding/payout';
const setUp = (page: Page) => page.getByRole('button', { name: 'Set up payouts with Stripe' });

const payout: Case[] = [
  {
    name: 'payout, not started',
    boards: 'restaurant/onboarding/Payout-NotStarted',
    run: async (page) => {
      await open(page, payoutPage, { ...payoutScene, connect: 'connect_status_not_started' });
      await expect(setUp(page)).toBeVisible();
    },
  },
  {
    name: 'payout, creating the Stripe account',
    boards: 'restaurant/onboarding/Payout-Creating',
    run: async (page) => {
      await open(page, payoutPage, { ...payoutScene, connect: 'connect_status_not_started' });
      await page.route('**/v1/connect/account', never);
      const created = page.waitForRequest((r) => r.method() === 'POST' && /\/v1\/connect\/account$/.test(r.url()));
      await setUp(page).click();
      await created;
    },
  },
  {
    name: 'payout, the Stripe account could not be created',
    boards: 'restaurant/onboarding/Payout-CreateError',
    run: async (page) => {
      await open(page, payoutPage, { ...payoutScene, connect: 'connect_status_not_started' });
      await page.route('**/v1/connect/account', (route) => route.fulfill(problem(500, 'INTERNAL_ERROR')));
      await setUp(page).click();
      await expect(page.getByTestId('problem-create')).toBeVisible();
    },
  },
  {
    name: 'payout, setup not open yet (409)',
    boards: 'restaurant/onboarding/Payout-StepNA',
    run: async (page) => {
      await open(page, payoutPage, { ...payoutScene, connect: 'connect_status_not_started' });
      await page.route('**/v1/connect/account', (route) => route.fulfill(problem(409, 'STEP_NOT_AVAILABLE')));
      await setUp(page).click();
      await expect(page.getByTestId('problem-step-na')).toBeVisible();
    },
  },
  {
    name: 'payout, back from Stripe, checking',
    boards: 'restaurant/onboarding/Payout-Checking',
    run: async (page) => {
      await open(page, `${payoutPage}/return`, { ...payoutScene, connect: 'never' });
      await expect(page.getByText(/asking Stripe for the latest/)).toBeVisible();
    },
  },
  {
    name: 'payout, back from Stripe, payouts on',
    boards: 'restaurant/onboarding/Payout-ReturnEnabled',
    run: async (page) => {
      // The page opens the next step two seconds after payouts show as on, by reading the setup again.
      // Once the first read is in, later ones are held, so the board's moment (payouts on, opening the
      // menu step) stays on screen.
      let hold = false;
      await serve(page, { ...payoutScene, connect: 'connect_status_complete' });
      const status = await fixture(page, STATUS.payout);
      await page.route('**/v1/restaurant/onboarding/status', (route) => (hold ? never() : route.fulfill({ json: { data: status } })));
      await openSignedIn(page, `${payoutPage}/return`);
      await expect(page.getByTestId('payout-screen')).toBeVisible();
      hold = true;
      await expect(page.getByText(/Taking you to your first menu/)).toBeVisible();
    },
  },
  {
    name: 'payout, Stripe needs more details',
    boards: { 1440: 'restaurant/onboarding/Payout-Due', 1024: 'restaurant/onboarding/Tab-Payout-1024' },
    run: async (page) => {
      await open(page, payoutPage, { ...payoutScene, connect: 'connect_status_currently_due' });
      await expect(page.getByRole('button', { name: 'Continue on Stripe' })).toBeVisible();
    },
  },
  {
    name: 'payout, Stripe is verifying',
    boards: { 1440: 'restaurant/onboarding/Payout-Verifying', 320: 'restaurant/onboarding/Reflow-Payout-320' },
    run: async (page) => {
      await open(page, payoutPage, { ...payoutScene, connect: 'connect_status_pending_verification' });
      await expect(page.getByText('Stripe is checking your details').first()).toBeVisible();
    },
  },
  {
    name: 'payout, Stripe turned payouts off',
    boards: 'restaurant/onboarding/Payout-Disabled',
    run: async (page) => {
      await open(page, payoutPage, { ...payoutScene, connect: 'connect_status_rejected' });
      await expect(page.getByRole('button', { name: 'Continue on Stripe' })).toBeVisible();
    },
  },
  {
    name: 'payout, enabled',
    boards: 'restaurant/onboarding/Payout-Enabled',
    run: async (page) => {
      await open(page, payoutPage, { ...payoutScene, connect: 'connect_status_complete' });
      await expect(page.getByRole('button', { name: 'Continue' })).toBeVisible();
    },
  },
  {
    name: 'payout, Stripe could not be opened',
    boards: 'restaurant/onboarding/Payout-LinkError',
    run: async (page) => {
      await open(page, payoutPage, { ...payoutScene, connect: 'connect_status_currently_due' });
      await page.route('**/v1/connect/onboarding-link', (route) => route.fulfill(problem(500, 'INTERNAL_ERROR')));
      await page.getByRole('button', { name: 'Continue on Stripe' }).click();
      await expect(page.getByTestId('problem-link')).toBeVisible();
    },
  },
  {
    name: 'payout, the Stripe link expired',
    boards: 'restaurant/onboarding/Payout-LinkExpired',
    run: async (page) => {
      await open(page, `${payoutPage}/refresh`, { ...payoutScene, connect: 'connect_status_currently_due' });
      await expect(page.getByTestId('problem-link-expired')).toBeVisible();
    },
  },
  {
    name: 'payout, the status does not load',
    boards: 'restaurant/onboarding/Payout-StatusError',
    run: async (page) => {
      await open(page, payoutPage, { ...payoutScene, connect: { status: 500 } });
      await expect(page.getByTestId('status-error')).toBeVisible();
    },
  },
];

const menuScene: Scene = { status: STATUS.menu, profile: 'restaurant_profile_halal_certified', menu: 'owned_menu_empty', hours: 'restaurant_hours_none' };
const menuPage = '/onboarding/menu';
const hoursBlock = (page: Page) => page.getByTestId('hours-block');

/** The hours editor open on a saved week, so the form is valid and a save can be sent. */
async function editingHours(page: Page, put: 'never' | 'abort' | { status: number }) {
  await open(page, menuPage, { ...menuScene, menu: 'owned_menu_with_pending_version', hours: 'restaurant_hours_standard' });
  const hours = await fixture(page, 'restaurant_hours_standard');
  await page.route('**/v1/restaurant/hours', (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { data: hours } });
    if (put === 'never') return never();
    if (put === 'abort') return route.abort();
    return route.fulfill(problem(put.status, 'VALIDATION_FAILED', [{ field: 'intervals', code: 'invalid', message: 'Check these times.' }]));
  });
  await page.getByRole('button', { name: 'Change hours' }).click();
  await expect(page.getByRole('form', { name: 'Opening hours' })).toBeVisible();
}

const menu: Case[] = [
  {
    name: 'menu, nothing added yet, hours not set',
    boards: 'restaurant/onboarding/Menu-None',
    run: async (page) => {
      await open(page, menuPage, menuScene);
      await expect(page.getByText('No opening hours yet')).toBeVisible();
    },
  },
  {
    name: 'menu, items with a reviewer, hours not set',
    boards: 'restaurant/onboarding/Menu-V0',
    run: async (page) => {
      await open(page, menuPage, { ...menuScene, menu: 'owned_menu_with_pending_version' });
      await expect(page.getByText('No opening hours yet')).toBeVisible();
    },
  },
  {
    name: 'menu, loading',
    boards: 'restaurant/onboarding/Menu-Loading',
    run: async (page) => {
      await open(page, menuPage, { ...menuScene, menu: 'never' });
      await expect(page.getByTestId('embedded-menu')).toBeVisible();
    },
  },
  {
    name: 'menu, does not load',
    boards: 'restaurant/onboarding/Menu-LoadError',
    run: async (page) => {
      await open(page, menuPage, { ...menuScene, menu: { status: 500 } });
      await expect(page.getByTestId('embedded-menu')).toBeVisible();
    },
  },
  {
    name: 'menu, opening hours being set',
    boards: { 1440: 'restaurant/onboarding/Menu-HoursEditing', 1024: 'restaurant/onboarding/Tab-Menu-1024' },
    run: async (page) => {
      await open(page, menuPage, { ...menuScene, menu: 'owned_menu_with_pending_version' });
      await page.getByRole('button', { name: 'Set opening hours' }).click();
      await expect(page.getByRole('form', { name: 'Opening hours' })).toBeVisible();
    },
  },
  {
    name: 'menu, opening hours saving',
    boards: 'restaurant/onboarding/Menu-HoursSaving',
    run: async (page) => {
      await editingHours(page, 'never');
      const put = page.waitForRequest((r) => r.method() === 'PUT' && /\/v1\/restaurant\/hours$/.test(r.url()));
      await page.getByRole('button', { name: 'Save hours' }).click();
      await put;
    },
  },
  {
    name: 'menu, opening hours refused (422)',
    boards: 'restaurant/onboarding/Menu-HoursError',
    run: async (page) => {
      await editingHours(page, { status: 422 });
      await page.getByRole('button', { name: 'Save hours' }).click();
      await expect(page.getByTestId('hours-errors')).toBeVisible();
    },
  },
  {
    name: 'menu, opening hours not saved (network or 5xx)',
    boards: 'restaurant/onboarding/Menu-HoursNetError',
    run: async (page) => {
      await editingHours(page, 'abort');
      await page.getByRole('button', { name: 'Save hours' }).click();
      await expect(page.getByTestId('hours-net-error')).toBeVisible();
    },
  },
  {
    name: 'menu, opening hours loading',
    boards: 'restaurant/onboarding/Menu-HoursLoading',
    run: async (page) => {
      await open(page, menuPage, { ...menuScene, hours: 'never' });
      await expect(page.getByText('Loading your opening hours…')).toBeVisible();
    },
  },
  {
    name: 'menu, opening hours do not load',
    boards: 'restaurant/onboarding/Menu-HoursLoadError',
    run: async (page) => {
      await open(page, menuPage, { ...menuScene, hours: { status: 500 } });
      await expect(page.getByText('We couldn’t load your opening hours')).toBeVisible();
    },
  },
  {
    name: 'menu, opening hours saved',
    boards: 'restaurant/onboarding/Menu-HoursSet',
    run: async (page) => {
      await open(page, menuPage, { ...menuScene, menu: 'owned_menu_with_pending_version', hours: 'restaurant_hours_split_past_midnight' });
      await expect(page.getByTestId('hours-summary')).toBeVisible();
    },
  },
];

const done: Case[] = [
  {
    name: 'done, go to orders',
    boards: 'restaurant/onboarding/Onb-Done',
    run: async (page) => {
      await open(page, '/onboarding/done', { status: STATUS.done, profile: 'restaurant_profile_halal_certified' });
      await expect(page.getByTestId('done-screen')).toBeVisible();
    },
  },
  {
    name: 'done, the certificate is expiring soon',
    boards: 'restaurant/onboarding/Onb-Done-Expiring',
    run: async (page) => {
      await open(page, '/onboarding/done', { status: STATUS.done, profile: 'restaurant_profile_halal_expiring_soon' });
      await expect(page.getByTestId('expiring-note')).toBeVisible();
    },
  },
  {
    name: 'done, the certificate is expiring soon, renewal open',
    boards: 'restaurant/onboarding/Onb-Done-Expiring-Renew',
    run: async (page) => {
      await open(page, '/onboarding/done', { status: STATUS.done, profile: 'restaurant_profile_halal_expiring_soon' });
      await page.getByRole('button', { name: 'Upload renewed certificate' }).click();
      await expect(page.getByTestId('renew-panel')).toBeVisible();
    },
  },
];

const ends: Case[] = [
  {
    name: 'ends, the application is withdrawn',
    boards: 'restaurant/onboarding/Withdrawn',
    run: async (page) => {
      await open(page, '/onboarding', { status: 'restaurant_onboarding_withdrawn' });
      await expect(page.getByTestId('withdrawn')).toBeVisible();
    },
  },
  {
    name: 'ends, suspended during setup, with the reason',
    boards: 'restaurant/onboarding/Suspended-Setup',
    run: async (page) => {
      await open(page, '/onboarding', { status: STATUS.documents, profile: 'restaurant_profile_account_suspended', availability: 'restaurant_open_state_closed_suspended' });
      await expect(page.getByTestId('account-state')).toBeVisible();
    },
  },
  {
    name: 'ends, suspended during setup, no reason returned',
    boards: 'restaurant/onboarding/Suspended-SetupNoReason',
    run: async (page) => {
      await open(page, '/onboarding', {
        status: STATUS.documents,
        profile: 'restaurant_profile_account_suspended',
        availability: 'restaurant_open_state_closed_suspended',
        availabilityPatch: (a) => ({ ...a, reason: null }),
      });
      await expect(page.getByTestId('account-state')).toBeVisible();
    },
  },
  {
    name: 'ends, deactivated during setup',
    boards: 'restaurant/onboarding/Deactivated-Setup',
    run: async (page) => {
      await open(page, '/onboarding', { status: STATUS.documents, profile: 'restaurant_profile_account_deactivated' });
      await expect(page.getByTestId('account-state')).toBeVisible();
    },
  },
  {
    name: 'ends, the halal certificate ended during setup',
    boards: 'restaurant/onboarding/Delisted-Setup',
    run: async (page) => {
      await open(page, '/onboarding', { status: STATUS.payout, profile: 'restaurant_profile_halal_expired', docs: 'restaurant_document_pack_halal_expired' });
      await expect(page.getByTestId('account-state')).toBeVisible();
    },
  },
];

/** The setup blocked on a halal certificate that ended, with the renewal panel open and a file chosen. */
async function lapsedRenewal(page: Page, r: Partial<Road> = {}) {
  await open(page, '/onboarding', { status: STATUS.payout, profile: 'restaurant_profile_halal_expired' }, { pack: 'restaurant_document_pack_halal_expired', ...r });
  await page.getByRole('button', { name: 'Upload renewed certificate' }).click();
  await expect(page.getByTestId('renew-panel')).toBeVisible();
  await choose(page, 'halal-certificate-hma-2027.pdf');
}

const lapsed: Case[] = [
  {
    name: 'blocked, the renewed certificate uploading',
    boards: 'restaurant/onboarding/Delisted-Uploading',
    run: async (page) => {
      await lapsedRenewal(page, { put: 'never' });
      await expect(page.getByTestId('upload-progress')).toBeVisible();
    },
  },
  {
    name: 'blocked, the renewed certificate, details to fill',
    boards: 'restaurant/onboarding/Delisted-Details',
    run: async (page) => {
      await lapsedRenewal(page);
      await expect(details(page, 'halal certificate')).toBeVisible();
    },
  },
  {
    name: 'blocked, the renewed certificate, the date has passed',
    boards: 'restaurant/onboarding/Delisted-DetailsError',
    run: async (page) => {
      await lapsedRenewal(page);
      await page.locator('#halal-certificate-valid').fill('2020-01-31');
      await save(page).click();
      await expect(page.getByTestId('draft-error')).toBeVisible();
    },
  },
  {
    name: 'blocked, sending the renewed certificate',
    boards: 'restaurant/onboarding/Delisted-Sending',
    run: async (page) => {
      await lapsedRenewal(page, { submit: 'never' });
      await page.locator('#halal-certificate-valid').fill(torontoDate(730));
      const submit = page.waitForRequest((r) => r.method() === 'POST' && /\/documents\/submit$/.test(r.url()));
      await save(page).click();
      await submit;
    },
  },
  {
    name: 'blocked, the renewed certificate was not sent',
    boards: 'restaurant/onboarding/Delisted-SendFailed',
    run: async (page) => {
      await lapsedRenewal(page, { submit: { status: 500, code: 'INTERNAL_ERROR' } });
      await page.locator('#halal-certificate-valid').fill(torontoDate(730));
      await save(page).click();
      await expect(page.getByTestId('renew-failed')).toBeVisible();
    },
  },
  {
    name: 'blocked, the renewed certificate sent',
    boards: 'restaurant/onboarding/Delisted-Sent',
    run: async (page) => {
      await lapsedRenewal(page);
      await page.locator('#halal-certificate-valid').fill(torontoDate(730));
      await save(page).click();
      await expect(page.getByTestId('renew-sent')).toBeVisible();
    },
  },
];

const CASES: Case[] = [...frame, ...profile, ...documents, ...review, ...fix, ...payout, ...menu, ...done, ...ends, ...lapsed];

test.describe('redesigned restaurant · onboarding states (mock)', () => {
  test.use({ colorScheme: 'light' });

  for (const c of CASES) {
    test(c.name, async ({ page }) => {
      const width = page.viewportSize()?.width ?? 0;
      test.skip(!widthsOf(c.boards).includes(width), 'no board at this width');
      await c.run(page);
      await settled(page, c.boards);
    });
  }
});

test.describe('redesigned restaurant · onboarding at phone width (mock)', () => {
  test.use({ colorScheme: 'light', viewport: { width: 320, height: 1000 } });

  for (const c of CASES.filter((x) => widthsOf(x.boards).includes(320))) {
    test(`${c.name}, 320 px`, async ({ page }) => {
      test.skip(projectMeta().viewport !== 'desktop', 'one capture at 320 px, not one per project');
      await c.run(page);
      await settled(page, c.boards);
    });
  }
});
