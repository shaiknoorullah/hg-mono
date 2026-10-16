import { expect, test, type Page, type Route } from '@playwright/test';

import {
  allApproved,
  application,
  doc,
  FATIMA,
  motorisedDocs,
  sep,
  withState,
  type Json,
} from './redesign-admin.rider-onboarding.scene';
import {
  answerAll,
  capture,
  choose,
  failOrRefuse,
  inReview,
  LOCK,
  ONE,
  openApp,
  openDoc,
  reviewing,
  TWO,
  type Live,
  type Outcome,
} from './redesign-admin.rider-onboarding.steps';
import { E2E_MODE } from './mode';

test.skip(E2E_MODE !== 'mock', 'written against the mock server; run with E2E_MODE=mock');

/**
 * The redesigned admin console's rider decision panels (approve, reject, request changes), the
 * document rejection panel and every outcome, each state captured for the design board it must
 * match (tools/e2e/README.md, "Design captures"). Boards are drawn at 1440 wide, so the tablet
 * project takes no capture. Mock mode: the calls are answered with `page.route` (see
 * redesign-admin.rider-onboarding.scene.ts), the only way to give the stateless mock a claim held
 * by the signed-in reviewer or a refusal from the server.
 *
 * Board ids are written out in full on purpose: tools/e2e/web/check-boards.mjs validates only
 * literal ids.
 */
const BASE = process.env.E2E_ADMIN_REDESIGN_URL ?? process.env.BASE_URL;
if (BASE) test.use({ baseURL: BASE });

type How = Outcome;

/** Answers `decideRiderApplication` as `how` says; an accepted decision moves the live application. */
const deciding =
  (live: Live, how: How = 'ok') =>
  async (route: Route): Promise<void> => {
    if (!(await failOrRefuse(route, live, how))) return;
    const body = route.request().postDataJSON() as Json;
    live.app!.onboarding_state = body.decision === 'APPROVE' ? 'PAYOUT_PENDING' : 'DOCUMENTS_REJECTED';
    live.app!.assigned_admin_id = null;
    live.app!.review_lock_expires_at = null;
    return route.fulfill({ json: { data: live.app } });
  };

const REJECT_MESSAGE = 'The expiry date on your insurance document appears to have been edited, so we can’t accept it. Contact support if you believe this is a mistake.';
const CHANGES_MESSAGE = 'Page 2 of your vehicle insurance is missing. Upload every page of the policy, including the page that lists permitted use.';

/** Every document approved and nothing stopping approval: Approve rider… is on. */
const ready = (me: string): Json => inReview(me, { blockers: [] }, allApproved(motorisedDocs(FATIMA.id)));

/** The insurance rejected for missing pages: the state Request changes… is drawn from. */
const insuranceRejected = (me: string): Json =>
  inReview(
    me,
    { blockers: ['Vehicle insurance is rejected', TWO] },
    withState(motorisedDocs(FATIMA.id), 'VEHICLE_INSURANCE', { state: 'REJECTED', rejection_reason_code: 'INCOMPLETE_PAGES', review_note: CHANGES_MESSAGE }),
  );

async function openWith(page: Page, build: (me: string) => Json, how: How = 'ok', live: Live = {}, reviewHow: How = 'ok') {
  await openApp(page, { detail: (me) => (live.app ??= build(me)), decision: deciding(live, how), review: reviewing(live, reviewHow) });
  return live;
}

const message = (page: Page) => page.getByLabel(/Message to the rider/);
const send = (page: Page, name: string) => page.getByRole('button', { name, exact: true }).click();

async function approvePanel(page: Page, how: How = 'ok') {
  const live = await openWith(page, ready, how);
  await page.getByRole('button', { name: 'Approve rider…' }).click();
  await expect(page.getByTestId('DecisionPanel-approve')).toBeVisible();
  return live;
}

