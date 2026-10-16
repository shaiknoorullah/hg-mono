import { expect, test, type Locator, type Page, type Route } from '@playwright/test';

import { declareUnpairable, expectDesignFor, type BoardFor } from './design';
import { MOCK_API, MODE, openSignedIn } from './redesign-restaurant.support';
import { projectMeta } from './mode';

test.skip(MODE !== 'mock', 'written against the mock server; run with E2E_MODE=mock');

/**
 * The redesigned restaurant console's settings pages (`/settings/:section`: halal certification,
 * account, business profile, documents, sign-in and security, and the panels that open beside
 * them: edit, upload a renewed certificate, change password, contact support), each state captured
 * for the design board it must match (tools/e2e/README.md, "Design captures"). Boards are drawn at
 * 1440 wide; the two tablet boards the app can show are declared for 1024. Mock mode: every state
 * is served with `page.route` from the mock's own fixtures (`restaurant_profile_*`,
 * `restaurant_document_pack_complete`, `restaurant_open_state_*`), patched where a board draws a
 * state the fixtures do not (dates counted from today, a pause still running, one document in
 * another state).
 *
 * The area holds 152 boards and the spec accounts for every one:
 *   - 83 compared, each captured at the width it is drawn for;
 *   - 20 declared unpairable with the reason on each: 3 host components (`ScreenSettings`,
 *     `ScreenPhone`, `ScreenPayouts`), 15 component boards (`Part*`; 4 are byte-identical to the copies in
 *     the payouts area) and the two phone-width boards, which wait on pull request #957 (the console
 *     frame below 768 px is being rewritten there, so what a capture would show is not yet known);
 *   - 24 blocked and not declared, because the contract has no operation to draw them
 *     ([#880](https://github.com/shaiknoorullah/hg-mono/issues/880): the reviewed changes to a name, the
 *     address, the description and the GST/HST number, and the version check behind "your profile
 *     changed"; [#879](https://github.com/shaiknoorullah/hg-mono/issues/879): a withdrawn certificate;
 *     and no earlier document versions): `Edit-About*`, `Edit-Address*`, `Edit-Tax*`, `Edit-SavedAbout`,
 *     `Edit-SavedTax`, `Edit-NamesReviewed`, `Edit-NamesSending`, `Edit-NamesFailed`, `Edit-NamesInvalid`,
 *     `Edit-NamesSent`, `Edit-Conflict`, `Edit-OtherCardInvalid`, `Tablet-SettingsEdit`,
 *     `Settings-HalalRevoked`, `Docs-History`;
 *   - 10 the app has no screen for yet, so there is nothing to capture
 *     ([#883](https://github.com/shaiknoorullah/hg-mono/issues/883)): What's new (`WhatsNew-*`, which
 *     also needs a release-notes operation the contract does not have) and the renewal-approved notice
 *     (`Renewal-Approved*`, blocked by [#879](https://github.com/shaiknoorullah/hg-mono/issues/879)).
 *     Built, and captured by their own specs so this file stays as it is: the eight This device boards
 *     (`Device-*`, `Settings-Device`) by `redesign-restaurant.device.spec.ts`, and the upload sheets for
 *     the other documents (`Doc-*`), the cancel confirmation and the too-early state of the upload panel
 *     (`Renew-Cancel`, `Renew-TooEarly`) by `redesign-restaurant.documents-upload.spec.ts`.
 *
 * Some compared boards draw more than the page does, and the difference is the measurement: the
 * documents boards for food safety draw a banner and an upload button; the support boards draw a
 * block of details to quote; the renewal boards draw the current certificate beside the renewal
 * (the contract returns one row per document type, [#879](https://github.com/shaiknoorullah/hg-mono/issues/879));
 * the paused-until-closing board says "until closing" where the response carries only a time.
 *
 * Board ids are written out in full on purpose: tools/e2e/web/check-boards.mjs validates only
 * literal ids.
 */

const never = () => new Promise<void>(() => undefined);
const failing = (route: Route) =>
  route.fulfill({ status: 500, json: { error: { code: 'INTERNAL_ERROR', message: 'boom', request_id: 'req_e2e' } } });

async function fixture<T = any>(page: Page, name: string): Promise<T> {
  const res = await page.request.get(`${MOCK_API}/__mock/scenarios/${name}`);
  return (await res.json()).data.payload;
}

