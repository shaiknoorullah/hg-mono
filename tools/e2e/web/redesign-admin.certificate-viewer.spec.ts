import { expect, test, type Page, type Route } from '@playwright/test';

import { declareUnpairable, expectDesignFor, type BoardFor } from './design';
import { E2E_MODE } from './mode';
import { routeLogin, signIn, type StaffRole } from './redesign-admin.support';

test.skip(E2E_MODE !== 'mock', 'written against the mock server; run with E2E_MODE=mock');

/**
 * The redesigned admin console's halal certificate viewer (`/certificates/:certificateId/viewer`),
 * each state captured for the design board it must match (tools/e2e/README.md, "Design captures").
 *
 * Boards are drawn at 1440 wide, so the tablet project takes no capture for the two that pair.
 * Mock mode: the document link and the scan itself are answered with `page.route`, which is the
 * only way to give the stateless mock a link that has expired, a storage service that does not
 * answer, or a certificate with no document. The scan is a drawn stand-in served from a made-up
 * host; no real document is involved.
 *
 * Boards that are not compared one to one, and why:
 *  - `Viewer-States`, `Viewer-More` and `Viewer-Limits` each draw several states of the narrow
 *    scan pane side by side; the viewer shows one state at the full width.
 *  - `Viewer-1280` and `Viewer-Zoom200` are drawn at 1280 and at 720 by 1340; no viewport of
 *    this suite has either size.
 * Not built, so not captured: `Viewer-ThumbsLoading` (the page thumbnails; the contract does not
 * say how many pages a document has).
 */
const BASE = process.env.E2E_ADMIN_REDESIGN_URL ?? process.env.BASE_URL;
if (BASE) test.use({ baseURL: BASE });

const CERTIFICATE_ID = 'd0f9addb-e1ea-4033-adee-54218d471aae';
const DOCUMENT_HOST = 'https://files.halalgoes.test';

/** A drawn page standing in for the scan, in the colours of the page it sits on. */
const SCAN = `<svg xmlns="http://www.w3.org/2000/svg" width="560" height="724" viewBox="0 0 560 724"><rect width="560" height="724" fill="#fff"/><rect x="24" y="24" width="512" height="676" fill="none" stroke="#999"/><text x="280" y="360" font-family="sans-serif" font-size="22" text-anchor="middle" fill="#555">Certificate scan, page 1</text></svg>`;

const inMinutes = (m: number) => new Date(Date.now() + m * 60_000).toISOString();
const envelope = (code: string) => ({ error: { code, message: 'e2e', request_id: 'req_e2e' } });

interface Opts {
  role?: StaffRole;
  /** The `expires_at` the document link comes with. */
  expiresAt?: string;
  /** Answer the document link request with this instead of a link. */
  link?: (route: Route) => Promise<void>;
  /** Change what the mock says about the certificate. */
  certificate?: (cert: Record<string, unknown>) => Record<string, unknown>;
  /** Refuse the certificate itself with this status. */
  certificateStatus?: number;
}

async function openViewer(page: Page, opts: Opts = {}) {
  await routeLogin(page, opts.role ?? 'ADMIN');
  await page.route('**/v1/admin/halal-certificates/*', async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    if (opts.certificateStatus) return route.fulfill({ status: opts.certificateStatus, json: envelope(opts.certificateStatus === 404 ? 'NOT_FOUND' : 'INTERNAL_ERROR') });
    const response = await route.fetch();
    const json = (await response.json()) as { data: Record<string, unknown> };
    json.data = { ...json.data, id: CERTIFICATE_ID, ...(opts.certificate ? opts.certificate(json.data) : {}) };
    return route.fulfill({ response, json });
  });
  await page.route('**/v1/documents/*/download-url', async (route) => {
    if (opts.link) return opts.link(route);
    return route.fulfill({ json: { data: { url: `${DOCUMENT_HOST}/certificates/e2e/scan.svg?X-Amz-Signature=e2e`, expires_at: opts.expiresAt ?? inMinutes(2) } } });
  });
  await page.route(`${DOCUMENT_HOST}/**`, (route) => route.fulfill({ contentType: 'image/svg+xml', body: SCAN }));
  await page.goto('/');
  await signIn(page);
  await expect(page.locator('#app-bar-heading')).toBeVisible();
  await page.evaluate((id) => {
    window.location.hash = `#/certificates/${id}/viewer`;
  }, CERTIFICATE_ID);
  await expect(page.locator('#app-bar-heading')).toHaveText('Certificate scan');
}

async function capture(page: Page, board: BoardFor) {
  await page.waitForLoadState('networkidle');
  // A build older than the screen draws "Not built yet"; that is not the board's state.
  await expect(page.getByText('Not built yet')).toHaveCount(0);
  await expectDesignFor(page, board);
}