async function rejectPanel(page: Page, build: (me: string) => Json = (me) => inReview(me), how: How = 'ok') {
  const live = await openWith(page, build, how);
  await page.getByRole('button', { name: 'Reject…' }).click();
  await expect(page.getByTestId('DecisionPanel-reject')).toBeVisible();
  return live;
}

async function changesPanel(page: Page, build: (me: string) => Json = insuranceRejected, how: How = 'ok') {
  const live = await openWith(page, build, how);
  await page.getByRole('button', { name: 'Request changes…' }).click();
  await expect(page.getByTestId('DecisionPanel-changes')).toBeVisible();
  return live;
}

const fillReject = async (page: Page, reason = 'Name doesn’t match') => {
  await choose(page, /Reason/, reason);
  await message(page).fill(REJECT_MESSAGE);
};

test.describe('redesigned admin · rider decisions (mock)', () => {
  test.use({ colorScheme: 'light' });

  // Every board of the area is drawn at 1440 wide, and the panes a panel squeezes at 1024 are a
  // finding of their own, not this spec's: the desktop project takes the captures.
  test.skip(({ viewport }) => viewport?.width !== 1440, 'the rider onboarding boards are drawn at 1440 wide');

  // ── Approve rider ──────────────────────────────────────────────────────────

  test('approve panel, default', async ({ page }) => {
    await approvePanel(page);
    await capture(page, { 1440: 'admin/rider-onboarding/DecisionApprove' });
  });

  test('approve panel, message too short', async ({ page }) => {
    await approvePanel(page);
    await message(page).fill('OK');
    await send(page, 'Approve rider');
    await expect(page.getByText('Write at least 10 characters. This has 2.')).toBeVisible();
    await capture(page, { 1440: 'admin/rider-onboarding/DecisionApproveInvalid' });
  });

  test('approve panel, submitting', async ({ page }) => {
    await approvePanel(page, 'never');
    await send(page, 'Approve rider');
    await capture(page, { 1440: 'admin/rider-onboarding/DecisionApproveSubmitting' }, { settled: false });
  });

  test('approve panel, failed, message kept', async ({ page }) => {
    await approvePanel(page, 'error');
    await send(page, 'Approve rider');
    await expect(page.getByText('Nothing was recorded. Your message is kept.')).toBeVisible();
    await capture(page, { 1440: 'admin/rider-onboarding/DecisionApproveFailed' });
  });

  test('approve panel, the server says under 18', async ({ page }) => {
    await approvePanel(page, { status: 422, code: 'AGE_REQUIREMENT_NOT_MET' });
    await send(page, 'Approve rider');
    await expect(page.getByText('Not approved: this rider is under 18')).toBeVisible();
    await capture(page, { 1440: 'admin/rider-onboarding/DecisionApproveAge422' });
  });

  test('approved, payout pending', async ({ page }) => {
    await approvePanel(page);
    await send(page, 'Approve rider');
    await expect(page.getByTestId('DecisionOutcome')).toBeVisible();
    await capture(page, { 1440: 'admin/rider-onboarding/DecisionApproved' });
  });

  test('approved, then Take next found nothing', async ({ page }) => {
    await approvePanel(page);
    await send(page, 'Approve rider');
    await expect(page.getByTestId('DecisionOutcome')).toBeVisible();
    await page.getByTestId('DecisionOutcome').getByRole('button', { name: 'Take next' }).click();
    await expect(page.getByText('Nothing to take: no applications are waiting')).toBeVisible();
    await capture(page, { 1440: 'admin/rider-onboarding/DecisionOutcomeTakeNextEmpty' });
  });

  test('not approved: work eligibility was re-uploaded (422)', async ({ page }) => {
    await approvePanel(page, {
      status: 422,
      code: 'PRECONDITION_NOT_MET',
      then: (app) => {
        app.documents = withState(app.documents, 'WORK_ELIGIBILITY', { state: 'SUBMITTED', version: 2 });
        app.blockers = ['Work eligibility was replaced by a new upload (version 2) and needs review'];
      },
    });
    await send(page, 'Approve rider');
    await expect(page.getByText('Not approved: something changed after you opened this page')).toBeVisible();
    await capture(page, { 1440: 'admin/rider-onboarding/DecisionPreconditionNotMet' });
  });

  test('already decided (409)', async ({ page }) => {
    await approvePanel(page, {
      status: 409,
      code: 'ALREADY_DECIDED',
      then: (app) => {
        app.onboarding_state = 'DOCUMENTS_REJECTED';
        app.assigned_admin_id = null;
        app.review_lock_expires_at = null;
      },
    });
    await send(page, 'Approve rider');
    await expect(page.getByText('Already decided')).toBeVisible();
    await capture(page, { 1440: 'admin/rider-onboarding/DecisionAlreadyDecided' });
  });

  // ── Reject application ─────────────────────────────────────────────────────

  test('reject panel, default', async ({ page }) => {
    await rejectPanel(page);
    await capture(page, { 1440: 'admin/rider-onboarding/DecisionReject' });
  });

  test('reject panel, no reason and a short message', async ({ page }) => {
    await rejectPanel(page);
    await message(page).fill('Too short');
    await send(page, 'Reject application');
    await expect(page.getByText('to fix').first()).toBeVisible();
    await capture(page, { 1440: 'admin/rider-onboarding/DecisionRejectInvalid' });
  });

  test('reject panel, a fixable reason', async ({ page }) => {
    await rejectPanel(page);
    await choose(page, /Reason/, 'Illegible');
    await message(page).fill(REJECT_MESSAGE);
    await expect(page.getByText('Illegible can be fixed by the rider')).toBeVisible();
    await capture(page, { 1440: 'admin/rider-onboarding/DecisionRejectRemediable' });
  });

  test('reject panel, submitting', async ({ page }) => {
    await rejectPanel(page, (me) => inReview(me), 'never');
    await fillReject(page);
    await send(page, 'Reject application');
    await capture(page, { 1440: 'admin/rider-onboarding/DecisionRejectSubmitting' }, { settled: false });
  });

  test('reject panel, failed, message kept', async ({ page }) => {
    await rejectPanel(page, (me) => inReview(me), 'error');
    await fillReject(page);
    await send(page, 'Reject application');
    await expect(page.getByText('Nothing was recorded. Your message is kept.')).toBeVisible();
    await capture(page, { 1440: 'admin/rider-onboarding/DecisionRejectFailed' });
  });

  test('reject panel, not sent: application changed (422)', async ({ page }) => {
    await rejectPanel(page, (me) => inReview(me), { status: 422, code: 'PRECONDITION_NOT_MET' });
    await fillReject(page);
    await send(page, 'Reject application');
    await expect(page.getByText('Not approved: something changed after you opened this page')).toBeVisible();
    await capture(page, { 1440: 'admin/rider-onboarding/DecisionRejectChanged' });
  });

  test('reject panel, not sent: claim ended (409)', async ({ page }) => {
    await rejectPanel(page, (me) => inReview(me), { status: 409, code: 'REVIEW_LOCK_LOST', then: (app) => void (app.review_lock_expires_at = sep(28, 14, 32)) });
    await fillReject(page);
    await send(page, 'Reject application');
    await expect(page.getByText('Your claim ended').first()).toBeVisible();
    await capture(page, { 1440: 'admin/rider-onboarding/DecisionRejectClaimEnded' });
  });

  test('reject panel, not sent: already decided (409)', async ({ page }) => {
    await rejectPanel(page, (me) => inReview(me), {
      status: 409,
      code: 'ALREADY_DECIDED',
      then: (app) => {
        app.onboarding_state = 'DOCUMENTS_REJECTED';
        app.assigned_admin_id = null;
        app.review_lock_expires_at = null;
      },
    });
    await fillReject(page);
    await send(page, 'Reject application');
    await expect(page.getByText('Already decided')).toBeVisible();
    await capture(page, { 1440: 'admin/rider-onboarding/DecisionRejectDecided' });
  });

  test('reject panel, under 18 on the ID', async ({ page }) => {
    await rejectPanel(page, (me) => underEighteen(me));
    await fillReject(page, 'Date of birth doesn’t match');
    await capture(page, { 1440: 'admin/rider-onboarding/DecisionRejectUnder18' });
  });

  test('application rejected', async ({ page }) => {
    await rejectPanel(page);
    await fillReject(page, 'Other');
    await send(page, 'Reject application');
    await expect(page.getByTestId('DecisionOutcome')).toBeVisible();
    await capture(page, { 1440: 'admin/rider-onboarding/DecisionRejected' });
  });

  // ── Request changes ────────────────────────────────────────────────────────

  test('request changes panel, your rejections pre-ticked', async ({ page }) => {
    await changesPanel(page);
    await capture(page, { 1440: 'admin/rider-onboarding/DecisionRequestChanges' });
  });

  test('request changes panel, a bicycle rider', async ({ page }) => {
    await changesPanel(page, (me) => bicycleRider(me));
    await capture(page, { 1440: 'admin/rider-onboarding/DecisionRequestChangesBicycle' });
  });

  test('request changes panel, nothing picked and a short message', async ({ page }) => {
    await changesPanel(page, (me) => inReview(me));
    await message(page).fill('Too short');
    await send(page, 'Send request');
    await expect(page.getByText('to fix').first()).toBeVisible();
    await capture(page, { 1440: 'admin/rider-onboarding/DecisionRequestChangesInvalid' });
  });

  test('request changes panel, submitting', async ({ page }) => {
    await changesPanel(page, insuranceRejected, 'never');
    await send(page, 'Send request');
    await capture(page, { 1440: 'admin/rider-onboarding/DecisionRequestChangesSubmitting' }, { settled: false });
  });

  test('request changes panel, failed, message kept', async ({ page }) => {
    await changesPanel(page, insuranceRejected, 'error');
    await send(page, 'Send request');
    await expect(page.getByText('Nothing was recorded. Your message is kept.')).toBeVisible();
    await capture(page, { 1440: 'admin/rider-onboarding/DecisionRequestChangesFailed' });
  });

  test('request changes panel, not sent: application changed (422)', async ({ page }) => {
    await changesPanel(page, insuranceRejected, { status: 422, code: 'PRECONDITION_NOT_MET' });
    await send(page, 'Send request');
    await expect(page.getByText('Not approved: something changed after you opened this page')).toBeVisible();
    await capture(page, { 1440: 'admin/rider-onboarding/DecisionRequestChangesChanged' });
  });

  test('request changes panel, not sent: claim ended (409)', async ({ page }) => {
    await changesPanel(page, insuranceRejected, { status: 409, code: 'REVIEW_LOCK_LOST', then: (app) => void (app.review_lock_expires_at = sep(28, 14, 32)) });
    await send(page, 'Send request');
    await expect(page.getByText('Your claim ended').first()).toBeVisible();
    await capture(page, { 1440: 'admin/rider-onboarding/DecisionRequestChangesClaimEnded' });
  });

  test('request changes panel, not sent: already decided (409)', async ({ page }) => {
    await changesPanel(page, insuranceRejected, {
      status: 409,
      code: 'ALREADY_DECIDED',
      then: (app) => {
        app.onboarding_state = 'DOCUMENTS_REJECTED';
        app.assigned_admin_id = null;
        app.review_lock_expires_at = null;
      },
    });
    await send(page, 'Send request');
    await expect(page.getByText('Already decided')).toBeVisible();
    await capture(page, { 1440: 'admin/rider-onboarding/DecisionRequestChangesDecided' });
  });

  test('changes requested', async ({ page }) => {
    await changesPanel(page);
    await send(page, 'Send request');
    await expect(page.getByTestId('DecisionOutcome')).toBeVisible();
    await capture(page, { 1440: 'admin/rider-onboarding/DecisionChangesRequested' });
  });

  // ── Reject document ────────────────────────────────────────────────────────

  /** The insurance with its legibility check failed and the reject panel open. */
  async function rejectDocument(page: Page, how: How = 'ok', build: (me: string) => Json = (me) => inReview(me)) {
    const live = await openWith(page, build, 'ok', {}, how);
    await answerAll(page, 'Passes', { 0: 'Fails' }, { 0: 'Page 2 missing.' });
    await page.getByRole('button', { name: 'Reject document…' }).click();
    await expect(page.getByTestId('DocumentRejectPanel')).toBeVisible();
    return live;
  }
  const rejectIt = (page: Page) => send(page, 'Reject document');

  test('reject document panel, default', async ({ page }) => {
    await rejectDocument(page);
    await capture(page, { 1440: 'admin/rider-onboarding/DecisionRejectDocument' });
  });

  test('reject document panel, no reason chosen', async ({ page }) => {
    await rejectDocument(page);
    await rejectIt(page);
    await expect(page.getByText('Choose a reason.')).toBeVisible();
    await capture(page, { 1440: 'admin/rider-onboarding/DecisionRejectDocumentInvalid' });
  });

  test('reject document panel, Other with a short note', async ({ page }) => {
    await rejectDocument(page);
    await choose(page, /Reason/, 'Other');
    await page.getByLabel('Note to the rider', { exact: true }).fill('Too short');
    await rejectIt(page);
    await expect(page.getByText('Required for Other.')).toBeVisible();
    await capture(page, { 1440: 'admin/rider-onboarding/DecisionRejectDocumentOtherShort' });
  });

  test('reject document panel, submitting', async ({ page }) => {
    await rejectDocument(page, 'never');
    await choose(page, /Reason/, 'Pages missing');
    await rejectIt(page);
    await capture(page, { 1440: 'admin/rider-onboarding/DecisionRejectDocumentSubmitting' }, { settled: false });
  });

  test('reject document panel, failed, note kept', async ({ page }) => {
    await rejectDocument(page, 'error');
    await choose(page, /Reason/, 'Pages missing');
    await page.getByLabel('Note to the rider', { exact: true }).fill('Page 2 of the policy is missing. Upload every page.');
    await rejectIt(page);
    await expect(page.getByText('Nothing was recorded. Your note is kept.')).toBeVisible();
    await capture(page, { 1440: 'admin/rider-onboarding/DecisionRejectDocumentFailed' });
  });

  test('reject document panel, offline, not sent', async ({ page }) => {
    await rejectDocument(page, 'abort');
    await choose(page, /Reason/, 'Pages missing');
    await page.getByLabel('Note to the rider', { exact: true }).fill('Page 2 of the policy is missing. Upload every page.');
    await page.context().setOffline(true);
    await rejectIt(page);
    await expect(page.getByText('Nothing was recorded. Your note is kept.')).toBeVisible();
    await capture(page, { 1440: 'admin/rider-onboarding/DecisionRejectDocumentOffline' });
  });

  test('reject document panel, commercial use excluded', async ({ page }) => {
    const live = await openWith(page, (me) => inReview(me));
    await answerAll(page, 'Passes', { 3: 'Fails' }, { 2: 'Plate matches on page 1.', 3: 'Page 2, section 4 excludes commercial and delivery use.' });
    await page.getByLabel(/Note to the rider \(optional\)/).fill('Your policy excludes commercial and delivery use. Upload a policy that covers it.');
    await page.getByRole('button', { name: 'Reject document…' }).click();
    await expect(page.getByRole('button', { name: 'Insert my note from the checks' })).toBeVisible();
    expect(live.app).toBeTruthy();
    await choose(page, /Reason/, 'Other');
    await capture(page, { 1440: 'admin/rider-onboarding/DecisionRejectDocumentCommercial' });
  });

  test('reject document panel, under 14 days, Expired preselected', async ({ page }) => {
    const docs = withState(motorisedDocs(FATIMA.id), 'VEHICLE_INSURANCE', { valid_until: '2026-10-07' });
    await openWith(page, (me) => inReview(me, { blockers: ['Vehicle insurance expires in 9 days (needs 14 or more)'] }, docs));
    await answerAll(page, 'Passes', { 4: 'Fails' });
    await page.getByRole('button', { name: 'Reject document…' }).click();
    await expect(page.getByTestId('DocumentRejectPanel')).toBeVisible();
    await capture(page, { 1440: 'admin/rider-onboarding/DecisionRejectDocumentExpired' });
  });

  test('reject document panel, registration, plate does not match', async ({ page }) => {
    const docs = withState(withState(motorisedDocs(FATIMA.id), 'VEHICLE_REGISTRATION', { state: 'IN_REVIEW' }), 'VEHICLE_INSURANCE', { state: 'SUBMITTED' });
    await openWith(page, (me) => inReview(me, { blockers: ['Vehicle registration isn’t approved yet', ONE, TWO] }, docs));
    await openDoc(page, /Open Vehicle registration/);
    await answerAll(page, 'Passes', { 2: 'Fails', 4: 'Doesn’t apply' }, { 2: 'The registration reads CKRT 428.' });
    await page.getByRole('button', { name: 'Reject document…' }).click();
    await expect(page.getByTestId('DocumentRejectPanel')).toBeVisible();
    await capture(page, { 1440: 'admin/rider-onboarding/DecisionRejectDocumentPlate' });
  });
});

