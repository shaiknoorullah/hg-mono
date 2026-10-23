import { expect, test, type Page } from '@playwright/test';

import { expectDesign } from './design';
import { E2E_MODE } from './mode';
import { allApproved, application, arrive, doc, FATIMA, motorisedDocs, openAt, OTHER_REVIEWER, oct, sep, withState, type Json, type RiderSpec } from './redesign-admin.rider-onboarding.scene';
import { answerAll, capture, choose, inReview, LOCK, ONE, openApp, openDoc, reviewing, TWO, type Live } from './redesign-admin.rider-onboarding.steps';

test.skip(E2E_MODE !== 'mock', 'written against the mock server; run with E2E_MODE=mock');

/**
 * The redesigned admin console's rider application workspace, each state captured for the design
 * board it must match (tools/e2e/README.md, "Design captures"): the application opened from the
 * queue, the document card and its checks, and the viewer. The decision panels are in
 * redesign-admin.rider-onboarding-decisions.spec.ts and the boards no capture can pair are in
 * redesign-admin.rider-onboarding-unpairable.spec.ts. Mock mode: the calls are answered with
 * `page.route` (see redesign-admin.rider-onboarding.scene.ts), the only way to give the stateless
 * mock a claim held by the signed-in reviewer, a document in review or a call that fails.
 *
 * Boards are drawn at 1440 wide (two at 1024 and 1280, taken by resizing the page), so the tablet
 * project takes no capture. Board ids are written out in full on purpose:
 * tools/e2e/web/check-boards.mjs validates only literal ids.
 */
const BASE = process.env.E2E_ADMIN_REDESIGN_URL ?? process.env.BASE_URL;
if (BASE) test.use({ baseURL: BASE });


const TWO_ONLY = TWO;

const rider = (id: string, first: string, last: string, email: string, dob: string, vehicleType: RiderSpec['vehicleType'], attempt: number, age: number, vehicle: RiderSpec['vehicle'] = null): RiderSpec => ({
  id,
  first,
  last,
  email,
  dob,
  vehicle,
  vehicleType,
  attempt,
  age,
});

const HAFSA = rider('0192f3b8-9a12-7f33-a1d4-5c6d7e8f2210', 'Hafsa', 'Qureshi', 'hafsa.q@outlook.ca', '1996-07-03', 'MOTORCYCLE', 1, 30, { type: 'MOTORCYCLE', make: 'Honda', model: 'CB300R', year: 2022, colour: 'Red', plate: 'MX 8830' });
const MARYAM = rider('0192f3c9-40aa-7e10-8b21-aa01c2d3e4f5', 'Maryam', 'Hassan', 'maryam.h@proton.ca', '2002-06-04', 'BICYCLE', 1, 24);
const YUSUF = rider('0192f3b0-5e61-7a02-b3c9-0f1e2d3c4b5a', 'Yusuf', 'Ahmed', 'yusuf.a@outlook.ca', '2006-11-02', 'BICYCLE', 1, 17);
const OMAR = rider('0192f3c2-2b7e-7d48-9c05-e1f2a3b4c688', 'Omar', 'Siddiqui', 'omar.s@gmail.com', '1999-01-30', 'ON_FOOT', 3, 27);
const MUSA = rider('0192f3a4-11d0-7c55-8e2a-77aa01bb3e07', 'Musa', 'Ibrahim', 'musa.i@gmail.com', '1998-12-19', 'SCOOTER', 1, 27, { type: 'SCOOTER', make: 'Vespa', model: 'Primavera 150', year: 2021, colour: 'Blue', plate: 'SC 5510' });
const NOURA = rider('0192f390-0a08-7b08-8008-000000000008', 'Noura', 'Saleh', 'noura.s@gmail.com', '1997-09-09', 'BICYCLE', 1, 29);
const YAHYA = rider('0192f390-0a09-7b09-8009-000000000009', 'Yahya', 'Latif', 'yahya.l@gmail.com', '1991-05-23', 'CAR', 1, 35, { type: 'CAR', make: 'Honda', model: 'Civic', year: 2020, colour: 'Blue', plate: 'CLMN 207' });