/** Restaurant-timezone "YYYY-MM-DD", `days` from today. */
function torontoDate(days: number): string {
  const d = new Date(Date.now() + days * 86_400_000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

interface Scene {
  profile?: string;
  patchProfile?: (p: any) => any;
  profileCall?: 'error' | 'never';
  docs?: (docs: any[]) => any[];
  docsCall?: 'error' | 'never' | 'denied';
  availability?: string;
  patchAvailability?: (av: any) => any;
}

async function open(page: Page, path: string, scene: Scene = {}) {
  const { profile = 'restaurant_profile_halal_certified', patchProfile = (p) => p, docs = (d) => d } = scene;
  if (scene.profileCall === 'error') await page.route('**/v1/restaurant/profile', failing);
  else if (scene.profileCall === 'never') await page.route('**/v1/restaurant/profile', never);
  else {
    const body = patchProfile(await fixture(page, profile));
    await page.route('**/v1/restaurant/profile', (route) => route.fulfill({ json: { data: body } }));
  }
  if (scene.docsCall === 'error') await page.route('**/v1/restaurant/documents', failing);
  else if (scene.docsCall === 'never') await page.route('**/v1/restaurant/documents', never);
  else if (scene.docsCall === 'denied') {
    await page.route('**/v1/restaurant/documents', (route) =>
      route.fulfill({ status: 403, json: { error: { code: 'FORBIDDEN', message: 'no', request_id: 'req_e2e' } } }),
    );
  } else {
    const list = docs(await fixture(page, 'restaurant_document_pack_complete'));
    await page.route('**/v1/restaurant/documents', (route) =>
      route.request().method() === 'GET' ? route.fulfill({ json: { data: list } }) : route.fallback(),
    );
  }
  if (scene.availability) {
    const now = new Date().toISOString();
    const av = (scene.patchAvailability ?? ((a) => a))({ ...(await fixture(page, scene.availability)), last_heartbeat_at: now });
    await page.route('**/v1/restaurant/availability', (route) => route.fulfill({ json: { data: av } }));
  }
  await openSignedIn(page, path);
}

async function capture(page: Page, board: BoardFor, { settled = true } = {}) {
  if (settled) await page.waitForLoadState('networkidle');
  await expect(page.getByText('Not built yet')).toHaveCount(0);
  await expectDesignFor(page, board);
}

const halal = (state: string, days: number) => (p: any) => ({
  ...p,
  halal: { ...p.halal, display_state: state, expires_on: torontoDate(days) },
});

/** The document pack with one document type changed (or left out when `patch` is null). */
const withDoc = (type: string, patch: Record<string, unknown> | null) => (docs: any[]) =>
  docs.flatMap((d) => (d.doc_type !== type ? [d] : patch === null ? [] : [{ ...d, ...patch }]));

const section = (page: Page, key: string) => page.getByTestId(`section-${key}`);

// ── Halal certification ──────────────────────────────────────────────────────────────────

test.describe('redesigned restaurant settings · halal certification (mock)', () => {
  test.use({ colorScheme: 'light' });

  test('certified, with the renewal upload open', async ({ page }) => {
    await open(page, '/settings/halal', { patchProfile: halal('CERTIFIED', 45) });
    await expect(section(page, 'halal')).toHaveAttribute('data-tone', 'certified');
    await expect(page.getByRole('button', { name: 'Upload renewed certificate' })).toBeEnabled();
    await capture(page, { 1440: 'restaurant/settings/Settings-Overview', 1024: 'restaurant/settings/Tablet-Settings' });
  });

  test('certified, the renewal window is not open yet', async ({ page }) => {
    await open(page, '/settings/halal', { patchProfile: halal('CERTIFIED', 400) });
    await expect(page.getByTestId('renew-reason')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Upload renewed certificate' })).toBeDisabled();
    await capture(page, 'restaurant/settings/Settings-RenewNotYet');
  });

  for (const [days, board] of [
    [30, 'restaurant/settings/Settings-HalalExpiring'],
    [14, 'restaurant/settings/Settings-HalalExpiring14'],
    [7, 'restaurant/settings/Settings-HalalExpiring7'],
    [1, 'restaurant/settings/Settings-HalalExpiring1'],
  ] as const) {
    test(`expires in ${days} days`, async ({ page }) => {
      await open(page, '/settings/halal', { patchProfile: halal('EXPIRING_SOON', days) });
      await expect(section(page, 'halal')).toHaveAttribute('data-tone', 'expiring');
      await capture(page, board);
    });
  }

  test('expired: cool slate, we cannot currently vouch', async ({ page }) => {
    await open(page, '/settings/halal', {
      profile: 'restaurant_profile_halal_expired',
      patchProfile: halal('EXPIRED', -14),
      docs: withDoc('HALAL_CERTIFICATE', { state: 'EXPIRED', valid_until: torontoDate(-14) }),
    });
    await expect(section(page, 'halal')).toHaveAttribute('data-tone', 'expired');
    await capture(page, 'restaurant/settings/Settings-HalalExpired');
  });

  test('no certificate on record', async ({ page }) => {
    await open(page, '/settings/halal', { profile: 'restaurant_profile_halal_unverified', docs: withDoc('HALAL_CERTIFICATE', null) });
    await expect(section(page, 'halal')).toHaveAttribute('data-tone', 'unverified');
    await expect(page.getByText('No halal certificate on record').first()).toBeVisible();
    await capture(page, 'restaurant/settings/Settings-HalalNoCertificate');
  });

  test('not verified yet: a reviewer is checking the certificate', async ({ page }) => {
    await open(page, '/settings/halal', { profile: 'restaurant_profile_halal_unverified', docs: withDoc('HALAL_CERTIFICATE', { state: 'IN_REVIEW' }) });
    await expect(page.getByRole('heading', { name: 'We’re checking your certificate' })).toBeVisible();
    await capture(page, 'restaurant/settings/Settings-HalalNotVerified');
  });

  test('the halal status is missing: no badge, no claim', async ({ page }) => {
    await open(page, '/settings/halal', { profile: 'restaurant_profile_halal_missing' });
    await expect(section(page, 'halal')).toHaveAttribute('data-tone', 'missing');
    await capture(page, 'restaurant/settings/Settings-HalalNone');
  });

  test('the settings are loading', async ({ page }) => {
    await open(page, '/settings/halal', { profileCall: 'never' });
    await expect(page.getByTestId('settings-page')).toHaveAttribute('data-state', 'loading');
    await capture(page, 'restaurant/settings/Settings-Loading', { settled: false });
  });

  test('the settings do not load', async ({ page }) => {
    await open(page, '/settings/halal', { profileCall: 'error' });
    await expect(page.getByText('Couldn’t load your settings')).toBeVisible();
    await capture(page, 'restaurant/settings/Settings-Error');
  });
});

// ── A renewal beside the certificate ─────────────────────────────────────────────────────

test.describe('redesigned restaurant settings · renewals (mock)', () => {
  test.use({ colorScheme: 'light' });

  const note = (page: Page, kind: string) => expect(page.getByTestId('halal-renewal-note')).toHaveAttribute('data-kind', kind);
  const renewal = (state: string, extra: Record<string, unknown> = {}) => withDoc('HALAL_CERTIFICATE', { state, ...extra });

  test('expired, renewal in review', async ({ page }) => {
    await open(page, '/settings/halal', { patchProfile: halal('EXPIRED', -14), docs: renewal('IN_REVIEW') });
    await note(page, 'review');
    await capture(page, 'restaurant/settings/Renewal-InReview');
  });

  test('expires tomorrow, renewal in review', async ({ page }) => {
    await open(page, '/settings/halal', { patchProfile: halal('EXPIRING_SOON', 1), docs: renewal('IN_REVIEW') });
    await note(page, 'review');
    await capture(page, 'restaurant/settings/Renewal-InReviewExpiring');
  });

  test('expires today, renewal in review', async ({ page }) => {
    await open(page, '/settings/halal', { patchProfile: halal('EXPIRED', 0), docs: renewal('IN_REVIEW') });
    await note(page, 'review');
    await capture(page, 'restaurant/settings/Renewal-InReviewExpiryDay');
  });

  test('expired, renewal just sent', async ({ page }) => {
    await open(page, '/settings/halal', { patchProfile: halal('EXPIRED', -14), docs: renewal('SUBMITTED') });
    await note(page, 'review');
    await capture(page, 'restaurant/settings/Renewal-Submitted');
  });

  test('sent early, the listing is not affected', async ({ page }) => {
    await open(page, '/settings/halal', { patchProfile: halal('EXPIRING_SOON', 30), docs: renewal('SUBMITTED') });
    await note(page, 'review');
    await capture(page, 'restaurant/settings/Renewal-Early');
  });

  test('expired, renewal not accepted', async ({ page }) => {
    await open(page, '/settings/halal', {
      patchProfile: halal('EXPIRED', -14),
      docs: renewal('REJECTED', { review_note: 'Page 2 is cut off at the bottom, so the expiry date cannot be read. Upload every page again.' }),
    });
    await note(page, 'rejected');
    await capture(page, 'restaurant/settings/Renewal-Rejected');
  });

  test('expired, renewal not accepted: the certificate is already in use', async ({ page }) => {
    await open(page, '/settings/halal', {
      patchProfile: halal('EXPIRED', -14),
      docs: renewal('REJECTED', { rejection_reason_code: 'DUPLICATE', review_note: 'This certificate number is already on record for another restaurant.' }),
    });
    await note(page, 'rejected');
    await capture(page, 'restaurant/settings/Renewal-RejectedDuplicate');
  });

  test('renewal not accepted, the certificate is still valid', async ({ page }) => {
    await open(page, '/settings/halal', {
      patchProfile: halal('EXPIRING_SOON', 14),
      docs: renewal('REJECTED', { review_note: 'The scan is too dark to read the certificate number.' }),
    });
    await note(page, 'rejected');
    await capture(page, 'restaurant/settings/Renewal-RejectedStillValid');
  });
});

// ── Account and orders right now ─────────────────────────────────────────────────────────

test.describe('redesigned restaurant settings · account (mock)', () => {
  test.use({ colorScheme: 'light' });

  const live = { profile: 'restaurant_profile_account_live' };
  const acct = (page: Page) => section(page, 'account');

  for (const [name, openState, board] of [
    ['open', 'restaurant_open_state_open', 'restaurant/settings/Settings-Account'],
    ['closed by the hours', 'restaurant_open_state_closed_hours', 'restaurant/settings/Settings-ClosedByHours'],
    ['ordering turned off', 'restaurant_open_state_closed_toggle', 'restaurant/settings/Settings-ClosedToggle'],
    ['turned off after missed orders', 'restaurant_open_state_closed_toggle_auto_off', 'restaurant/settings/Settings-AutoOffline'],
    ['closed for a holiday', 'restaurant_open_state_closed_holiday', 'restaurant/settings/Settings-Holiday'],
    ['order screen offline', 'restaurant_open_state_closed_offline', 'restaurant/settings/Settings-Offline'],
  ] as const) {
    test(`orders right now: ${name}`, async ({ page }) => {
      await open(page, '/settings/account', { ...live, availability: openState });
      await expect(acct(page)).toBeVisible();
      await expect(page.getByTestId('orders-now-loading')).toHaveCount(0);
      await capture(page, board);
    });
  }

  /** A pause that is still running, ending `minutes` from now (the fixtures' own times are long past). */
  const pausedFor = (minutes: number) => (av: any) => ({ ...av, is_accepting_orders: true, pause_until: new Date(Date.now() + minutes * 60_000).toISOString() });

  test('orders right now: paused until a time', async ({ page }) => {
    await open(page, '/settings/account', { ...live, availability: 'restaurant_open_state_paused', patchAvailability: pausedFor(30) });
    await expect(acct(page).getByText('Paused', { exact: true })).toBeVisible();
    await capture(page, 'restaurant/settings/Settings-Paused');
  });

  // The response to a pause until closing carries only the time it chose, so the card reads "Paused
  // until 7:36 am", not "until closing": the label is the one thing this board draws that the app cannot.
  test('orders right now: paused until closing', async ({ page }) => {
    await open(page, '/settings/account', { ...live, availability: 'restaurant_open_state_paused_until_closing', patchAvailability: pausedFor(180) });
    await expect(acct(page).getByText('Paused', { exact: true })).toBeVisible();
    await capture(page, 'restaurant/settings/Settings-PausedUntilClosing');
  });

  test('orders right now: choosing how long to pause', async ({ page }) => {
    await open(page, '/settings/account', { ...live, availability: 'restaurant_open_state_open' });
    await acct(page).getByRole('button', { name: /^Pause/ }).first().click();
    await expect(page.getByText('15 minutes').first()).toBeVisible();
    await capture(page, 'restaurant/settings/Settings-PauseChoose');
  });

  for (const [name, fixtureName, board] of [
    ['suspended', 'restaurant_profile_account_suspended', 'restaurant/settings/Settings-Suspended'],
    ['banned', 'restaurant_profile_account_banned', 'restaurant/settings/Settings-Banned'],
    ['closed', 'restaurant_profile_account_closed', 'restaurant/settings/Settings-Closed'],
    ['deactivated', 'restaurant_profile_account_deactivated', 'restaurant/settings/Settings-Deactivated'],
    ['hidden from customers', 'restaurant_profile_account_delisted', 'restaurant/settings/Settings-Delisted'],
    ['not live yet', 'restaurant_profile_account_pending', 'restaurant/settings/Settings-Pending'],
  ] as const) {
    test(`account ${name}`, async ({ page }) => {
      await open(page, '/settings/account', { profile: fixtureName });
      await expect(page.getByTestId('account-text')).toBeVisible();
      await capture(page, board);
    });
  }
});

// ── Upload the renewed halal certificate (the panel beside the page) ─────────────────────

test.describe('redesigned restaurant settings · upload a halal certificate (mock)', () => {
  test.use({ colorScheme: 'light' });

  type Step = 'ok' | 'never' | 'error';
  interface Upload {
    /** createUpload: `too-large` is the 413 the server answers for a file over the cap. */
    create?: 'ok' | 'too-large';
    /** The PUT to the presigned address; `error` is a connection that drops. */
    put?: Step;
    /** confirmUpload: `type` is the 422 the server answers when the bytes are not the declared type. */
    confirm?: 'ready' | 'type';
    /** attachRestaurantDocument. */
    attach?: 'ok' | 'never' | 'network' | 'invalid' | 'certifier' | 'locked';
    /** submitRestaurantDocuments. */
    submit?: Step;
  }

  const problem = (status: number, code: string, details?: unknown[]) => ({
    status,
    json: { error: { code, message: code, request_id: 'req_e2e', ...(details ? { details } : {}) } },
  });

  /** The upload road the panel walks (createUpload, PUT, confirmUpload, attach, submit), step by step. */
  async function uploadRoad(page: Page, o: Upload = {}) {
    const presigned = await fixture(page, 'presigned_upload');
    const ready = await fixture(page, 'stored_object_ready');
    const doc = (await fixture<any[]>(page, 'restaurant_document_pack_complete')).find((d) => d.doc_type === 'HALAL_CERTIFICATE');
    await page.route('**/v1/uploads', (route) =>
      o.create === 'too-large' ? route.fulfill(problem(413, 'PAYLOAD_TOO_LARGE')) : route.fulfill({ status: 201, json: { data: presigned } }),
    );
    await page.route(presigned.url, (route) =>
      o.put === 'never' ? never() : o.put === 'error' ? route.abort('connectionreset') : route.fulfill({ status: 200, body: '' }),
    );
    await page.route('**/v1/uploads/*/confirm', (route) =>
      o.confirm === 'type' ? route.fulfill(problem(422, 'CONTENT_TYPE_MISMATCH')) : route.fulfill({ json: { data: ready } }),
    );
    await page.route('**/v1/restaurant/documents', (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      switch (o.attach) {
        case 'never':
          return never();
        case 'network':
          return route.abort('connectionreset');
        case 'invalid':
          return route.fulfill(problem(422, 'VALIDATION_FAILED', [{ field: 'valid_until', message: 'valid_until must be after issued_on' }]));
        case 'certifier':
          return route.fulfill(problem(422, 'UNRECOGNISED_CERTIFIER'));
        case 'locked':
          return route.fulfill(problem(409, 'DOCUMENT_LOCKED_FOR_REVIEW'));
        default:
          return route.fulfill({ status: 201, json: { data: { ...doc, state: 'SUBMITTED' } } });
      }
    });
    await page.route('**/v1/restaurant/documents/submit', (route) =>
      o.submit === 'never' ? never() : o.submit === 'error' ? failing(route) : route.fulfill({ json: { data: { onboarding_state: 'DOCUMENTS_REVIEW' } } }),
    );
  }

  const FILE = { name: 'halal-certificate-2027.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 a certificate') };
  const panel = (page: Page) => page.getByTestId('renew-panel');
  const show = (locator: Locator) => locator.scrollIntoViewIfNeeded();
  const choose = (page: Page, file = FILE) => page.locator('input[type="file"]').setInputFiles(file);

  /** Opens the panel for a certificate in `state`, then chooses `file`, and waits for the details form. */
  async function toDetails(page: Page, scene: Scene, road: Upload = {}, file = FILE) {
    await uploadRoad(page, road);
    await open(page, '/settings/halal?panel=renew', scene);
    await choose(page, file);
    await expect(page.getByRole('form', { name: /^Details for/ })).toBeVisible();
  }
  const fill = async (page: Page, issuer: string, number: string, validDays: number) => {
    await page.getByLabel('Issuing body').fill(issuer);
    await page.getByLabel('Certificate number (optional)').fill(number);
    await page.locator('#halal-certificate-valid').fill(torontoDate(validDays));
  };
  const save = (page: Page) => page.getByRole('button', { name: /^Save document/ }).click();
  const expiring = { patchProfile: halal('EXPIRING_SOON', 14) };
  const certified = { patchProfile: halal('CERTIFIED', 45) };

  test('choose a file', async ({ page }) => {
    await uploadRoad(page);
    await open(page, '/settings/halal?panel=renew', certified);
    await expect(panel(page)).toBeVisible();
    await capture(page, { 1440: 'restaurant/settings/Renew-Choose', 1024: 'restaurant/settings/Tablet-SettingsRenew' });
  });

  test('the first halal certificate', async ({ page }) => {
    await uploadRoad(page);
    await open(page, '/settings/halal?panel=renew', { profile: 'restaurant_profile_halal_unverified', docs: withDoc('HALAL_CERTIFICATE', null) });
    await expect(panel(page)).toBeVisible();
    await capture(page, 'restaurant/settings/Renew-First');
  });

  test('from the expiring banner', async ({ page }) => {
    await uploadRoad(page);
    await open(page, '/settings/halal?panel=renew', expiring);
    await expect(panel(page)).toBeVisible();
    await capture(page, 'restaurant/settings/Renew-FromExpiring');
  });

  test('after the certificate expired', async ({ page }) => {
    await uploadRoad(page);
    await open(page, '/settings/halal?panel=renew', { patchProfile: halal('EXPIRED', -14), docs: withDoc('HALAL_CERTIFICATE', { state: 'EXPIRED' }) });
    await expect(panel(page)).toBeVisible();
    await capture(page, 'restaurant/settings/Renew-AfterExpiry');
  });

  test('uploading', async ({ page }) => {
    await uploadRoad(page, { put: 'never' });
    await open(page, '/settings/halal?panel=renew', certified);
    await choose(page);
    await expect(page.getByTestId('upload-progress')).toBeVisible();
    await capture(page, 'restaurant/settings/Renew-Uploading', { settled: false });
  });

  test('the upload did not finish', async ({ page }) => {
    await uploadRoad(page, { put: 'error' });
    await open(page, '/settings/halal?panel=renew', certified);
    await choose(page);
    await show(page.getByTestId('draft-error'));
    await expect(page.getByTestId('draft-error')).toContainText('The upload didn’t finish');
    await capture(page, 'restaurant/settings/Renew-UploadFailed');
  });

  test('the file is too large', async ({ page }) => {
    await uploadRoad(page, { create: 'too-large' });
    await open(page, '/settings/halal?panel=renew', certified);
    await choose(page, { ...FILE, name: 'certificate-scan-600dpi.pdf' });
    await show(page.getByTestId('draft-error'));
    await expect(page.getByTestId('draft-error')).toContainText('This file is too large');
    await capture(page, 'restaurant/settings/Renew-TooLarge');
  });

  test('the file is not the type its name says', async ({ page }) => {
    await uploadRoad(page, { confirm: 'type' });
    await open(page, '/settings/halal?panel=renew', certified);
    await choose(page);
    await show(page.getByTestId('draft-error'));
    await expect(page.getByTestId('draft-error')).toContainText('This type of file isn’t accepted');
    await capture(page, 'restaurant/settings/Renew-TypeMismatch');
  });

  // The app cannot tell a Word file from a PDF with the wrong bytes: both are the one "type isn't
  // accepted" answer from the server, so this board and the one above are compared to the same state.
  test('the file is a Word document', async ({ page }) => {
    await uploadRoad(page, { confirm: 'type' });
    await open(page, '/settings/halal?panel=renew', certified);
    await choose(page, {
      name: 'halal-certificate.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      buffer: Buffer.from('PK a word document'),
    });
    await show(page.getByTestId('draft-error'));
    await expect(page.getByTestId('draft-error')).toContainText('This type of file isn’t accepted');
    await capture(page, 'restaurant/settings/Renew-WrongType');
  });

  test('ready to send', async ({ page }) => {
    await toDetails(page, certified);
    await fill(page, 'HMA Canada', 'HMA-2026-09114', 400);
    await capture(page, 'restaurant/settings/Renew-Ready');
  });

  test('sending', async ({ page }) => {
    await toDetails(page, certified, { submit: 'never' });
    await fill(page, 'HMA Canada', 'HMA-2026-09114', 400);
    await save(page);
    await expect(page.getByText('Sending your renewed certificate…')).toBeVisible();
    await capture(page, 'restaurant/settings/Renew-Sending', { settled: false });
  });

  test('it could not be sent', async ({ page }) => {
    await toDetails(page, certified, { attach: 'network' });
    await fill(page, 'HMA Canada', 'HMA-2026-09114', 400);
    await save(page);
    await show(page.getByTestId('draft-error'));
    await expect(page.getByTestId('draft-error')).toContainText('The details weren’t saved');
    await capture(page, 'restaurant/settings/Renew-SendFailed');
  });

  test('the details need fixing', async ({ page }) => {
    await toDetails(page, certified, { attach: 'invalid' });
    await fill(page, 'HMA Canada', 'HMA-2026-09114', 400);
    await save(page);
    await show(page.getByTestId('draft-error'));
    await expect(page.getByTestId('draft-error')).toContainText('Not saved');
    await capture(page, 'restaurant/settings/Renew-Invalid');
  });

  test('the date has already passed', async ({ page }) => {
    await toDetails(page, certified);
    await fill(page, 'HMA Canada', 'HMA-2026-09114', -3);
    await save(page);
    await show(page.getByText('This date has passed. Choose the current certificate instead.'));
    await expect(page.getByText('This date has passed. Choose the current certificate instead.')).toBeVisible();
    await capture(page, 'restaurant/settings/Renew-AlreadyExpired');
  });

  test('the certifying body is no longer accepted', async ({ page }) => {
    await toDetails(page, certified, { attach: 'certifier' });
    await fill(page, 'HMA Canada', 'HMA-2026-09114', 400);
    await save(page);
    await show(page.getByTestId('draft-error'));
    await expect(page.getByTestId('draft-error')).toContainText('We don’t accept certificates from this body yet');
    await capture(page, 'restaurant/settings/Renew-Certifier');
  });

  test('locked while a review is open', async ({ page }) => {
    await toDetails(page, { patchProfile: halal('EXPIRED', -14), docs: withDoc('HALAL_CERTIFICATE', { state: 'IN_REVIEW' }) }, { attach: 'locked' });
    await fill(page, 'HMA Canada', 'HMA-2026-09114', 400);
    await save(page);
    await show(page.getByTestId('renew-refused'));
    await expect(page.getByTestId('renew-refused')).toBeVisible();
    await capture(page, 'restaurant/settings/Renew-Locked');
  });
});

// ── Business profile and its panels ──────────────────────────────────────────────────────

test.describe('redesigned restaurant settings · business profile (mock)', () => {
  test.use({ colorScheme: 'light' });

  const edit = (page: Page) => page.getByTestId('edit-panel');
  /** A profile save that answers like the server: it echoes what it was sent. */
  async function saveRoute(page: Page, how: 'echo' | 'never' | { status: number; code: string } = 'echo') {
    await page.route('**/v1/restaurant/profile', async (route) => {
      const req = route.request();
      if (req.method() !== 'PUT') return route.fallback();
      if (how === 'never') return never();
      if (how !== 'echo') {
        return route.fulfill({ status: how.status, json: { error: { code: how.code, message: how.code, request_id: 'req_e2e' } } });
      }
      return route.fulfill({ json: { data: { ...(await fixture(page, 'restaurant_profile')), ...req.postDataJSON() } } });
    });
  }

  test('the business profile', async ({ page }) => {
    await open(page, '/settings/profile', { profile: 'restaurant_profile' });
    await expect(section(page, 'profile')).toBeVisible();
    await capture(page, 'restaurant/settings/Settings-Profile');
  });

  test('the description is missing', async ({ page }) => {
    await open(page, '/settings/profile', { profile: 'restaurant_profile', patchProfile: (p) => ({ ...p, description: '' }) });
    await expect(page.getByTestId('profile-about').getByText('Not set yet').first()).toBeVisible();
    await capture(page, 'restaurant/settings/Settings-ProfileIncomplete');
  });

  test('edit the owner name', async ({ page }) => {
    await open(page, '/settings/profile?panel=edit-names', { profile: 'restaurant_profile' });
    await expect(edit(page)).toBeVisible();
    await capture(page, 'restaurant/settings/Edit-Names');
  });

  test('edit the owner name, saving', async ({ page }) => {
    await open(page, '/settings/profile?panel=edit-names', { profile: 'restaurant_profile' });
    await saveRoute(page, 'never');
    await page.getByLabel('Owner’s first name').fill('Rami');
    await edit(page).getByRole('button', { name: 'Save' }).click();
    await expect(edit(page).getByRole('button', { name: 'Save' })).toBeDisabled();
    await capture(page, 'restaurant/settings/Edit-Saving', { settled: false });
  });

  test('the owner name saved', async ({ page }) => {
    await open(page, '/settings/profile?panel=edit-names', { profile: 'restaurant_profile' });
    await saveRoute(page);
    await page.getByLabel('Owner’s first name').fill('Rami');
    await edit(page).getByRole('button', { name: 'Save' }).click();
    await expect(page.getByTestId('hg-toast').getByText('Owner name saved')).toBeVisible();
    await capture(page, 'restaurant/settings/Edit-Saved');
  });

  test('leaving an edit with changes asks first', async ({ page }) => {
    await open(page, '/settings/profile?panel=edit-names', { profile: 'restaurant_profile' });
    await page.getByLabel('Owner’s first name').fill('Rami');
    await edit(page).getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByTestId('edit-discard')).toBeVisible();
    await capture(page, 'restaurant/settings/Edit-Discard');
  });

  test('a change the server does not accept', async ({ page }) => {
    await open(page, '/settings/profile?panel=edit-names', { profile: 'restaurant_profile' });
    await saveRoute(page, { status: 422, code: 'UNKNOWN_FIELD' });
    await page.getByLabel('Owner’s first name').fill('Rami');
    await edit(page).getByRole('button', { name: 'Save' }).click();
    await expect(page.getByTestId('edit-rejected')).toBeVisible();
    await capture(page, 'restaurant/settings/Edit-UnknownField');
  });

  test('edit the phone numbers', async ({ page }) => {
    await open(page, '/settings/profile?panel=edit-contact', { profile: 'restaurant_profile' });
    await expect(edit(page)).toBeVisible();
    await capture(page, 'restaurant/settings/Edit-Contact');
  });

  test('a phone number that is not Canadian', async ({ page }) => {
    await open(page, '/settings/profile?panel=edit-contact', { profile: 'restaurant_profile' });
    await page.getByLabel('Business phone').fill('+44 20 7946 0958');
    await edit(page).getByRole('button', { name: 'Save' }).click();
    await expect(edit(page).getByText(/Enter a Canadian phone number/).first()).toBeVisible();
    await capture(page, 'restaurant/settings/Edit-ContactError');
  });

  test('the phone numbers saved', async ({ page }) => {
    await open(page, '/settings/profile?panel=edit-contact', { profile: 'restaurant_profile' });
    await saveRoute(page);
    await page.getByLabel('Business phone').fill('(416) 555-0134');
    await edit(page).getByRole('button', { name: 'Save' }).click();
    await expect(page.getByTestId('hg-toast').getByText('Phone numbers saved')).toBeVisible();
    await capture(page, 'restaurant/settings/Edit-SavedContact');
  });

  test('edit the kitchen time', async ({ page }) => {
    await open(page, '/settings/profile?panel=edit-kitchen', { profile: 'restaurant_profile' });
    await expect(edit(page)).toBeVisible();
    await capture(page, 'restaurant/settings/Edit-Kitchen');
  });

  test('a kitchen time out of range', async ({ page }) => {
    await open(page, '/settings/profile?panel=edit-kitchen', { profile: 'restaurant_profile' });
    await page.getByLabel('Usual preparation time, in minutes').fill('150');
    await edit(page).getByRole('button', { name: 'Save' }).click();
    await expect(edit(page).getByText('Enter a whole number of minutes between 5 and 120.')).toBeVisible();
    await capture(page, 'restaurant/settings/Edit-KitchenError');
  });

  test('the kitchen time saved', async ({ page }) => {
    await open(page, '/settings/profile?panel=edit-kitchen', { profile: 'restaurant_profile' });
    await saveRoute(page);
    await page.getByLabel('Usual preparation time, in minutes').fill('25');
    await edit(page).getByRole('button', { name: 'Save' }).click();
    await expect(page.getByTestId('hg-toast').getByText('Preparation time saved')).toBeVisible();
    await capture(page, 'restaurant/settings/Edit-SavedKitchen');
  });
});

// ── Documents ────────────────────────────────────────────────────────────────────────────

test.describe('redesigned restaurant settings · documents (mock)', () => {
  test.use({ colorScheme: 'light' });

  const doc = (page: Page, type: string) => page.getByTestId(`doc-${type}`);

  test('the documents', async ({ page }) => {
    await open(page, '/settings/documents');
    await expect(doc(page, 'HALAL_CERTIFICATE')).toBeVisible();
    await capture(page, 'restaurant/settings/Settings-Documents');
  });

  test('the documents are loading', async ({ page }) => {
    await open(page, '/settings/documents', { docsCall: 'never' });
    await expect(page.getByTestId('documents-loading')).toBeVisible();
    await capture(page, 'restaurant/settings/Docs-Loading', { settled: false });
  });

  test('the documents do not load', async ({ page }) => {
    await open(page, '/settings/documents', { docsCall: 'error' });
    await expect(page.getByTestId('documents-error')).toBeVisible();
    await capture(page, 'restaurant/settings/Docs-Error');
  });

  test('a file link that does not open', async ({ page }) => {
    await open(page, '/settings/documents');
    await page.route('**/v1/documents/*/download-url', failing);
    await doc(page, 'HALAL_CERTIFICATE').getByRole('button', { name: /^View/ }).click();
    await expect(page.getByTestId('file-link-error')).toBeVisible();
    await capture(page, 'restaurant/settings/Docs-FileLinkError');
  });

  // The boards below draw a banner above the documents and an upload button for the food safety
  // certificate. The page has neither yet (the upload sheets for the other documents are not built),
  // so these compare the documents page with the document in that state, nothing more.
  test('food safety certificate expiring', async ({ page }) => {
    await open(page, '/settings/documents', { docs: withDoc('FOOD_SAFETY', { valid_until: torontoDate(3) }) });
    await expect(doc(page, 'FOOD_SAFETY')).toBeVisible();
    await capture(page, 'restaurant/settings/Docs-FoodExpiring');
  });

  test('food safety certificate not accepted', async ({ page }) => {
    await open(page, '/settings/documents', {
      docs: withDoc('FOOD_SAFETY', { state: 'REJECTED', review_note: 'The reviewer could not read the inspection date.' }),
    });
    await expect(doc(page, 'FOOD_SAFETY')).toHaveAttribute('data-state', 'REJECTED');
    await capture(page, 'restaurant/settings/Docs-FoodRejected');
  });

  test('food safety certificate expired', async ({ page }) => {
    await open(page, '/settings/documents', {
      profile: 'restaurant_profile_account_delisted',
      docs: withDoc('FOOD_SAFETY', { state: 'EXPIRED', valid_until: torontoDate(-5) }),
    });
    await expect(doc(page, 'FOOD_SAFETY')).toHaveAttribute('data-state', 'EXPIRED');
    await capture(page, 'restaurant/settings/Settings-FoodSafetyExpired');
  });
});

// ── Sign-in and security ─────────────────────────────────────────────────────────────────

test.describe('redesigned restaurant settings · sign-in and security (mock)', () => {
  test.use({ colorScheme: 'light' });

  const panel = (page: Page) => page.getByTestId('password-panel');
  type Answer = 'ok' | 'never' | 'wrong' | 'breached' | 'failed';
  async function changeRoute(page: Page, answer: Answer) {
    const grant = await fixture(page, 'session_grant_password_changed');
    await page.route('**/v1/auth/password/change', (route) => {
      switch (answer) {
        case 'never':
          return never();
        case 'wrong':
          return route.fulfill({ status: 422, json: { error: { code: 'INVALID_CREDENTIALS', message: 'no', request_id: 'req_e2e' } } });
        case 'breached':
          return route.fulfill({ status: 422, json: { error: { code: 'BREACHED_PASSWORD', message: 'no', request_id: 'req_e2e' } } });
        case 'failed':
          return failing(route);
        default:
          return route.fulfill({ json: { data: grant } });
      }
    });
  }
  /** Opens the panel, fills both fields with throwaway text and presses Change password. */
  async function change(page: Page, answer: Answer) {
    await changeRoute(page, answer);
    await open(page, '/settings/security?panel=password');
    await page.getByLabel('Current password').fill('not-the-real-one');
    await page.getByLabel('New password').fill('a-long-enough-throwaway-phrase');
    await panel(page).getByRole('button', { name: 'Change password' }).click();
  }

  test('sign-in and security', async ({ page }) => {
    await open(page, '/settings/security');
    await expect(section(page, 'security')).toBeVisible();
    await capture(page, 'restaurant/settings/Settings-Security');
  });

  test('change the password', async ({ page }) => {
    await open(page, '/settings/security?panel=password');
    await expect(panel(page)).toBeVisible();
    await capture(page, 'restaurant/settings/Security-ChangePassword');
  });

  test('saving the new password', async ({ page }) => {
    await change(page, 'never');
    await expect(panel(page).getByRole('button', { name: 'Change password' })).toBeDisabled();
    await capture(page, 'restaurant/settings/Security-PasswordSaving', { settled: false });
  });

  test('the current password is wrong', async ({ page }) => {
    await change(page, 'wrong');
    await expect(panel(page).getByText('That isn’t your current password. Check it and try again.')).toBeVisible();
    await capture(page, 'restaurant/settings/Security-PasswordError');
  });

  test('the new password is refused', async ({ page }) => {
    await change(page, 'breached');
    await expect(panel(page).getByText(/appears in known data breaches/)).toBeVisible();
    await capture(page, 'restaurant/settings/Security-NewPasswordRejected');
  });

  test('the password could not be changed', async ({ page }) => {
    await change(page, 'failed');
    await expect(page.getByTestId('password-failed')).toBeVisible();
    await capture(page, 'restaurant/settings/Security-PasswordFailed');
  });

  test('the password changed', async ({ page }) => {
    await change(page, 'ok');
    await expect(page.getByTestId('hg-toast').getByText('Password changed')).toBeVisible();
    await capture(page, 'restaurant/settings/Security-PasswordSaved');
  });
});

// ── Contact support ──────────────────────────────────────────────────────────────────────

test.describe('redesigned restaurant settings · contact support (mock)', () => {
  test.use({ colorScheme: 'light' });

  // The app has one support panel with two wordings (general, and about a change it cannot make). The
  // boards draw it twice over the account page, once about the account status and once general, both
  // with a block of details to quote that the panel does not have. Each is compared to the panel
  // opened from that page, so the missing block and the topic show as differences.
  for (const [name, board] of [
    ['about the account status', 'restaurant/settings/Support-Account'],
    ['general', 'restaurant/settings/Support-Sheet'],
  ] as const) {
    test(`from the account page, ${name}`, async ({ page }) => {
      await open(page, '/settings/account?panel=support', { profile: 'restaurant_profile_account_live', availability: 'restaurant_open_state_open' });
      await expect(page.getByTestId('support-panel')).toBeVisible();
      await capture(page, board);
    });
  }

  test('from the halal certification page, the certificate is already in use', async ({ page }) => {
    await open(page, '/settings/halal?panel=support', {
      patchProfile: halal('EXPIRED', -14),
      docs: withDoc('HALAL_CERTIFICATE', { state: 'REJECTED', review_note: 'This certificate number is already on record for another restaurant.' }),
    });
    await expect(page.getByTestId('support-panel')).toBeVisible();
    await capture(page, 'restaurant/settings/Support-Halal');
  });
});

// ── Boards that cannot be compared ───────────────────────────────────────────────────────

test.describe('redesigned restaurant settings · boards that cannot be compared (mock)', () => {
  test.use({ colorScheme: 'light' });

  test('the hosts, the component boards and the phone-width boards', async ({ page }) => {
    test.skip(projectMeta().viewport !== 'desktop', 'declared once, at 1440');
    await open(page, '/settings/halal', { patchProfile: halal('CERTIFIED', 45) });
    await expect(section(page, 'halal')).toBeVisible();
    const host = (name: string) =>
      `a host component with no screen of its own: every board that draws ${name} imports it with one variant, so those are compared instead`;
    const part = (what: string) =>
      `a component board: ${what} drawn alone with its states, without the page around it; the screen boards that compose it are compared instead`;
    const phone = (width: string) =>
      `the phone layout of the console is being changed in pull request #957, which is not merged, so there is nothing yet to say honestly what a ${width} capture of the page would show; declare it once that lands`;
    await declareUnpairable(page, 'restaurant/settings/ScreenSettings', host('the settings page'));
    await declareUnpairable(page, 'restaurant/settings/ScreenPhone', host('a page at phone width'));
    await declareUnpairable(
      page,
      'restaurant/settings/ScreenPayouts',
      'a host component for the payouts page, drawn here as well as in restaurant/payouts (it renders the same pixels as restaurant/payouts/ScreenPayouts); it is also the backdrop of four What’s new boards. Not a settings screen',
    );
    await declareUnpairable(page, 'restaurant/settings/PartHalalCard', part('the halal certification section'));
    await declareUnpairable(page, 'restaurant/settings/PartProfile', part('the business profile section'));
    await declareUnpairable(page, 'restaurant/settings/PartDocuments', part('the documents section'));
    await declareUnpairable(page, 'restaurant/settings/PartEditPanel', part('the edit panel body'));
    await declareUnpairable(page, 'restaurant/settings/PartRenewalForm', part('the document upload panel body'));
    await declareUnpairable(page, 'restaurant/settings/PartSupport', part('the contact support panel body (identical to the copy in restaurant/payouts)'));
    await declareUnpairable(page, 'restaurant/settings/PartDevice', part('the This device section (identical to the copy in restaurant/payouts)'));
    await declareUnpairable(page, 'restaurant/settings/PartWhatsNew', part('the release notes list, which the app does not have yet'));
    await declareUnpairable(page, 'restaurant/settings/PartNotifications', part('the notifications panel body, which the console does not have yet'));
    await declareUnpairable(page, 'restaurant/settings/PartTop', part('the app bar (identical to the copy in restaurant/payouts)'));
    await declareUnpairable(page, 'restaurant/settings/PartRail', part('the side navigation; it is drawn on every page and compared by the shell spec'));
    await declareUnpairable(page, 'restaurant/settings/PartNewOrders', part('the orders strip (belongs to the live orders area)'));
    await declareUnpairable(page, 'restaurant/settings/PartRejectReason', part('the decline-an-order form (belongs to the live orders area; identical to the copy in restaurant/payouts)'));
    await declareUnpairable(page, 'restaurant/settings/PartPayoutTable', part('the payouts table (belongs to the payouts area; renders the same pixels as the restaurant/payouts copy)'));
    await declareUnpairable(page, 'restaurant/settings/PartPayoutDetail', part('the payout panel body (belongs to the payouts area; renders the same pixels as the restaurant/payouts copy)'));
    await declareUnpairable(page, 'restaurant/settings/Reflow-Settings-320', phone('320 px'));
    await declareUnpairable(page, 'restaurant/settings/Reflow-Settings-720', phone('720 px'));
  });
});
