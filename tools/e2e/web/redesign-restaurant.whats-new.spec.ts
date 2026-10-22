import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { ROOT } from '../lib/paths.mjs';
import { declareUnpairable, expectDesignFor, type BoardFor } from './design';
import { MOCK_API, MODE, openLive, openSignedIn } from './redesign-restaurant.support';

test.skip(MODE !== 'mock', 'written against the mock server; run with E2E_MODE=mock');

/**
 * What's new in the redesigned restaurant console (issue 101, https://github.com/shaiknoorullah/hg-mono/issues/101):
 * the panel that opens once after an update, the Settings section with its loading, error and
 * up-to-date states, each captured for the design board it must match (tools/e2e/README.md,
 * "Design captures"). These are the eight `WhatsNew-*` boards and `PartWhatsNew` of the settings area
 * ([#883](https://github.com/shaiknoorullah/hg-mono/issues/883)):
 *
 *   - captured: `WhatsNew-AfterUpdate` (over Payouts), `WhatsNew-OnOrders` (over Live orders),
 *     `WhatsNew-Page`, `WhatsNew-Loading`, `WhatsNew-Error`, `WhatsNew-UpToDate`;
 *   - declared unpairable, with the reason on each: `WhatsNew-Interrupted` (a new order arrives over the
 *     live connection, which the mock server cannot send; the unit tests cover that the panel stays),
 *     `WhatsNew-FirstRun` (it draws the "Get set up" checklist, a different feature from release notes),
 *     and `PartWhatsNew` (declared by redesign-restaurant.settings.spec.ts with the other component boards).
 *
 * What a device has seen is the browser's own storage, so each test sets it before the page loads; the
 * notes file is a separate chunk (`release-notes`), which `page.route` holds, fails or empties to reach
 * the loading, error and up-to-date boards.
 *
 * Board ids are written out in full on purpose: tools/e2e/web/check-boards.mjs validates only literal ids.
 */
const LAST_SEEN = 'hg.restaurant.whatsnew.last-seen';
const CURRENT = (JSON.parse(readFileSync(path.join(ROOT, 'apps', 'restaurant', 'package.json'), 'utf8')) as { version: string }).version;

/** never: a first sign-in on this device · older: updated since · current: up to date. */
type Seen = 'never' | 'older' | 'current';
const STORED: Record<Seen, Record<string, string>> = {
  never: {},
  older: { [LAST_SEEN]: '0.9.0' },
  current: { [LAST_SEEN]: CURRENT },
};

type Chunk = 'ok' | 'hold' | 'fail' | 'empty';

async function fixture<T = any>(page: Page, name: string): Promise<T> {
  const res = await page.request.get(`${MOCK_API}/__mock/scenarios/${name}`);
  return (await res.json()).data.payload;
}

/** The calls the pages under the panel make (Payouts and Settings), answered from the mock's fixtures. */
async function routePages(page: Page) {
  const profile = await fixture(page, 'restaurant_profile_account_live');
  const docs = await fixture(page, 'restaurant_document_pack_complete');
  const connect = await fixture(page, 'connect_status_complete');
  await page.route('**/v1/restaurant/profile', (route) => route.fulfill({ json: { data: profile } }));
  await page.route('**/v1/restaurant/documents', (route) => (route.request().method() === 'GET' ? route.fulfill({ json: { data: docs } }) : route.fallback()));
  await page.route('**/v1/connect/status', (route) => route.fulfill({ json: { data: connect } }));
  await page.route(/\/v1\/restaurant\/payouts(\?|$)/, (route) => route.fulfill({ json: { data: [], meta: { next_cursor: null, has_more: false, total: null } } }));
}

