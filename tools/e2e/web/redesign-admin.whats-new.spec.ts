import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { ROOT } from '../lib/paths.mjs';
import { expectDesignFor, type BoardFor } from './design';
import { E2E_MODE, projectMeta } from './mode';
import { signIn, signInAndOpen, type StaffRole } from './redesign-admin.support';

test.skip(E2E_MODE !== 'mock', 'written against the mock server; run with E2E_MODE=mock');

/**
 * What's new in the redesigned admin console (issue 102, https://github.com/shaiknoorullah/hg-mono/issues/102):
 * the update notice, "Not now", the panel in each of its states, the queue behind a panel with unsent
 * input, focus on return, and the 720 and 320 px layouts, each captured for the design board it must
 * match (tools/e2e/README.md, "Design captures").
 *
 * What a device has seen is the browser's own storage, so each test sets it before the page loads; the
 * notes file is a separate chunk (`release-notes`), which `page.route` holds, fails or empties to reach
 * the loading, error and empty boards. The boards draw the Staff page behind the notice (the Support
 * board draws Live alerts), so that is the page opened.
 *
 * Board ids are written out in full on purpose: tools/e2e/web/check-boards.mjs validates only literal ids.
 */
const BASE = process.env.E2E_ADMIN_REDESIGN_URL ?? process.env.BASE_URL;
if (BASE) test.use({ baseURL: BASE });

const LAST_SEEN = 'hg-admin-whatsnew:last-seen';
const OPENED = 'hg-admin-whatsnew:opened';
const CURRENT = (JSON.parse(readFileSync(path.join(ROOT, 'apps', 'admin', 'package.json'), 'utf8')) as { version: string }).version;

/** never: a first sign-in on this device · older: updated since · noticed: "Not now" was pressed · current: up to date. */
type Seen = 'never' | 'older' | 'noticed' | 'current';
const STORED: Record<Seen, Record<string, string>> = {
  never: {},
  older: { [LAST_SEEN]: '0.9.0', [OPENED]: '0.9.0' },
  noticed: { [LAST_SEEN]: CURRENT, [OPENED]: '0.9.0' },
  current: { [LAST_SEEN]: CURRENT, [OPENED]: CURRENT },
};

/** Sets what the device has seen once per tab, so a reload or a second sign-in keeps what the page stored since. */
async function seed(page: Page, seen: Seen) {
  await page.addInitScript((items) => {
    if (window.sessionStorage.getItem('e2e-seeded')) return;
    window.sessionStorage.setItem('e2e-seeded', '1');
    for (const [k, v] of Object.entries(items)) window.localStorage.setItem(k, v);
  }, STORED[seen]);
}

type Chunk = 'ok' | 'hold' | 'fail' | 'empty' | { until: Promise<void> };

/** How the notes chunk answers. `hold` never does, so the panel stays on its loading board. */
async function routeNotes(page: Page, chunk: Chunk) {
  if (chunk === 'ok') return;
  await page.route('**/*release-notes*', async (route) => {
    if (chunk === 'hold') return new Promise<void>(() => undefined);
    if (chunk === 'fail') return route.abort('failed');
    if (chunk === 'empty') return route.fulfill({ status: 200, contentType: 'text/javascript', body: 'export default [];' });
    await chunk.until;
    return route.continue();
  });
}

interface Open {
  role?: StaffRole;
  hash?: string;
  seen?: Seen;
  chunk?: Chunk;
}

async function open(page: Page, { role = 'SUPER_ADMIN', hash = '/staff', seen = 'older', chunk = 'ok' }: Open = {}) {
  await seed(page, seen);
  await routeNotes(page, chunk);
  await signInAndOpen(page, role, hash);
}

const whatsNew = (page: Page) => page.getByTestId('whats-new-trigger');
const notice = (page: Page) => page.getByRole('region', { name: 'Console update' });
const panel = (page: Page) => page.getByTestId('whats-new-panel');

/** `waitFor networkidle` is skipped where a request is held on purpose. */
async function capture(page: Page, board: BoardFor, { idle = true }: { idle?: boolean } = {}) {
  if (idle) await page.waitForLoadState('networkidle');
  await expect(page.getByText('Not built yet')).toHaveCount(0);
  await expectDesignFor(page, board);
}

