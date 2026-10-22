import { expect, test, type Page, type Route } from '@playwright/test';

import { expectDesign } from './design';
import { E2E_MODE } from './mode';
import type { Json } from './redesign-admin.rider-onboarding.scene';
import {
  ALL_RECORDED,
  appWith,
  approvedCert,
  arrive,
  capture,
  checksOf,
  choose,
  karahiApp,
  karahiCert,
  KARAHI,
  noorApp,
  noorCert,
  NOOR,
  openAt,
  OTHER_REVIEWER,
  refuse,
  sep,
  untranscribedCert,
  ZAYTOUN,
  type Ctx,
  type Scene,
} from './redesign-admin.verification.scene';

test.skip(E2E_MODE !== 'mock', 'written against the mock server; run with E2E_MODE=mock');

/**
 * The redesigned admin console's halal verification console (`#/certificates/:id`: the scan, the
 * transcription beside the application's facts, the seven checks and the decision bar), each state
 * captured for the design board it must match (tools/e2e/README.md, "Design captures"). Mock
 * mode: the calls are answered with `page.route` (see redesign-admin.verification.scene.ts),
 * which is the only way to give the stateless mock a claim held by the signed-in reviewer, a
 * certificate with a given set of checks recorded, or a ruling the server refuses.
 *
 * Boards are drawn at 1440 wide; the two narrow ones (1280 and 720) are taken by resizing the
 * page, so the tablet project takes no capture.
 *
 * Board ids are written out in full on purpose: tools/e2e/web/check-boards.mjs validates only
 * literal ids.
 */
const BASE = process.env.E2E_ADMIN_REDESIGN_URL ?? process.env.BASE_URL;
if (BASE) test.use({ baseURL: BASE });

const never = () => new Promise<void>(() => undefined);

/** The note the boards draw on the address check, an override of the system's suggestion. */
const OVERRIDE_NOTE = 'Same premises: Scarborough is part of Toronto and Kennedy Road is written out in full. Unit and postal code match. Page 1.';

/** All seven recorded, with the address check an override of the suggestion, as the "all pass" board draws it. */
const allChecks = (over: Parameters<typeof checksOf>[1] = {}) =>
  checksOf(ALL_RECORDED, { H4_ADDRESS_MATCH: { result: 'PASS', computed: 'FAIL', note: OVERRIDE_NOTE }, ...over });

/** Four checks recorded and Unique, not reused still not assessed: the page the server's refusals say is out of date. */
const unsettled = () =>
  checksOf(['H1_LEGIBLE_COMPLETE', 'H2_ISSUER_ACCEPTED', 'H3_NAME_MATCH', 'H5_DATES_VALID'], { H7_UNIQUE_NOT_REUSED: { result: 'NOT_ASSESSED', computed: 'NOT_ASSESSED' } });

/** The certificate whose issuer the registry has suspended (H2 locked). */
const SUSPENDED = {
  id: '0192f4b0-5e61-7a02-b3c9-0f1e2d3c4b5a',
  name: 'Halal Food Standards Alliance of America (HFSAA)',
  aliases: ['HFSAA'],
  country: 'US',
  region: null,
  website: null,
  accreditation_ref: null,
  requires_issuer_confirmation: false,
  status: 'SUSPENDED',
  notes: null,
};

/** The certificate and the application it belongs to, for a console scene. */
function scene(cert: (c: Ctx) => Json, appOver: Json | ((c: Ctx) => Json) = {}, rest: Scene = {}): Scene {
  return {
    cert,
    app: (c) => appWith(c, cert(c), typeof appOver === 'function' ? appOver(c) : appOver),
    ...rest,
  };
}

/** Opens the console on the certificate and waits for it. */
async function openConsole(page: Page, s: Scene, certId: string = KARAHI.certId) {
  await arrive(page, s);
  await openAt(page, `#/certificates/${certId}`);
  await expect(page.getByTestId('CertificateConsole')).toBeVisible();
}

