import { expect, test, type Page, type Route } from '@playwright/test';

import { at1440, expectDesignFor, type BoardFor } from './design';
import { MODE, openSignedIn, scenarioPayload as fixture, torontoDateIn as torontoDate } from './redesign-restaurant.support';

test.skip(MODE !== 'mock', 'written against the mock server; run with E2E_MODE=mock');

/**
 * The redesigned restaurant console's "send another document" sheet and the two states of the upload
 * panel the settings spec could not reach, each captured for the design board it must match
 * (tools/e2e/README.md, "Design captures"). These are seven of the boards the settings spec lists as
 * having no screen ([#883](https://github.com/shaiknoorullah/hg-mono/issues/883)):
 *   - `Doc-Upload`, `Doc-UploadLicence`, `Doc-UploadOwnerId`, `Doc-Ready` and `Doc-Sent`: the sheet that
 *     sends a new version of the food safety certificate, the business licence or the owner ID, opened from
 *     the Documents section;
 *   - `Renew-Cancel`: cancelling an upload in flight asks first;
 *   - `Renew-TooEarly`: the server turned a renewal away because uploads are not open yet (409
 *     `STEP_NOT_AVAILABLE`), and the page says from which date.
 *
 * Mock mode: every state is served with `page.route` from the mock's own fixtures, and the upload
 * road (create, the PUT to the presigned address, confirm, attach, submit) is walked for real.
 *
 * It lives in its own file so the settings spec, which already accounts for the other boards in the
 * area, stays as it is; its header still lists these seven as "no screen yet" until it is next edited.
 *
 * Expect these captures to be reported as a mismatch: the area-wide differences that every settings
 * board shows (the rail width and the card border, tracked in the issues the settings spec names) apply
 * here too, and what remains is content and state, not a defect of the sheet.
 *
 * Board ids are written out in full on purpose: tools/e2e/web/check-boards.mjs validates only
 * literal ids.
 */

const never = () => new Promise<void>(() => undefined);

const problem = (status: number, code: string) => ({ status, json: { error: { code, message: code, request_id: 'req_e2e' } } });

interface Road {
  /** The PUT to the presigned address: finishes, or never does (an upload still in flight). */
  put?: 'ok' | 'never';
  /** attachRestaurantDocument: the document is stored, or the server says uploads are not open yet. */
  attach?: 'ok' | 'too-early';
  /** The document pack, which the attach call changes for the doc type it names. */
  docs?: (docs: any[]) => any[];
  profile?: (p: any) => any;
}

/** Serves the profile, the document pack and the whole upload road; returns what the pack looks like now. */
async function serve(page: Page, o: Road = {}) {
  const presigned = await fixture(page, 'presigned_upload');
  const ready = await fixture(page, 'stored_object_ready');
  const profile = (o.profile ?? ((p) => p))(await fixture(page, 'restaurant_profile_halal_certified'));
  let pack: any[] = (o.docs ?? ((d) => d))(await fixture(page, 'restaurant_document_pack_complete'));
  await page.route('**/v1/restaurant/profile', (route) => route.fulfill({ json: { data: profile } }));
  await page.route('**/v1/uploads', (route) => route.fulfill({ status: 201, json: { data: presigned } }));
  await page.route(presigned.url, (route) => (o.put === 'never' ? never() : route.fulfill({ status: 200, body: '' })));
  await page.route('**/v1/uploads/*/confirm', (route) => route.fulfill({ json: { data: ready } }));
  await page.route('**/v1/restaurant/documents', (route: Route) => {
    const req = route.request();
    if (req.method() === 'GET') return route.fulfill({ json: { data: pack } });
    if (o.attach === 'too-early') return route.fulfill(problem(409, 'STEP_NOT_AVAILABLE'));
    const sent = req.postDataJSON();
    const before = pack.find((d) => d.doc_type === sent.doc_type);
    const next = { ...before, state: 'SUBMITTED', version: (before?.version ?? 0) + 1, valid_until: sent.valid_until ?? before?.valid_until };
    pack = [...pack.filter((d) => d.doc_type !== sent.doc_type), next];
    return route.fulfill({ status: 201, json: { data: next } });
  });
  await page.route('**/v1/restaurant/documents/submit', (route) => route.fulfill({ json: { data: { onboarding_state: 'DOCUMENTS_REVIEW' } } }));
}