const claimed = (me: string, until = LOCK): Json => ({ assigned_admin_id: me, review_lock_expires_at: until });
const bicycleDocs = (id: string, gov: Partial<Json>, work: Partial<Json>, photo: Partial<Json>): Json[] => [
  { ...doc(id, { type: 'GOVERNMENT_ID', state: 'APPROVED', valid: '2031-03-03' }), ...gov },
  { ...doc(id, { type: 'WORK_ELIGIBILITY', state: 'IN_REVIEW', valid: '2028-07-15' }), ...work },
  { ...doc(id, { type: 'PROFILE_PHOTO', state: 'SUBMITTED', valid: null }), ...photo },
];

const hafsa = (me: string): Json =>
  application(HAFSA, {
    ...claimed(me),
    submitted_at: sep(27, 19, 21),
    sla_due_at: sep(30, 14, 40),
    blockers: ['Driver’s licence isn’t approved yet', 'Vehicle registration isn’t approved yet', ONE, TWO, 'Profile photo isn’t approved yet'],
    documents: [
      doc(HAFSA.id, { type: 'DRIVERS_LICENCE', state: 'IN_REVIEW', valid: '2031-07-03' }),
      doc(HAFSA.id, { type: 'VEHICLE_REGISTRATION', state: 'SUBMITTED', valid: '2027-03-15' }),
      doc(HAFSA.id, { type: 'VEHICLE_INSURANCE', state: 'SUBMITTED', valid: '2027-04-30' }),
      doc(HAFSA.id, { type: 'WORK_ELIGIBILITY', state: 'SUBMITTED', valid: '2028-07-15' }),
      doc(HAFSA.id, { type: 'PROFILE_PHOTO', state: 'SUBMITTED', valid: null }),
    ],
  });

const registration = (me: string): Json => {
  const docs = withState(withState(motorisedDocs(FATIMA.id), 'VEHICLE_REGISTRATION', { state: 'IN_REVIEW' }), 'VEHICLE_INSURANCE', { state: 'SUBMITTED' });
  return inReview(me, { blockers: ['Vehicle registration isn’t approved yet', ONE, TWO] }, docs);
};

const maryam = (me: string, until = LOCK): Json =>
  application(MARYAM, {
    ...claimed(me, until),
    submitted_at: sep(28, 10, 12),
    sla_due_at: oct(1, 16, 12),
    blockers: [TWO, 'Profile photo isn’t approved yet'],
    documents: bicycleDocs(MARYAM.id, {}, {}, {}),
  });

const yusuf = (me: string, idRejected = false): Json =>
  application(YUSUF, {
    ...claimed(me),
    submitted_at: sep(27, 8, 40),
    sla_due_at: sep(30, 14, 40),
    blockers: [idRejected ? 'Government ID is rejected' : 'Government ID isn’t approved yet'],
    documents: [
      { ...doc(YUSUF.id, { type: 'GOVERNMENT_ID', state: idRejected ? 'REJECTED' : 'IN_REVIEW', valid: '2030-01-09', ...(idRejected ? { reason: 'DOB_MISMATCH' } : {}) }) },
      doc(YUSUF.id, { type: 'WORK_ELIGIBILITY', state: 'APPROVED', valid: '2029-03-04' }),
      doc(YUSUF.id, { type: 'PROFILE_PHOTO', state: 'APPROVED', valid: null }),
    ],
  });

const omar = (me: string): Json =>
  application(OMAR, {
    ...claimed(me),
    submitted_at: sep(28, 9, 5),
    sla_due_at: oct(1, 15, 5),
    blockers: ['Government ID isn’t approved yet', TWO],
    documents: [
      doc(OMAR.id, { type: 'GOVERNMENT_ID', state: 'REJECTED', version: 1, valid: '2030-08-22', reason: 'ILLEGIBLE' }),
      doc(OMAR.id, { type: 'GOVERNMENT_ID', state: 'REJECTED', version: 2, valid: '2030-08-22', reason: 'ILLEGIBLE' }),
      doc(OMAR.id, { type: 'GOVERNMENT_ID', state: 'IN_REVIEW', version: 3, valid: '2030-08-22' }),
      doc(OMAR.id, { type: 'WORK_ELIGIBILITY', state: 'SUBMITTED', valid: '2028-11-19' }),
      doc(OMAR.id, { type: 'PROFILE_PHOTO', state: 'APPROVED', valid: null }),
    ],
  });