async function settled(page: Page) {
  await page.waitForLoadState('networkidle');
  await expect(page.getByText('Not built yet')).toHaveCount(0);
}

test.describe('redesigned admin · certificate viewer (mock)', () => {
  test.use({ colorScheme: 'light' });

  test('the scan from a private link, with the transcription beside it', async ({ page }) => {
    await openViewer(page);
    await expect(page.getByRole('img', { name: 'Halal certificate scan' })).toBeVisible();
    await expect(page.getByText(/Private link valid until/)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Transcription' })).toBeVisible();
    await capture(page, { 1440: 'admin/restaurant-verification/Viewer' });
  });

  test('the scan at the 1280 and 720 by 1340 sizes', async ({ page }) => {
    await openViewer(page);
    await expect(page.getByRole('img', { name: 'Halal certificate scan' })).toBeVisible();
    await settled(page);
    await declareUnpairable(page, 'admin/restaurant-verification/Viewer-1280', 'The board is drawn 1280 wide; this suite captures at 1440 and 1024.');
    await declareUnpairable(page, 'admin/restaurant-verification/Viewer-Zoom200', 'The board is the console at 200 percent zoom, 720 by 1340 CSS pixels; this suite has no viewport of that size.');
  });

  test('zoomed in and turned a quarter', async ({ page }) => {
    await openViewer(page);
    await expect(page.getByRole('img', { name: 'Halal certificate scan' })).toBeVisible();
    await page.getByRole('button', { name: 'Zoom in' }).click();
    await page.getByRole('button', { name: 'Rotate' }).click();
    await expect(page.getByText('125%')).toBeVisible();
    await settled(page);
    await declareUnpairable(page, 'admin/restaurant-verification/Viewer-Limits', 'The board draws the zoom limit, a rotated page and keyboard focus side by side in three narrow panes; the viewer shows one state at the full width.');
  });

  test('no document attached', async ({ page }) => {
    await openViewer(page, { certificate: () => ({ document_id: null }) });
    await expect(page.getByRole('heading', { name: 'No certificate document is attached' })).toBeVisible();
    await capture(page, { 1440: 'admin/restaurant-verification/Viewer-NoDocument' });
  });

  test('the private link has expired', async ({ page }) => {
    await openViewer(page, { expiresAt: new Date(Date.now() - 1000).toISOString() });
    await expect(page.getByText('This link expired')).toBeVisible();
    await expect(page.getByRole('img', { name: 'Halal certificate scan' })).toHaveCount(0);
    await settled(page);
    await declareUnpairable(page, 'admin/restaurant-verification/Viewer-States', 'The board draws loading, expired and failed side by side in three narrow panes; the viewer shows one state at the full width.');
  });

  test('a new link after the old one expired', async ({ page }) => {
    let asked = 0;
    await openViewer(page, {
      link: (route) => {
        asked += 1;
        const expires = asked === 1 ? new Date(Date.now() - 1000).toISOString() : inMinutes(2);
        return route.fulfill({ json: { data: { url: `${DOCUMENT_HOST}/certificates/e2e/scan.svg?X-Amz-Signature=e2e-${asked}`, expires_at: expires } } });
      },
    });
    await page.getByRole('button', { name: 'Get a new link' }).click();
    await expect(page.getByRole('img', { name: 'Halal certificate scan' })).toBeVisible();
    expect(asked).toBe(2);
  });

  test('the storage service does not answer', async ({ page }) => {
    await openViewer(page, { link: (route) => route.fulfill({ status: 500, json: envelope('INTERNAL_ERROR') }) });
    await expect(page.getByText('The document didn’t load')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  });

  test('a support agent is refused before any link is made', async ({ page }) => {
    let asked = 0;
    await openViewer(page, {
      role: 'SUPPORT_AGENT',
      certificate: () => ({ document_id: null, certified_address: null }),
      link: (route) => {
        asked += 1;
        return route.fulfill({ status: 403, json: envelope('FORBIDDEN') });
      },
    });
    await expect(page.getByRole('heading', { name: 'Support agents can’t open documents' })).toBeVisible();
    await settled(page);
    expect(asked).toBe(0);
    await declareUnpairable(page, 'admin/restaurant-verification/Viewer-More', 'The board draws PDF, one page failed, the 403 and no document side by side in four narrow panes; the viewer shows one state at the full width.');
  });

  test('the certificate does not exist', async ({ page }) => {
    await openViewer(page, { certificateStatus: 404 });
    await expect(page.getByRole('heading', { name: 'This certificate doesn’t exist' })).toBeVisible();
  });
});