async function capture(page: Page, board: BoardFor, { settled = true } = {}) {
  if (settled) await page.waitForLoadState('networkidle');
  await expect(page.getByText('Not built yet')).toHaveCount(0);
  await expectDesignFor(page, at1440(board));
}

const FILE = (name: string) => ({ name, mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 a document') });
const choose = (page: Page, name: string) => page.locator('input[type="file"]').setInputFiles(FILE(name));
const sheet = (page: Page) => page.getByTestId('doc-shell');

test.describe('redesigned restaurant settings · send another document (mock)', () => {
  test.use({ colorScheme: 'light' });

  test('food safety certificate: choose a file', async ({ page }) => {
    await serve(page);
    await openSignedIn(page, '/settings/documents?panel=upload-doc&doc=FOOD_SAFETY');
    await expect(sheet(page).getByRole('heading', { name: 'Upload food safety certificate' })).toBeVisible();
    await capture(page, 'restaurant/settings/Doc-Upload');
  });

  test('business licence: choose a file', async ({ page }) => {
    await serve(page);
    await openSignedIn(page, '/settings/documents?panel=upload-doc&doc=BUSINESS_LICENCE');
    await expect(sheet(page).getByRole('heading', { name: 'Upload business licence' })).toBeVisible();
    await capture(page, 'restaurant/settings/Doc-UploadLicence');
  });

  test('owner ID: file chosen, details to fill', async ({ page }) => {
    await serve(page);
    await openSignedIn(page, '/settings/documents?panel=upload-doc&doc=OWNER_ID');
    await choose(page, 'owner-id.pdf');
    await expect(page.getByRole('form', { name: /^Details for/ })).toBeVisible();
    await capture(page, 'restaurant/settings/Doc-UploadOwnerId');
  });

  test('food safety certificate: file uploaded, details filled in', async ({ page }) => {
    await serve(page);
    await openSignedIn(page, '/settings/documents?panel=upload-doc&doc=FOOD_SAFETY');
    await choose(page, 'food-safety-2027.pdf');
    await page.locator('#food-safety-valid').fill(torontoDate(365));
    await expect(page.getByRole('button', { name: /^Save document/ })).toBeEnabled();
    await capture(page, 'restaurant/settings/Doc-Ready');
  });

  test('food safety certificate: sent for review', async ({ page }) => {
    await serve(page);
    await openSignedIn(page, '/settings/documents?panel=upload-doc&doc=FOOD_SAFETY');
    await choose(page, 'food-safety-2027.pdf');
    await page.locator('#food-safety-valid').fill(torontoDate(365));
    await page.getByRole('button', { name: /^Save document/ }).click();
    await expect(page.getByTestId('hg-toast').getByText('Food safety certificate sent for review')).toBeVisible();
    await expect(sheet(page)).toHaveCount(0);
    await expect(page.getByTestId('doc-FOOD_SAFETY')).toHaveAttribute('data-state', 'SUBMITTED');
    await capture(page, 'restaurant/settings/Doc-Sent');
  });
});

test.describe('redesigned restaurant settings · the upload panel, cancel and too early (mock)', () => {
  test.use({ colorScheme: 'light' });

  test('cancelling an upload in flight asks first', async ({ page }) => {
    await serve(page, { put: 'never', profile: (p) => ({ ...p, halal: { ...p.halal, display_state: 'CERTIFIED', expires_on: torontoDate(45) } }) });
    await openSignedIn(page, '/settings/halal?panel=renew');
    await choose(page, 'halal-certificate-2027.pdf');
    await expect(page.getByTestId('upload-progress')).toBeVisible();
    await page.getByRole('button', { name: /^Cancel upload of/ }).click();
    await expect(page.getByTestId('renew-cancel-confirm')).toBeVisible();
    await capture(page, 'restaurant/settings/Renew-Cancel', { settled: false });
  });

  test('the server says uploads are not open yet', async ({ page }) => {
    await serve(page, { attach: 'too-early', profile: (p) => ({ ...p, halal: { ...p.halal, display_state: 'CERTIFIED', expires_on: torontoDate(400) } }) });
    await openSignedIn(page, '/settings/halal?panel=renew');
    await choose(page, 'halal-certificate-2027.pdf');
    await page.getByLabel('Issuing body').fill('HMA Canada');
    await page.locator('#halal-certificate-valid').fill(torontoDate(765));
    await page.getByRole('button', { name: /^Save document/ }).click();
    await expect(page.getByTestId('renew-too-early')).toBeVisible();
    await capture(page, 'restaurant/settings/Renew-TooEarly');
  });
});