const musa = (me: string): Json =>
  application(MUSA, {
    ...claimed(me),
    submitted_at: sep(24, 10, 2),
    sla_due_at: sep(27, 16, 2),
    blockers: [ONE, TWO],
    documents: motorisedDocs(MUSA.id),
  });

const yahya = (): Json =>
  application(YAHYA, { onboarding_state: 'ACTIVE', submitted_at: sep(12, 15, 48), sla_due_at: sep(14, 15, 48), documents: allApproved(motorisedDocs(YAHYA.id)) });

const noura = (): Json =>
  application(NOURA, {
    onboarding_state: 'PAYOUT_PENDING',
    submitted_at: sep(18, 11, 2),
    sla_due_at: sep(20, 11, 2),
    documents: bicycleDocs(NOURA.id, { valid_until: '2031-06-11' }, { state: 'APPROVED', valid_until: '2029-02-11' }, { state: 'APPROVED' }),
  });

test.describe('redesigned admin · rider application (mock)', () => {
  test.use({ colorScheme: 'light' });

  // Every board of the area is drawn at 1440 wide, and the panes a panel squeezes at 1024 are a
  // finding of their own, not this spec's: the desktop project takes the captures.
  test.skip(({ viewport }) => viewport?.width !== 1440, 'the rider onboarding boards are drawn at 1440 wide');

  test('in review, claimed by you', async ({ page }) => {
    await openApp(page, { detail: (me) => inReview(me) });
    await capture(page, { 1440: 'admin/rider-onboarding/DetailReview' });
  });

  for (const [width, board] of [
    [1024, 'admin/rider-onboarding/DetailNarrow1024'],
    [1280, 'admin/rider-onboarding/DetailNarrow1280'],
  ] as const) {
    test(`${width} px`, async ({ page }, info) => {
      test.skip(info.project.metadata.viewport !== 'desktop', 'drawn at its own width: taken once, by the desktop project');
      await page.setViewportSize({ width, height: 900 });
      await openApp(page, { detail: (me) => inReview(me) });
      await page.waitForLoadState('networkidle');
      await expect(page.getByText('Not built yet')).toHaveCount(0);
      await expectDesign(page, board);
    });
  }

  test('loading', async ({ page }) => {
    await arrive(page, { detail: 'never' });
    await openAt(page, `#/riders/${FATIMA.id}`);
    await expect(page.getByTestId('ApplicationLoading')).toBeVisible();
    await capture(page, { 1440: 'admin/rider-onboarding/DetailLoading' }, { settled: false });
  });

  test('failed to load', async ({ page }) => {
    await arrive(page, { detail: 'error' });
    await openAt(page, `#/riders/${FATIMA.id}`);
    await expect(page.getByText('The application didn’t load')).toBeVisible();
    await capture(page, { 1440: 'admin/rider-onboarding/DetailError' });
  });

  test('not found (404)', async ({ page }) => {
    await arrive(page, { detail: 'notfound' });
    await openAt(page, `#/riders/${FATIMA.id}`);
    await expect(page.getByText('This application doesn’t exist')).toBeVisible();
    await capture(page, { 1440: 'admin/rider-onboarding/DetailNotFound' });
  });

  test('no access (403)', async ({ page }) => {
    await arrive(page, { detail: 'forbidden' });
    await openAt(page, `#/riders/${FATIMA.id}`);
    await expect(page.getByText('You can’t open this application')).toBeVisible();
    await capture(page, { 1440: 'admin/rider-onboarding/DetailForbidden' });
  });

  test('claimed by another reviewer', async ({ page }) => {
    await openApp(page, { detail: inReview('', { assigned_admin_id: OTHER_REVIEWER, review_lock_expires_at: sep(28, 15, 10) }) });
    await expect(page.getByText('Claimed by another reviewer until')).toBeVisible();
    await capture(page, { 1440: 'admin/rider-onboarding/DetailLockedByOther' });
  });

  test('opened from a row, unclaimed', async ({ page }) => {
    await openApp(page, { detail: inReview('', { assigned_admin_id: null, review_lock_expires_at: null }) });
    await expect(page.getByText('You’re reading without a claim.')).toBeVisible();
    await capture(page, { 1440: 'admin/rider-onboarding/DetailUnclaimed' });
  });

  test('claim ending, every check answered', async ({ page }) => {
    await openApp(page, { detail: (me) => inReview(me, { review_lock_expires_at: sep(28, 14, 40) }) });
    await expect(page.getByText('8 minutes left on your claim')).toBeVisible();
    await answerAll(page, 'Passes', {}, { 2: 'Plate matches on page 1.', 3: 'Page 2 lists commercial and delivery use as covered.' });
    await capture(page, { 1440: 'admin/rider-onboarding/DetailLockWarning' });
  });

  test('claim ended', async ({ page }) => {
    await openApp(page, { now: sep(28, 14, 33), detail: (me) => inReview(me, { review_lock_expires_at: sep(28, 14, 32) }) });
    await expect(page.getByText('Your claim ended at').first()).toBeVisible();
    await capture(page, { 1440: 'admin/rider-onboarding/DetailLockLost' });
  });

  test('offline mid-review', async ({ page }) => {
    await openApp(page, { detail: (me) => inReview(me) });
    await answerAll(page, 'Passes', {}, { 2: 'Plate matches on page 1.', 3: 'Page 2 lists commercial and delivery use as covered.' });
    await page.context().setOffline(true);
    await expect(page.getByText('You’re offline. Nothing can be recorded until the connection returns.').first()).toBeVisible();
    await capture(page, { 1440: 'admin/rider-onboarding/DetailOffline' });
  });

  test('every check passes, Approve document on', async ({ page }) => {
    await openApp(page, { detail: (me) => inReview(me) });
    await answerAll(page, 'Passes', {}, { 2: 'Plate matches on page 1.', 3: 'Page 2 lists commercial and delivery use as covered.' });
    await expect(page.getByRole('button', { name: 'Approve document', exact: true })).toBeEnabled();
    await capture(page, { 1440: 'admin/rider-onboarding/DetailChecksPass' });
  });

  test('a check fails: commercial use excluded', async ({ page }) => {
    await openApp(page, { detail: (me) => inReview(me) });
    await answerAll(page, 'Passes', { 3: 'Fails' }, { 2: 'Plate matches on page 1.', 3: 'Page 2, section 4 excludes commercial and delivery use.' });
    await capture(page, { 1440: 'admin/rider-onboarding/DetailChecksFail' });
  });

  test('the authenticity check fails', async ({ page }) => {
    await openApp(page, { detail: (me) => inReview(me) });
    await answerAll(page, 'Passes', { 1: 'Fails' }, { 1: 'Expiry date digits don’t match the font of the rest of the page.' });
    await capture(page, { 1440: 'admin/rider-onboarding/DetailChecksForgery' });
  });

  // ── the document card ──────────────────────────────────────────────────────

  /** Opens the application with the insurance checks all answered, as the document boards draw them. */
  async function answeredInsurance(page: Page, live: Live, how: Parameters<typeof reviewing>[1] = 'ok') {
    await openApp(page, { detail: (me) => (live.app ??= inReview(me)), review: reviewing(live, how) });
    await answerAll(page, 'Passes', {}, { 2: 'Plate matches on page 1.', 3: 'Page 2 lists commercial and delivery use as covered.' });
  }
  const approveDocument = (page: Page) => page.getByRole('button', { name: 'Approve document', exact: true }).click();

  test('document approved, the viewer moves on', async ({ page }) => {
    await answeredInsurance(page, {});
    await approveDocument(page);
    await expect(page.getByRole('heading', { name: 'Work eligibility · version 1' }).first()).toBeVisible();
    await expect(page.getByTestId('hg-toast').getByText('Vehicle insurance approved')).toBeVisible();
    await capture(page, { 1440: 'admin/rider-onboarding/DetailDocApproved' });
  });

  test('document approving, not answered yet', async ({ page }) => {
    await answeredInsurance(page, {}, 'never');
    await approveDocument(page);
    await capture(page, { 1440: 'admin/rider-onboarding/DetailDocSubmitting' }, { settled: false });
  });

  test('document approve failed, answers kept', async ({ page }) => {
    await answeredInsurance(page, {}, 'error');
    await approveDocument(page);
    await expect(page.getByText('Nothing was recorded. Your answers are kept.')).toBeVisible();
    await capture(page, { 1440: 'admin/rider-onboarding/DetailDocFailed' });
  });

  test('claim lost while approving a document', async ({ page }) => {
    const live: Live = {};
    await answeredInsurance(page, live, { status: 409, code: 'REVIEW_LOCK_LOST', then: (app) => void (app.review_lock_expires_at = sep(28, 14, 32)) });
    await approveDocument(page);
    await expect(page.getByText('Your claim ended').first()).toBeVisible();
    await capture(page, { 1440: 'admin/rider-onboarding/DetailDocLockLost' });
  });

  test('role changed mid-claim (403 on review)', async ({ page }) => {
    await answeredInsurance(page, {}, { status: 403, code: 'FORBIDDEN' });
    await approveDocument(page);
    await expect(page.getByText('You can no longer decide rider applications. Nothing was recorded.')).toBeVisible();
    await capture(page, { 1440: 'admin/rider-onboarding/DetailDecide403' });
  });

  test('document replaced while open (404)', async ({ page }) => {
    await answeredInsurance(page, {}, {
      status: 404,
      code: 'NOT_FOUND',
      then: (app) => {
        const old = (app.documents as Json[]).find((d) => d.doc_type === 'VEHICLE_INSURANCE' && d.version === 2)!;
        old.state = 'SUPERSEDED';
        app.documents.push({ ...doc(FATIMA.id, { type: 'VEHICLE_INSURANCE', state: 'SUBMITTED', version: 3, valid: '2027-08-31' }) });
      },
    });
    await approveDocument(page);
    await expect(page.getByText('This document was replaced or removed')).toBeVisible();
    await capture(page, { 1440: 'admin/rider-onboarding/DetailDoc404' });
  });

  test('document rejected, the viewer moves on', async ({ page }) => {
    const live: Live = {};
    await openApp(page, { detail: (me) => (live.app ??= inReview(me)), review: reviewing(live) });
    await answerAll(page, 'Passes', { 0: 'Fails' }, { 0: 'Page 2 missing.' });
    await page.getByRole('button', { name: 'Reject document' }).click();
    await choose(page, /Reason/, 'Pages missing');
    await page.getByTestId('DocumentRejectPanel').getByRole('button', { name: 'Reject document', exact: true }).click();
    await expect(page.getByTestId('hg-toast').getByText('Vehicle insurance rejected')).toBeVisible();
    await capture(page, { 1440: 'admin/rider-onboarding/DetailDocRejected' });
  });

  test('insurance approved with the commercial-use confirmation', async ({ page }) => {
    const docs = withState(motorisedDocs(FATIMA.id), 'VEHICLE_INSURANCE', { state: 'APPROVED' });
    await openApp(page, { detail: (me) => inReview(me, { blockers: [TWO_ONLY] }, docs) });
    await openDoc(page, /Open Vehicle insurance/);
    await expect(page.getByRole('heading', { name: 'Vehicle insurance · version 2' }).last()).toBeVisible();
    await capture(page, { 1440: 'admin/rider-onboarding/DetailInsuranceApproved' });
  });

  test('insurance rejected, commercial use excluded', async ({ page }) => {
    const docs = withState(motorisedDocs(FATIMA.id), 'VEHICLE_INSURANCE', { state: 'REJECTED', rejection_reason_code: 'OTHER', review_note: 'Page 2, section 4 excludes commercial and delivery use.' });
    await openApp(page, { detail: (me) => inReview(me, { blockers: ['Vehicle insurance is rejected', 'Work eligibility isn’t approved yet'] }, docs) });
    await openDoc(page, /Open Vehicle insurance/);
    await expect(page.getByText('Rejected: Other')).toBeVisible();
    await capture(page, { 1440: 'admin/rider-onboarding/DetailInsuranceRejected' });
  });

  test('last document approved, focus on Approve rider', async ({ page }) => {
    const live: Live = {};
    const docs = withState(allApproved(motorisedDocs(FATIMA.id)), 'WORK_ELIGIBILITY', { state: 'IN_REVIEW' });
    await openApp(page, { detail: (me) => (live.app ??= inReview(me, { blockers: ['Work eligibility isn’t approved yet'] }, docs)), review: reviewing(live) });
    await answerAll(page, 'Passes', { 3: 'Doesn’t apply' });
    await approveDocument(page);
    await expect(page.getByRole('button', { name: 'Approve rider' })).toBeFocused();
    await capture(page, { 1440: 'admin/rider-onboarding/DetailLastDocApproveOn' });
  });

  test('driver’s licence, full checklist answered', async ({ page }) => {
    const docs = withState(withState(motorisedDocs(FATIMA.id), 'DRIVERS_LICENCE', { state: 'IN_REVIEW', version: 2 }), 'VEHICLE_INSURANCE', { state: 'SUBMITTED' });
    await openApp(page, { detail: (me) => inReview(me, { blockers: ['Driver’s licence isn’t approved yet', ONE, TWO] }, docs) });
    await openDoc(page, /Open Driver’s licence/);
    await answerAll(page);
    await capture(page, { 1440: 'admin/rider-onboarding/DetailLicence' });
  });

  test('driver’s licence, class fails for a motorcycle rider', async ({ page }) => {
    await openApp(page, { detail: (me) => hafsa(me) }, HAFSA.id);
    await expect(page.getByRole('heading', { name: 'Driver’s licence · version 1' }).last()).toBeVisible();
    await answerAll(page, 'Passes', { 3: 'Fails' }, { 3: 'The licence shows class G only. A motorcycle needs M or M2.' });
    await capture(page, { 1440: 'admin/rider-onboarding/DetailLicenceClassFail' });
  });

  test('vehicle registration, owner consent does not apply', async ({ page }) => {
    await openApp(page, { detail: (me) => registration(me) });
    await openDoc(page, /Open Vehicle registration/);
    await answerAll(page, 'Passes', { 4: 'Doesn’t apply' });
    await capture(page, { 1440: 'admin/rider-onboarding/DetailRegistration' });
  });

  test('vehicle registration, plate does not match', async ({ page }) => {
    await openApp(page, { detail: (me) => registration(me) });
    await openDoc(page, /Open Vehicle registration/);
    await answerAll(page, 'Passes', { 2: 'Fails', 4: 'Doesn’t apply' }, { 2: 'The registration reads CKRT 428.' });
    await capture(page, { 1440: 'admin/rider-onboarding/DetailRegistrationPlateMismatch' });
  });

  test('work eligibility, citizen, expiry does not apply', async ({ page }) => {
    const docs = withState(withState(motorisedDocs(FATIMA.id), 'VEHICLE_INSURANCE', { state: 'APPROVED' }), 'WORK_ELIGIBILITY', { state: 'IN_REVIEW', valid_until: '2032-05-04' });
    await openApp(page, { detail: (me) => inReview(me, { blockers: [TWO_ONLY] }, docs) });
    await answerAll(page, 'Passes', { 3: 'Doesn’t apply' }, { 2: 'Canadian passport on the scan, name and photo match.' });
    await capture(page, { 1440: 'admin/rider-onboarding/DetailWorkEligibilityCitizen' });
  });

  // ── other riders ───────────────────────────────────────────────────────────

  test('bicycle rider', async ({ page }) => {
    await openApp(page, { detail: (me) => maryam(me) }, MARYAM.id);
    await answerAll(page, 'Passes', { 3: 'Doesn’t apply' }, { 2: 'Canadian passport on the scan, name and photo match.' });
    await capture(page, { 1440: 'admin/rider-onboarding/DetailBicycle' });
  });

  test('under 18: the ID gives age 17 and fails the date-of-birth check', async ({ page }) => {
    await openApp(page, { detail: (me) => yusuf(me) }, YUSUF.id);
    await answerAll(page, 'Passes', {}, {});
    await capture(page, { 1440: 'admin/rider-onboarding/DetailUnder18' });
  });

  test('under 18: the ID is rejected for its date of birth', async ({ page }) => {
    await openApp(page, { detail: (me) => yusuf(me, true) }, YUSUF.id);
    await openDoc(page, /Open Government ID/);
    await expect(page.getByText('Rejected: Date of birth doesn’t match').first()).toBeVisible();
    await capture(page, { 1440: 'admin/rider-onboarding/DetailUnder18IdApproved' });
  });

  test('on foot, age from an ID not yet approved', async ({ page }) => {
    await openApp(page, { detail: (me) => omar(me) }, OMAR.id);
    await capture(page, { 1440: 'admin/rider-onboarding/DetailOnFootAgeNotComputed' });
  });

  test('documents expired, superseded and under 14 days', async ({ page }) => {
    const docs = [
      doc(FATIMA.id, { type: 'DRIVERS_LICENCE', state: 'EXPIRED', version: 2, valid: '2026-09-27' }),
      doc(FATIMA.id, { type: 'VEHICLE_REGISTRATION', state: 'APPROVED', valid: '2027-02-02' }),
      doc(FATIMA.id, { type: 'VEHICLE_INSURANCE', state: 'IN_REVIEW', version: 2, valid: '2026-10-07' }),
      doc(FATIMA.id, { type: 'WORK_ELIGIBILITY', state: 'APPROVED', valid: '2028-07-15' }),
      doc(FATIMA.id, { type: 'PROFILE_PHOTO', state: 'APPROVED', valid: null }),
    ];
    await openApp(page, { detail: (me) => inReview(me, { blockers: ['Vehicle insurance expires in 9 days (needs 14 or more)', 'Driver’s licence expired on 27 September 2026'] }, docs) });
    await expect(page.getByText('Under 14 days left')).toBeVisible();
    await capture(page, { 1440: 'admin/rider-onboarding/DetailDocHistory' });
  });

  test('Active, decided, read only', async ({ page }) => {
    await openApp(page, { detail: () => yahya() }, YAHYA.id);
    await openDoc(page, /Open Vehicle insurance/);
    await expect(page.getByText('Active. Nothing here can be changed.')).toBeVisible();
    await capture(page, { 1440: 'admin/rider-onboarding/DetailActive' });
  });

  test('Payout pending, decided, read only', async ({ page }) => {
    await openApp(page, { detail: () => noura() }, NOURA.id);
    await openDoc(page, /Open Work eligibility/);
    await expect(page.getByText('Approved, waiting for payouts. Nothing to decide here.')).toBeVisible();
    await capture(page, { 1440: 'admin/rider-onboarding/DetailPayoutPending' });
  });

  test('review target missed', async ({ page }) => {
    await openApp(page, { detail: (me) => musa(me) }, MUSA.id);
    await capture(page, { 1440: 'admin/rider-onboarding/DetailTargetMissed' });
  });

  test('Take next claimed a different application', async ({ page }) => {
    await openApp(page, {
      detail: (me, id) => (id === MARYAM.id ? maryam(me, sep(28, 15, 32)) : inReview('', { assigned_admin_id: null, review_lock_expires_at: null })),
      take: (me) => maryam(me, sep(28, 15, 32)),
    });
    await page.getByRole('button', { name: 'Take next' }).first().click();
    await expect(page.getByRole('heading', { name: 'Maryam Hassan', level: 2 })).toBeVisible();
    await capture(page, { 1440: 'admin/rider-onboarding/DetailSwitched' });
  });

  test('rider ID copied', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await openApp(page, { detail: (me) => inReview(me) });
    await page.getByRole('button', { name: 'Copy rider ID' }).click();
    await expect(page.getByTestId('hg-toast').getByText('ID copied')).toBeVisible();
    await capture(page, { 1440: 'admin/rider-onboarding/DetailCopied' });
  });

  // ── the viewer ─────────────────────────────────────────────────────────────

  test('getting a document link', async ({ page }) => {
    await openApp(page, { detail: (me) => inReview(me), link: 'loading' });
    await capture(page, { 1440: 'admin/rider-onboarding/DetailLinkLoading' }, { settled: false });
  });

  test('document link refused (403)', async ({ page }) => {
    await openApp(page, { detail: (me) => inReview(me), link: 'forbidden' });
    await capture(page, { 1440: 'admin/rider-onboarding/DetailLinkFailed' });
  });

  test('document link expired', async ({ page }) => {
    await openApp(page, { detail: (me) => inReview(me), link: 'expired' });
    await capture(page, { 1440: 'admin/rider-onboarding/DetailLinkExpired' });
  });

  test('file can’t be shown', async ({ page }) => {
    await openApp(page, { detail: (me) => inReview(me), scan: 'broken' });
    await capture(page, { 1440: 'admin/rider-onboarding/DetailViewerUnreadable' });
  });

  test('viewer at 200 %, rotated', async ({ page }) => {
    await openApp(page, { detail: (me) => inReview(me) });
    for (let i = 0; i < 4; i += 1) await page.getByRole('button', { name: 'Zoom in' }).click();
    await page.getByRole('button', { name: 'Rotate' }).click();
    await capture(page, { 1440: 'admin/rider-onboarding/DetailZoomed' });
  });
});