// ── riders the panels are drawn on ───────────────────────────────────────────

const MARYAM_ID = '0192f3c9-40aa-7e10-8b21-aa01c2d3e4f5';
const YUSUF_ID = '0192f3b0-5e61-7a02-b3c9-0f1e2d3c4b5a';

function bicycleRider(me: string): Json {
  return application(
    { id: MARYAM_ID, first: 'Maryam', last: 'Hassan', email: 'maryam.h@proton.ca', dob: '2002-06-04', vehicle: null, vehicleType: 'BICYCLE', attempt: 1, age: 24 },
    {
      assigned_admin_id: me,
      review_lock_expires_at: LOCK,
      blockers: [TWO, 'Profile photo isn’t approved yet'],
      documents: [
        doc(MARYAM_ID, { type: 'GOVERNMENT_ID', state: 'APPROVED', valid: '2031-03-03' }),
        doc(MARYAM_ID, { type: 'WORK_ELIGIBILITY', state: 'IN_REVIEW', valid: '2028-07-15' }),
        doc(MARYAM_ID, { type: 'PROFILE_PHOTO', state: 'SUBMITTED', valid: null }),
      ],
    },
  );
}

/** The ID rejected for its date of birth, which makes the rider 17. */
function underEighteen(me: string): Json {
  return application(
    { id: YUSUF_ID, first: 'Yusuf', last: 'Ahmed', email: 'yusuf.a@outlook.ca', dob: '2006-11-02', vehicle: null, vehicleType: 'BICYCLE', attempt: 1, age: 17 },
    {
      assigned_admin_id: me,
      review_lock_expires_at: LOCK,
      blockers: ['Government ID is rejected'],
      documents: [
        doc(YUSUF_ID, { type: 'GOVERNMENT_ID', state: 'REJECTED', valid: '2030-01-09', reason: 'DOB_MISMATCH' }),
        doc(YUSUF_ID, { type: 'WORK_ELIGIBILITY', state: 'APPROVED', valid: '2029-03-04' }),
        doc(YUSUF_ID, { type: 'PROFILE_PHOTO', state: 'APPROVED', valid: null }),
      ],
    },
  );
}