test.describe('redesigned admin · what’s new (mock)', () => {
  test.use({ colorScheme: 'light', storageState: { cookies: [], origins: [] } });

  test('the notice after an update, and the same at 1024 wide', async ({ page }) => {
    await open(page);
    await expect(notice(page)).toContainText('1 version since you last looked');
    await capture(page, { 1440: 'admin/alerts-sessions-system/WhatsNewNotice', 1024: 'admin/alerts-sessions-system/WhatsNewNarrow' });
  });

  test('the notice on a first sign-in on this device', async ({ page }) => {
    await open(page, { seen: 'never' });
    await expect(notice(page)).toContainText('The admin console is on version');
    await capture(page, 'admin/alerts-sessions-system/WhatsNewFirstDevice');
  });

  test('after Not now: no notice, and the New label stays', async ({ page }) => {
    await open(page);
    await notice(page).getByRole('button', { name: 'Not now' }).click();
    await expect(notice(page)).toHaveCount(0);
    await expect(whatsNew(page)).toContainText('New');
    await capture(page, 'admin/alerts-sessions-system/WhatsNewAfterNotNow');
  });

  test('signed in again after Not now: no notice, and the New label stays', async ({ page }) => {
    await open(page);
    await notice(page).getByRole('button', { name: 'Not now' }).click();
    await page.getByRole('button', { name: /^Sign out/ }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible();
    await signIn(page);
    await expect(page.locator('#app-bar-heading')).toBeVisible();
    await page.evaluate(() => {
      window.location.hash = '#/staff';
    });
    await expect(page.locator('#app-bar-heading')).toHaveText('Staff');
    await expect(whatsNew(page)).toContainText('New');
    await expect(notice(page)).toHaveCount(0);
    await capture(page, 'admin/alerts-sessions-system/WhatsNewReturns');
  });

  test('the panel, as a super admin', async ({ page }) => {
    await open(page);
    await notice(page).getByRole('button', { name: /See what’s new/ }).click();
    await expect(panel(page)).toContainText('You last looked on console version 0.9.0.');
    await capture(page, 'admin/alerts-sessions-system/WhatsNewPanel');
  });

  test('the panel, as an admin: role-filtered', async ({ page }) => {
    await open(page, { role: 'ADMIN' });
    await notice(page).getByRole('button', { name: /See what’s new/ }).click();
    await expect(panel(page)).toContainText('Showing changes for admins, newest first.');
    await capture(page, 'admin/alerts-sessions-system/WhatsNewAdmin');
  });

  test('the panel, as a support agent: role-filtered', async ({ page }) => {
    await open(page, { role: 'SUPPORT_AGENT', hash: '/alerts' });
    await notice(page).getByRole('button', { name: /See what’s new/ }).click();
    await expect(panel(page)).toContainText('Showing changes for support agents, newest first.');
    await capture(page, 'admin/alerts-sessions-system/WhatsNewSupport');
  });

  test('reopened with nothing new', async ({ page }) => {
    await open(page, { seen: 'current' });
    await expect(whatsNew(page)).toBeVisible();
    await whatsNew(page).click();
    await expect(panel(page)).toContainText('You’re up to date');
    await capture(page, 'admin/alerts-sessions-system/WhatsNewUpToDate');
  });

  test('closed: focus is back on What’s new in the sidebar', async ({ page }) => {
    await open(page);
    await whatsNew(page).click();
    await expect(panel(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(panel(page)).toHaveCount(0);
    await expect(whatsNew(page)).toBeFocused();
    await expect(whatsNew(page)).not.toContainText('New');
    await capture(page, 'admin/alerts-sessions-system/WhatsNewFocusReturn');
  });

  test('the notes are loading', async ({ page }) => {
    await open(page, { chunk: 'hold' });
    await whatsNew(page).click();
    await expect(panel(page)).toContainText('Loading notes…');
    await capture(page, 'admin/alerts-sessions-system/WhatsNewLoading', { idle: false });
  });

  test('there are no notes', async ({ page }) => {
    await open(page, { seen: 'current', chunk: 'empty' });
    await whatsNew(page).click();
    await expect(panel(page)).toContainText('No release notes yet');
    await capture(page, 'admin/alerts-sessions-system/WhatsNewEmpty');
  });

  test('the notes could not be read', async ({ page }) => {
    await open(page, { chunk: 'fail' });
    await whatsNew(page).click();
    await expect(panel(page)).toContainText('The release notes couldn’t be read');
    await capture(page, 'admin/alerts-sessions-system/WhatsNewError');
  });

  test('opened offline: the notes come with the app', async ({ page }) => {
    await open(page);
    await expect(notice(page)).toBeVisible();
    await page.context().setOffline(true);
    await whatsNew(page).click();
    await expect(panel(page)).toContainText('You’re offline, but these notes come with the app, so they still show.');
    await capture(page, 'admin/alerts-sessions-system/WhatsNewOffline');
    await page.context().setOffline(false);
  });

  test('an update that arrives with the invite panel open is queued', async ({ page }) => {
    let arrive: () => void = () => undefined;
    const until = new Promise<void>((resolve) => {
      arrive = resolve;
    });
    await open(page, { chunk: { until } });
    await page.getByRole('button', { name: 'Invite staff' }).click();
    await expect(page.getByRole('heading', { name: 'Invite a staff member' })).toBeVisible();
    await page.getByLabel('Full name').fill('Idris Okafor');
    arrive();
    await expect(whatsNew(page)).toContainText('New');
    await expect(notice(page)).toHaveCount(0);
    await capture(page, 'admin/alerts-sessions-system/WhatsNewQueued');
    // The invite is cancelled: the notice shows.
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(notice(page)).toBeVisible();
  });
});

test.describe('redesigned admin · what’s new at 200% zoom and 320 px (mock)', () => {
  test.use({ colorScheme: 'light', storageState: { cookies: [], origins: [] } });

  test('720 px: the panel takes the content area', async ({ page }) => {
    test.skip(projectMeta().viewport !== 'desktop', 'sized by the test, once');
    await page.setViewportSize({ width: 720, height: 1100 });
    await open(page);
    await page.getByRole('button', { name: 'Open navigation' }).click();
    await page.getByTestId('whats-new-trigger').click();
    await expect(page.getByRole('button', { name: 'Back to Staff' })).toBeVisible();
    await capture(page, { 720: 'admin/alerts-sessions-system/WhatsNewZoom200' });
  });

  test('320 px: the panel takes the content area', async ({ page }) => {
    test.skip(projectMeta().viewport !== 'desktop', 'sized by the test, once');
    await page.setViewportSize({ width: 320, height: 1100 });
    await open(page);
    await page.getByRole('button', { name: 'Open navigation' }).click();
    await page.getByTestId('whats-new-trigger').click();
    await expect(page.getByRole('button', { name: 'Back to Staff' })).toBeVisible();
    await capture(page, { 320: 'admin/alerts-sessions-system/WhatsNewReflow320' });
  });
});