async function open(page: Page, url: string, { seen = 'older', chunk = 'ok', live = false }: { seen?: Seen; chunk?: Chunk; live?: boolean } = {}) {
  await page.addInitScript((items) => {
    if (window.sessionStorage.getItem('e2e-seeded')) return;
    window.sessionStorage.setItem('e2e-seeded', '1');
    for (const [k, v] of Object.entries(items)) window.localStorage.setItem(k, v);
  }, STORED[seen]);
  if (chunk !== 'ok') {
    await page.route('**/*release-notes*', async (route) => {
      if (chunk === 'hold') return new Promise<void>(() => undefined);
      if (chunk === 'fail') return route.abort('failed');
      return route.fulfill({ status: 200, contentType: 'text/javascript', body: 'export default [];' });
    });
  }
  await routePages(page);
  if (live) await openLive(page, url);
  else await openSignedIn(page, url);
}

async function capture(page: Page, board: BoardFor, { settled = true } = {}) {
  // A chunk that is held on purpose keeps the network busy for good: that state is captured as it is.
  if (settled) await page.waitForLoadState('networkidle');
  await expect(page.getByText('Not built yet')).toHaveCount(0);
  await expectDesignFor(page, board);
}

const panel = (page: Page) => page.getByTestId('whats-new-panel');

test.describe('redesigned restaurant · what’s new panel (mock)', () => {
  test.use({ colorScheme: 'light', storageState: { cookies: [], origins: [] } });

  test('opens beside Payouts after an update', async ({ page }) => {
    await open(page, '/payouts');
    await expect(panel(page)).toContainText('since you last looked');
    await capture(page, 'restaurant/settings/WhatsNew-AfterUpdate');
  });

  test('opens beside Live orders after an update', async ({ page }) => {
    await open(page, '/orders', { live: true });
    await expect(panel(page)).toContainText('since you last looked');
    await capture(page, 'restaurant/settings/WhatsNew-OnOrders');
  });

  test('a new order does not close it', async ({ page }) => {
    await open(page, '/payouts');
    await expect(panel(page)).toBeVisible();
    // The board draws a new order arriving over the live connection, which the mock server cannot
    // send. The unit tests (apps/restaurant/src/redesign/whatsnew) check the panel stays open.
    await declareUnpairable(
      page,
      'restaurant/settings/WhatsNew-Interrupted',
      'a new order arrives over the live connection while the panel is open; the mock server cannot push one, so the state cannot be reached here (the unit tests cover that the panel stays)',
    );
  });

  test('a first sign-in on this device', async ({ page }) => {
    await open(page, '/orders', { seen: 'never', live: true });
    await expect(panel(page)).toBeVisible();
    await declareUnpairable(
      page,
      'restaurant/settings/WhatsNew-FirstRun',
      'the board draws the "Get set up" checklist (order sound, notifications, payouts), a different feature from the release notes; the app shows only the latest release’s notes on a first device, as the canvas note says (the checklist is tracked in https://github.com/shaiknoorullah/hg-mono/issues/1055)',
    );
  });
});

test.describe('redesigned restaurant · what’s new in Settings (mock)', () => {
  test.use({ colorScheme: 'light', storageState: { cookies: [], origins: [] } });

  test('every release, newest first', async ({ page }) => {
    await open(page, '/settings/whatsnew', { seen: 'current' });
    await expect(page.getByTestId('whats-new-list')).toBeVisible();
    await capture(page, 'restaurant/settings/WhatsNew-Page');
  });

  test('loading', async ({ page }) => {
    await open(page, '/settings/whatsnew', { seen: 'current', chunk: 'hold' });
    await expect(page.getByTestId('whats-new-loading')).toBeVisible();
    await capture(page, 'restaurant/settings/WhatsNew-Loading', { settled: false });
  });

  test('the notes could not be loaded', async ({ page }) => {
    await open(page, '/settings/whatsnew', { seen: 'current', chunk: 'fail' });
    await expect(page.getByTestId('whats-new-error')).toBeVisible();
    await capture(page, 'restaurant/settings/WhatsNew-Error');
  });

  test('up to date', async ({ page }) => {
    await open(page, '/settings/whatsnew', { seen: 'current', chunk: 'empty' });
    await expect(page.getByTestId('whats-new-up-to-date')).toBeVisible();
    await capture(page, 'restaurant/settings/WhatsNew-UpToDate');
  });
});