const checks = (page: Page) => expect(page.getByText('Step 2: The seven checks')).toBeVisible();
/** The decision bar: the checks pane repeats some of its words, so its buttons are asked for here. */
const bar = (page: Page) => page.getByTestId('DecisionBar');
const row = (page: Page, code: string) => page.locator(`[data-check="${code}"]`);

/** Chooses Pass for the address check against the system's suggestion, which opens its note. */
async function passAddress(page: Page) {
  await row(page, 'H4').getByRole('radio', { name: 'Pass' }).check();
  await expect(row(page, 'H4').getByLabel(/Note for Address match/)).toBeVisible();
}

test.describe('redesigned admin · halal verification console (mock)', () => {
  test.use({ colorScheme: 'light' });

  // Every board of the area is drawn at 1440 wide, and the panes a panel squeezes at 1024 are a
  // finding of their own, not this spec's: the desktop project takes the captures.
  test.skip(({ viewport }) => viewport?.width !== 1440, 'the verification boards are drawn at 1440 wide');

  // ── the page ────────────────────────────────────────────────────────────────

  test('claimed by you, transcribed, five of seven checks recorded', async ({ page }) => {
    await openConsole(page, scene((c) => karahiCert(c)));
    await checks(page);
    await capture(page, { 1440: 'admin/restaurant-verification/Verify' });
  });

  for (const [width, board] of [
    [1280, 'admin/restaurant-verification/Verify-1280'],
    [720, 'admin/restaurant-verification/Verify-Zoom200'],
  ] as const) {
    test(`${width} px`, async ({ page }, info) => {
      test.skip(info.project.metadata.viewport !== 'desktop', 'drawn at its own width: taken once, by the desktop project');
      await page.setViewportSize({ width, height: 900 });
      await openConsole(page, scene((c) => karahiCert(c)));
      await checks(page);
      await page.waitForLoadState('networkidle');
      await expect(page.getByText('Not built yet')).toHaveCount(0);
      await expectDesign(page, board);
    });
  }

  test('loading', async ({ page }) => {
    await arrive(page, { cert: 'never' });
    await openAt(page, `#/certificates/${KARAHI.certId}`);
    await expect(page.getByTestId('ConsoleLoading')).toBeVisible();
    await capture(page, { 1440: 'admin/restaurant-verification/Verify-Loading' }, { settled: false });
  });

  test('not found', async ({ page }) => {
    await arrive(page, { cert: 'notfound' });
    await openAt(page, `#/certificates/${KARAHI.certId}`);
    await expect(page.getByText('This certificate doesn’t exist')).toBeVisible();
    await capture(page, { 1440: 'admin/restaurant-verification/Verify-NotFound' });
  });

  test('the certificate does not load', async ({ page }) => {
    await arrive(page, { cert: 'error' });
    await openAt(page, `#/certificates/${KARAHI.certId}`);
    await expect(page.getByText('The certificate didn’t load')).toBeVisible();
    await capture(page, { 1440: 'admin/restaurant-verification/Verify-PageError' });
  });

  test('no certificate document', async ({ page }) => {
    await openConsole(page, scene((c) => untranscribedCert(c, { document_id: null })));
    await expect(page.getByText('Nothing to transcribe')).toBeVisible();
    await capture(page, { 1440: 'admin/restaurant-verification/Verify-NoDocument' });
  });

  // ── step 1: the transcription ───────────────────────────────────────────────

  test('nothing typed in yet', async ({ page }) => {
    await openConsole(page, scene((c) => untranscribedCert(c)));
    await expect(page.getByText('Step 2 opens after step 1')).toBeVisible();
    await capture(page, { 1440: 'admin/restaurant-verification/Verify-Start' });
  });

  test('the issuing body list is open', async ({ page }) => {
    await openConsole(page, scene((c) => untranscribedCert(c)));
    await expect(page.getByText('Step 2 opens after step 1')).toBeVisible();
    await page.getByRole('combobox', { name: /^Issuing body/ }).first().click();
    await expect(page.getByRole('listbox')).toBeVisible();
    await capture(page, { 1440: 'admin/restaurant-verification/Verify-IssuerList' });
  });

  test('propose an issuing body', async ({ page }) => {
    await openConsole(page, scene((c) => untranscribedCert(c)));
    await page.getByRole('button', { name: 'Propose an issuing body' }).click();
    await expect(page.getByTestId('ProposeIssuer')).toBeVisible();
    await capture(page, { 1440: 'admin/restaurant-verification/Verify-Propose' });
  });

  test('propose an issuing body that is already in the registry', async ({ page }) => {
    await openConsole(page, {
      ...scene((c) => untranscribedCert(c)),
      propose: (route) => refuse(route, 409, 'ALREADY_EXISTS', 'This issuing body already exists.'),
    });
    await page.getByRole('button', { name: 'Propose an issuing body' }).click();
    const form = page.getByTestId('ProposeIssuer');
    await form.getByLabel(/^Name, as printed on the certificate/).fill('HCCO');
    await form.getByLabel(/^Why HalalGoes should consider it/).fill('HCCO certifies kitchens across Ontario and issued this certificate. Please consider adding it to the registry.');
    await form.getByRole('button', { name: 'Send for review' }).click();
    await expect(form.getByText('This issuing body is already in the registry')).toBeVisible();
    await capture(page, { 1440: 'admin/restaurant-verification/Verify-ProposeDuplicate' });
  });

  // ── step 2: the checks ──────────────────────────────────────────────────────

  test('an issuer the registry has suspended', async ({ page }) => {
    const cert = (c: Ctx) =>
      karahiCert(c, {
        certificate_number: 'HFSAA-2026-3310',
        issuing_body: SUSPENDED,
        checks: allChecks({ H2_ISSUER_ACCEPTED: { result: 'FAIL', computed: 'FAIL' } }),
      });
    await openConsole(page, scene(cert));
    await checks(page);
    await expect(page.getByText(/Pass isn’t offered/).first()).toBeVisible();
    await capture(page, { 1440: 'admin/restaurant-verification/Verify-H2Locked' });
  });

  test('a scope that is the supplier chain only', async ({ page }) => {
    const cert = (c: Ctx) => karahiCert(c, { scope: 'SUPPLIER_CHAIN_ONLY', checks: allChecks({ H6_SCOPE_SUFFICIENT: { result: 'FAIL', computed: 'FAIL' } }) });
    await openConsole(page, scene(cert));
    await checks(page);
    await expect(page.getByText(/Pass isn’t offered/).first()).toBeVisible();
    await capture(page, { 1440: 'admin/restaurant-verification/Verify-H6Locked' });
  });

  test('a result against the suggestion needs a note', async ({ page }) => {
    await openConsole(page, scene((c) => karahiCert(c)));
    await checks(page);
    await passAddress(page);
    await capture(page, { 1440: 'admin/restaurant-verification/Verify-OverrideNote' });
  });

  test('recording a check', async ({ page }) => {
    await openConsole(page, scene((c) => karahiCert(c), {}, { record: never }));
    await checks(page);
    await passAddress(page);
    await row(page, 'H4').getByLabel(/Note for Address match/).fill(OVERRIDE_NOTE);
    const asked = page.waitForRequest((request) => request.url().endsWith('/checks'));
    await row(page, 'H4').getByRole('button', { name: /^Record Address match/ }).click();
    await asked;
    await capture(page, { 1440: 'admin/restaurant-verification/Verify-Saving' }, { settled: false });
  });

  test('a check that was not recorded', async ({ page }) => {
    await openConsole(page, scene((c) => karahiCert(c), {}, { record: (route) => route.abort('internetdisconnected') }));
    await checks(page);
    await passAddress(page);
    await row(page, 'H4').getByLabel(/Note for Address match/).fill(OVERRIDE_NOTE);
    await row(page, 'H4').getByRole('button', { name: /^Record Address match/ }).click();
    await expect(page.getByText('H4 Address match wasn’t recorded')).toBeVisible();
    await capture(page, { 1440: 'admin/restaurant-verification/Verify-SaveFailed' });
  });

  test('the server refuses the note', async ({ page }) => {
    const refusal = (route: Route) => refuse(route, 422, 'VALIDATION_FAILED', 'The note is too short.', [{ field: 'note', code: 'TOO_SHORT', message: 'The note is too short.' }]);
    await openConsole(page, scene((c) => karahiCert(c), {}, { record: refusal }));
    await checks(page);
    await passAddress(page);
    await row(page, 'H4').getByLabel(/Note for Address match/).fill('Same building, page 1');
    await row(page, 'H4').getByRole('button', { name: /^Record Address match/ }).click();
    await expect(page.getByText(/The server refused a shorter note/)).toBeVisible();
    await capture(page, { 1440: 'admin/restaurant-verification/Verify-Override422' });
  });

  test('the page was out of date: the server will not override a computed check', async ({ page }) => {
    const refusal = (route: Route) => refuse(route, 409, 'CHECK_NOT_OVERRIDABLE', 'H5 and H7 are computed by the server and cannot be overridden.', { check_key: 'H7_UNIQUE_NOT_REUSED', computed: 'PASS' });
    const cert = (c: Ctx) => karahiCert(c, { checks: unsettled() });
    await openConsole(page, scene(cert, {}, { record: refusal }));
    await checks(page);
    await row(page, 'H6').getByRole('radio', { name: 'Pass' }).check();
    await row(page, 'H6').getByRole('button', { name: /^Record Scope sufficient/ }).click();
    await expect(page.getByText('This page was out of date')).toBeVisible();
    await capture(page, { 1440: 'admin/restaurant-verification/Verify-Errors' });
  });

  // ── step 3: deciding ────────────────────────────────────────────────────────

  test('approve, all seven pass', async ({ page }) => {
    await openConsole(page, scene((c) => karahiCert(c, { checks: allChecks() })));
    await expect(page.getByText('All seven checks pass. You can approve the certificate.')).toBeVisible();
    await bar(page).getByRole('button', { name: 'Approve…' }).click();
    await expect(page.getByRole('region', { name: 'Approve this halal certificate?' })).toBeVisible();
    await capture(page, { 1440: 'admin/restaurant-verification/Verify-Approve' });
  });

  test('approved', async ({ page }) => {
    const live: { cert?: Json } = {};
    await openConsole(
      page,
      scene((c) => live.cert ?? karahiCert(c, { checks: allChecks() }), {}, {
        ruling: (route, c) => {
          live.cert = approvedCert(c);
          return route.fulfill({ json: { data: live.cert } });
        },
      }),
    );
    await bar(page).getByRole('button', { name: 'Approve…' }).click();
    await page.getByRole('region', { name: 'Approve this halal certificate?' }).getByRole('button', { name: 'Approve certificate' }).click();
    await expect(page.getByText('Certificate approved').first()).toBeVisible();
    await capture(page, { 1440: 'admin/restaurant-verification/Verify-Approved' });
  });

  test('approved, as a super admin finds it', async ({ page }) => {
    await openConsole(page, scene((c) => approvedCert(c), { assigned_admin_id: OTHER_REVIEWER }, { role: 'SUPER_ADMIN' }));
    await expect(page.getByRole('button', { name: 'Revoke certificate…' })).toBeVisible();
    await capture(page, { 1440: 'admin/restaurant-verification/Verify-ApprovedSuper' });
  });

  test('approval refused: the checklist is incomplete', async ({ page }) => {
    const live: { cert?: Json } = {};
    await openConsole(
      page,
      scene((c) => live.cert ?? karahiCert(c, { checks: allChecks() }), {}, {
        ruling: (route, c) => {
          live.cert = karahiCert(c, { checks: unsettled() });
          return refuse(route, 422, 'CHECKLIST_INCOMPLETE', 'The seven checks are not all present and PASS.', {
            check_keys: ['H4_ADDRESS_MATCH', 'H6_SCOPE_SUFFICIENT', 'H7_UNIQUE_NOT_REUSED'],
          });
        },
      }),
    );
    await bar(page).getByRole('button', { name: 'Approve…' }).click();
    await page.getByRole('region', { name: 'Approve this halal certificate?' }).getByRole('button', { name: 'Approve certificate' }).click();
    await expect(page.getByText('Not approved: 3 checks aren’t Pass')).toBeVisible();
    await capture(page, { 1440: 'admin/restaurant-verification/Verify-Incomplete' });
  });

  test('approval refused: a computed check failed when the server checked again', async ({ page }) => {
    const live: { cert?: Json } = {};
    await openConsole(
      page,
      scene((c) => live.cert ?? karahiCert(c, { checks: allChecks() }), {}, {
        ruling: (route, c) => {
          live.cert = karahiCert(c, { expires_on: '2026-10-14', checks: allChecks({ H5_DATES_VALID: { result: 'FAIL', computed: 'FAIL' } }) });
          return refuse(route, 422, 'CHECK_FAILED', 'The seven checks are not all present and PASS.', { check_keys: ['H5_DATES_VALID'] });
        },
      }),
    );
    await bar(page).getByRole('button', { name: 'Approve…' }).click();
    await page.getByRole('region', { name: 'Approve this halal certificate?' }).getByRole('button', { name: 'Approve certificate' }).click();
    await expect(page.getByText(/failed when the server checked again/)).toBeVisible();
    await capture(page, { 1440: 'admin/restaurant-verification/Verify-CheckFailed' });
  });

  // ── rejecting ───────────────────────────────────────────────────────────────

  /** A certificate with one check recorded as Fail, the rest Pass, and the opening message the board draws. */
  const withFail = (over: Json, failed: Parameters<typeof checksOf>[1]) => (c: Ctx) => karahiCert(c, { ...over, checks: allChecks(failed) });

  const REJECTIONS = [
    {
      name: 'the scope does not cover the restaurant',
      cert: withFail({ scope: 'SUPPLIER_CHAIN_ONLY' }, { H6_SCOPE_SUFFICIENT: { result: 'FAIL', computed: 'FAIL' } }),
      message: 'Your certificate covers your meat supplier only. Please upload a certificate that covers your kitchen or the whole restaurant.',
      board: 'admin/restaurant-verification/Verify-Reject',
    },
    {
      name: 'the issuer is not accepted',
      cert: withFail({ certificate_number: 'HFSAA-2026-3310', issuing_body: SUSPENDED }, { H2_ISSUER_ACCEPTED: { result: 'FAIL', computed: 'FAIL' } }),
      message: 'We can’t currently accept certificates from HFSAA. Please upload a certificate from an accepted issuing body, such as HMA Canada or ISNA Canada.',
      board: 'admin/restaurant-verification/Verify-RejectH2',
    },
    {
      name: 'the dates are not valid',
      cert: withFail({ expires_on: '2026-10-14' }, { H5_DATES_VALID: { result: 'FAIL', computed: 'FAIL' } }),
      message: 'Your halal certificate expires on 14 October 2026, too soon for us to approve it. Please upload your renewed certificate.',
      board: 'admin/restaurant-verification/Verify-RejectH5',
    },
    {
      name: 'the number is already used',
      cert: withFail({}, { H7_UNIQUE_NOT_REUSED: { result: 'FAIL', computed: 'FAIL' } }),
      message: 'This certificate number is already registered to another restaurant on HalalGoes. Please upload the certificate issued to Karahi House Restaurant Inc.',
      board: 'admin/restaurant-verification/Verify-RejectH7',
    },
  ] as const;

  for (const rejection of REJECTIONS) {
    test(`reject: ${rejection.name}`, async ({ page }) => {
      await openConsole(page, scene(rejection.cert));
      await checks(page);
      await bar(page).getByRole('button', { name: 'Reject…' }).click();
      const panel = page.getByRole('region', { name: 'Reject this certificate?' });
      await expect(panel).toBeVisible();
      await panel.getByLabel(/^Message to the restaurant/).fill(rejection.message);
      await capture(page, { 1440: rejection.board });
    });
  }

  test('rejected', async ({ page }) => {
    const live: { cert?: Json } = {};
    const cert = withFail({ scope: 'SUPPLIER_CHAIN_ONLY' }, { H6_SCOPE_SUFFICIENT: { result: 'FAIL', computed: 'FAIL' } });
    await openConsole(
      page,
      scene((c) => live.cert ?? cert(c), {}, {
        ruling: (route, c) => {
          live.cert = { ...cert(c), status: 'REJECTED', rejection_reason_code: 'SCOPE_INSUFFICIENT', rejection_reason_text: 'Your certificate covers your meat supplier only.' };
          return route.fulfill({ json: { data: live.cert } });
        },
      }),
    );
    await bar(page).getByRole('button', { name: 'Reject…' }).click();
    const panel = page.getByRole('region', { name: 'Reject this certificate?' });
    await panel.getByLabel(/^Message to the restaurant/).fill('Your certificate covers your meat supplier only. Please upload a certificate that covers your kitchen or the whole restaurant.');
    await panel.getByRole('button', { name: 'Reject certificate' }).click();
    await expect(page.getByText('Karahi House’s application still needs a decision').first()).toBeVisible();
    await capture(page, { 1440: 'admin/restaurant-verification/Verify-Rejected' });
  });

  test('ask the restaurant for a new certificate', async ({ page }) => {
    await openConsole(page, scene((c) => karahiCert(c)));
    await checks(page);
    await bar(page).getByRole('button', { name: 'Ask for a new certificate…' }).click();
    const panel = page.getByRole('region', { name: /^Request changes from Karahi House/ });
    await expect(panel).toBeVisible();
    await panel.getByLabel(/^Message to the restaurant/).fill('Please upload a clearer scan of your halal certificate. Page 2 is cut off at the bottom.');
    await capture(page, { 1440: 'admin/restaurant-verification/Verify-RequestChanges' });
  });

  // ── who holds the application ───────────────────────────────────────────────

  test('inspecting a certificate nobody has claimed', async ({ page }) => {
    await openConsole(page, scene((c) => karahiCert(c), { assigned_admin_id: null, review_lock_expires_at: null }));
    await expect(page.getByText('Not claimed · You are inspecting')).toBeVisible();
    await capture(page, { 1440: 'admin/restaurant-verification/Verify-Inspect' });
  });

  test('a pending certificate nobody has claimed, opened from another restaurant', async ({ page }) => {
    const cert = (c: Ctx) =>
      karahiCert(c, {
        id: ZAYTOUN.certId,
        restaurant_id: ZAYTOUN.id,
        certificate_number: 'HMA-ON-2026-0533',
        certified_legal_name: 'Zaytoun Grill Ltd.',
        certified_address: '8 Queen Street East, Unit 2, Brampton ON L6V 1A2',
        issued_on: '2026-03-31',
        expires_on: '2027-03-30',
        checks: checksOf(['H1_LEGIBLE_COMPLETE', 'H2_ISSUER_ACCEPTED', 'H3_NAME_MATCH']),
      });
    await openConsole(
      page,
      scene(cert, (c) => ({
        restaurant_id: ZAYTOUN.id,
        display_name: 'Zaytoun Grill',
        assigned_admin_id: null,
        review_lock_expires_at: null,
        profile: { ...karahiApp(c).profile, id: ZAYTOUN.id, legal_name: 'Zaytoun Grill Ltd.', display_name: 'Zaytoun Grill' },
      })),
      ZAYTOUN.certId,
    );
    await expect(page.getByText('Not claimed · You are inspecting')).toBeVisible();
    await capture(page, { 1440: 'admin/restaurant-verification/Verify-Unclaimed' });
  });

  test('claimed by another reviewer', async ({ page }) => {
    await openConsole(
      page,
      scene((c) => karahiCert(c, { checks: checksOf(['H1_LEGIBLE_COMPLETE', 'H2_ISSUER_ACCEPTED', 'H3_NAME_MATCH']) }), { assigned_admin_id: OTHER_REVIEWER, review_lock_expires_at: sep(28, 14, 32) }),
    );
    await expect(page.getByText(/Another reviewer holds this until 2:32 pm/)).toBeVisible();
    await capture(page, { 1440: 'admin/restaurant-verification/Verify-OtherReviewer' });
  });

  test('your claim ended', async ({ page }) => {
    await openConsole(page, { ...scene((c) => karahiCert(c)), now: sep(28, 14, 50) });
    await expect(page.getByText(/Your claim ended at 2:48 pm/).first()).toBeVisible();
    await capture(page, { 1440: 'admin/restaurant-verification/Verify-LockLost' });
  });

  test('your claim ends in two minutes and the private link has expired', async ({ page }) => {
    await openConsole(page, { ...scene((c) => karahiCert(c), { review_lock_expires_at: sep(28, 14, 8) }), link: 'expired' });
    await expect(page.getByText(/Your claim ends soon/)).toBeVisible();
    await capture(page, { 1440: 'admin/restaurant-verification/Verify-LockWarning' });
  });

  test('changes requested, waiting on the restaurant', async ({ page }) => {
    await openConsole(
      page,
      scene((c) => karahiCert(c, { checks: allChecks() }), { onboarding_state: 'DOCUMENTS_REJECTED', assigned_admin_id: null, review_lock_expires_at: null }),
    );
    await expect(page.getByText('Waiting on the restaurant').first()).toBeVisible();
    await capture(page, { 1440: 'admin/restaurant-verification/Verify-Waiting' });
  });

  test('the application was withdrawn', async ({ page }) => {
    await openConsole(page, scene((c) => karahiCert(c), { onboarding_state: 'WITHDRAWN', assigned_admin_id: null, review_lock_expires_at: null }));
    await expect(page.getByText('The restaurant withdrew this application.').first()).toBeVisible();
    await capture(page, { 1440: 'admin/restaurant-verification/Verify-Withdrawn' });
  });

  test('a support agent', async ({ page }) => {
    await openConsole(page, {
      role: 'SUPPORT_AGENT',
      cert: (c) => ({ ...c.base.support, id: KARAHI.certId, restaurant_id: KARAHI.id }),
      app: (c) => karahiApp(c),
    });
    await expect(page.getByTestId('SupportSummary')).toBeVisible();
    await capture(page, { 1440: 'admin/restaurant-verification/Verify-Support' });
  });

  test('session ended while recording a check', async ({ page }) => {
    await openConsole(page, scene((c) => karahiCert(c), {}, { record: (route) => refuse(route, 401, 'SESSION_EXPIRED', 'This session has expired. Please sign in again.') }));
    await checks(page);
    await row(page, 'H6').getByRole('radio', { name: 'Pass' }).check();
    await row(page, 'H6').getByRole('button', { name: /^Record Scope sufficient/ }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await capture(page, { 1440: 'admin/restaurant-verification/Shell-Reauth' });
  });

  // ── a live restaurant's certificate ─────────────────────────────────────────

  const noor = (role: 'ADMIN' | 'SUPER_ADMIN', rest: Scene = {}): Scene => ({
    role,
    cert: (c) => noorCert(c),
    app: (c) => noorApp(c, noorCert(c)),
    ...rest,
  });

  const REVOKE_MESSAGE = 'HMA Canada told us certificate HMA-ON-2025-0981 was not issued to your business. Contact halal support to respond.';

  async function openRevoke(page: Page, s: Scene) {
    await openConsole(page, s, NOOR.certId);
    await expect(page.getByRole('button', { name: 'Revoke certificate…' })).toBeVisible();
    await page.getByRole('button', { name: 'Revoke certificate…' }).click();
    const panel = page.getByRole('region', { name: /^Revoke the .* certificate\?/ });
    await expect(panel).toBeVisible();
    return panel;
  }

  test('a live restaurant’s current certificate, read-only', async ({ page }) => {
    await openConsole(page, noor('SUPER_ADMIN'), NOOR.certId);
    await expect(page.getByRole('button', { name: 'Revoke certificate…' })).toBeVisible();
    await capture(page, { 1440: 'admin/restaurant-verification/Verify-NoorCurrent' });
  });

  test('revoke a live restaurant’s certificate', async ({ page }) => {
    const panel = await openRevoke(page, noor('SUPER_ADMIN'));
    await panel.getByLabel(/^Message to the restaurant/).fill(REVOKE_MESSAGE);
    await capture(page, { 1440: 'admin/restaurant-verification/Verify-Revoke' });
  });

  test('revoke, after the code check: reason chosen, box ticked', async ({ page }) => {
    const panel = await openRevoke(page, noor('SUPER_ADMIN'));
    await choose(page, 'Reason', 'Other');
    await panel.getByLabel(/^Message to the restaurant/).fill(REVOKE_MESSAGE);
    await panel.getByRole('checkbox').check();
    await expect(panel.getByRole('button', { name: 'Revoke certificate', exact: true })).toBeEnabled();
    await capture(page, { 1440: 'admin/restaurant-verification/Verify-RevokeReady' });
  });

  test('revoke refused for an admin who is not a super admin', async ({ page }) => {
    const panel = await openRevoke(page, noor('ADMIN', { ruling: (route) => refuse(route, 403, 'FORBIDDEN', 'Only a super admin can revoke.') }));
    await choose(page, 'Reason', 'Other');
    await panel.getByLabel(/^Message to the restaurant/).fill(REVOKE_MESSAGE);
    await panel.getByRole('checkbox').check();
    await panel.getByRole('button', { name: 'Revoke certificate', exact: true }).click();
    await expect(page.getByText('Only super admins can revoke a certificate')).toBeVisible();
    await capture(page, { 1440: 'admin/restaurant-verification/Verify-Revoke403' });
  });

  test('revoked', async ({ page }) => {
    const live: { cert?: Json } = {};
    const panel = await openRevoke(
      page,
      noor('SUPER_ADMIN', {
        cert: (c) => live.cert ?? noorCert(c),
        ruling: (route, c) => {
          live.cert = noorCert(c, { status: 'REVOKED', rejection_reason_code: 'OTHER', rejection_reason_text: REVOKE_MESSAGE });
          return route.fulfill({ json: { data: live.cert } });
        },
      }),
    );
    await choose(page, 'Reason', 'Other');
    await panel.getByLabel(/^Message to the restaurant/).fill(REVOKE_MESSAGE);
    await panel.getByRole('checkbox').check();
    await panel.getByRole('button', { name: 'Revoke certificate', exact: true }).click();
    await expect(page.getByText('Certificate revoked').first()).toBeVisible();
    await capture(page, { 1440: 'admin/restaurant-verification/Verify-Revoked' });
  });

  test('revoke on a restaurant that is not live yet', async ({ page }) => {
    const panel = await openRevoke(page, { role: 'SUPER_ADMIN', cert: (c) => approvedCert(c), app: (c) => appWith(c, approvedCert(c)) });
    await expect(panel.getByText(/isn’t live yet/)).toBeVisible();
    await panel.getByLabel(/^Message to the restaurant/).fill('HMA Canada told us certificate HMA-ON-2026-0417 was not issued to your business. Contact halal support to respond.');
    await capture(page, { 1440: 'admin/restaurant-verification/Verify-RevokeNotLive' });
  });
});
