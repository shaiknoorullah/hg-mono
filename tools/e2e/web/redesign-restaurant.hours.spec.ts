/**
 * WP9 — Hours and pause (`/hours`), flag on (spec wp9-hours; manifest §2.5, §6 WP9 row).
 *
 * Mock mode (`E2E_MODE` unset or `mock`): the app on `pnpm mock`. The mock is stateless, so
 * the hours PUT and the availability PATCH are answered here with `page.route` (echoing what
 * was sent, the way the server reads it back), and states the contract has no fixture for
 * yet (hours empty, suspended profile) are patched from the closest fixture
 * (`restaurant_hours_standard`, `restaurant_profile`, `restaurant_open_state_*`).
 *
 * Real mode (`E2E_MODE=real`): the app on `services/hg` with devworld personas. Every journey
 * reads the restaurant's state first and puts it back at the end through the API, because
 * other suites share `bismillah-grill`.
 */
import { expect, test, type APIRequestContext, type Page, type Route } from '@playwright/test';
import { mkdirSync, copyFileSync } from 'node:fs';
import { LIVE_OWNER, MOCK_API, MODE, REAL_API, documentScrolls, openSignedIn } from './redesign-restaurant.support';

const SHOTS = process.env.E2E_SHOTS_DIR ?? '/tmp/claude-0/-home-user-hg-mono/d41301d3-8d3a-541d-a6f4-40d847c8b738/scratchpad/shots/wp9';

/** Saves a screenshot in the test's output and, named `<viewport>-<state>.png`, in SHOTS. */
async function shot(page: Page, name: string) {
  const info = test.info();
  const viewport = info.project.name;
  const out = info.outputPath(`${viewport}-${name}.png`);
  await page.screenshot({ path: out });
  try {
    mkdirSync(SHOTS, { recursive: true });
    copyFileSync(out, `${SHOTS}/${viewport}-${name}.png`);
  } catch {
    /* screenshots are evidence, not a test result */
  }
}

async function expectNoDocumentScroll(page: Page) {
  const d = await documentScrolls(page);
  expect(d.scrollHeight).toBeLessThanOrEqual(d.innerHeight);
  expect(d.scrollWidth).toBeLessThanOrEqual(d.innerWidth);
}

async function mockFixture(page: Page, name: string) {
  const res = await page.request.get(`${MOCK_API}/__mock/scenarios/${name}`);
  return (await res.json()).data.payload;
}

/** Restaurant-timezone "YYYY-MM-DD", `days` from today. */
function torontoDate(days: number): string {
  const d = new Date(Date.now() + days * 86_400_000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

// ── Mock mode ────────────────────────────────────────────────────────────────────────────

test.describe('Hours (mock)', () => {
  test.skip(MODE === 'real', 'mock-mode journeys');

  /** Hours GET/PUT backed by an in-test store (the mock forgets every write). */
  async function hoursStore(page: Page, seed?: (h: any) => any) {
    let hours = await mockFixture(page, 'restaurant_hours_standard');
    if (seed) hours = seed(hours);
    const puts: any[] = [];
    await page.route('**/v1/restaurant/hours', async (route: Route) => {
      const req = route.request();
      if (req.method() === 'PUT') {
        const body = req.postDataJSON();
        puts.push(body);
        hours = { timezone: hours.timezone, intervals: body.intervals, overrides: body.overrides ?? [] };
      }
      await route.fulfill({ json: { data: hours } });
    });
    return { puts, get: () => hours };
  }

  async function availabilityStore(page: Page, seed: any) {
    let av = seed;
    const patches: any[] = [];
    await page.route('**/v1/restaurant/availability', async (route: Route) => {
      const req = route.request();
      if (req.method() === 'PATCH') {
        const body = req.postDataJSON();
        patches.push(body);
        const pausing = body.is_accepting_orders && body.pause_until && Date.parse(body.pause_until) > Date.now();
        av = {
          ...av,
          is_accepting_orders: body.is_accepting_orders,
          pause_until: body.is_accepting_orders ? (body.pause_until ?? null) : av.pause_until,
          open_state: !body.is_accepting_orders ? 'CLOSED_TOGGLE' : pausing ? 'PAUSED' : 'OPEN',
          reason: !body.is_accepting_orders ? 'This restaurant has paused new orders.' : pausing ? 'This restaurant is briefly paused and will resume shortly.' : 'Open and accepting orders.',
          resolvable_by: pausing ? 'TIME' : 'RESTAURANT',
        };
      }
      await route.fulfill({ json: { data: av } });
    });
    return { patches };
  }

  const openAv = async (page: Page) => ({
    ...(await mockFixture(page, 'restaurant_open_state_open')),
    pause_until: null,
    missed_order_count: 0,
    reason: 'Open and accepting orders.',
  });

  test('view: Right now, weekly hours with past midnight, special dates; the page does not scroll', async ({ page }) => {
    await hoursStore(page);
    await availabilityStore(page, await openAv(page));
    await openSignedIn(page, '/hours');
    const card = page.getByRole('region', { name: 'Right now' });
    await expect(card).toBeVisible();
    await expect(page.getByTestId('right-now-badge')).toHaveText('Open');
    await expect(card.getByText('You can pause new orders for a short time, or switch them off.')).toBeVisible();
    const table = page.getByRole('table', { name: 'Weekly opening hours' });
    await expect(table.getByRole('row', { name: /Friday/ })).toContainText('11:00 am – 1:00 am');
    await expect(table.getByRole('row', { name: /Friday/ })).toContainText('Past midnight');
    await expect(table.getByRole('row', { name: /Monday/ })).toContainText('11:00 am – 10:00 pm');
    const special = page.getByRole('region', { name: 'Special dates' });
    await expect(special.getByText('Friday 25 December 2026')).toBeVisible();
    await expect(special.getByText('4:00 pm – 10:00 pm')).toBeVisible();
    await expect(special.getByText('Closed for Eid al-Fitr')).toBeVisible();
    await expectNoDocumentScroll(page);
    await shot(page, 'view');
  });

  test('pause: 15, 30 or 60 minutes, each with its end time, none preselected, no "until closing"; then resume with a confirm', async ({ page }) => {
    await hoursStore(page);
    const av = await availabilityStore(page, await openAv(page));
    await openSignedIn(page, '/hours');
    // The Right now card's controls (the status bar on every console page has its own Pause and Resume).
    await page.getByTestId('right-now').getByRole('button', { name: 'Pause new orders' }).click();
    const menu = page.getByRole('menu', { name: 'Pause new orders' });
    const items = menu.getByRole('menuitem');
    await expect(items).toHaveCount(3);
    await expect(items.nth(0)).toHaveText(/^Pause for 15 minutes \(until \d{1,2}:\d{2} (am|pm)( tomorrow)?\)$/);
    await expect(items.nth(1)).toHaveText(/^Pause for 30 minutes \(until /);
    await expect(items.nth(2)).toHaveText(/^Pause for 60 minutes \(until /);
    await expect(menu.getByText(/until closing/i)).toHaveCount(0);
    await expect(menu.locator('[aria-checked="true"]')).toHaveCount(0);
    await shot(page, 'pause-menu');
    await items.nth(1).click();
    await expect(page.getByTestId('right-now-reason')).toHaveText(/^Paused until \d{1,2}:\d{2} (am|pm)\.$/);
    expect(av.patches[0].is_accepting_orders).toBe(true);
    const mins = (Date.parse(av.patches[0].pause_until) - Date.now()) / 60_000;
    expect(mins).toBeGreaterThan(28);
    expect(mins).toBeLessThan(31);
    await expect(page.getByTestId('right-now-badge')).toHaveText('Paused');
    await shot(page, 'paused');
    await page.getByTestId('right-now').getByRole('button', { name: 'Resume now' }).click();
    const confirm = page.getByRole('group', { name: 'Resume new orders now?' });
    await expect(confirm).toBeVisible();
    await expect(confirm.getByRole('button', { name: 'Stay paused' })).toBeFocused();
    await shot(page, 'resume-confirm');
    await confirm.getByRole('button', { name: 'Resume now' }).click();
    await expect(page.getByTestId('right-now-badge')).toHaveText('Open');
    expect(av.patches[1]).toEqual({ is_accepting_orders: true, pause_until: null });
  });

  test('edit: overlap on the same day and past midnight into the next day are caught, the summary takes focus, then the week saves', async ({ page }) => {
    const store = await hoursStore(page);
    await availabilityStore(page, await openAv(page));
    await openSignedIn(page, '/hours');
    await page.getByRole('button', { name: 'Edit hours' }).click();
    const editor = page.getByRole('region', { name: 'Edit weekly hours' });
    await expect(editor).toBeVisible();
    await expect(page.getByTestId('hours-save-bar')).toContainText('No changes yet');
    await shot(page, 'edit');

    // Friday: 11:00 am – 3:00 pm and 2:00 pm – 2:00 am (overlaps), and Saturday opens at 1:00 am.
    const fri = page.locator('fieldset#fri');
    await fri.getByLabel('Closes', { exact: true }).fill('3:00 pm');
    await fri.getByRole('button', { name: 'Add hours on Friday' }).click();
    await fri.getByLabel('Opens, range 2').fill('2:00 pm');
    await fri.getByLabel('Closes, range 2').fill('2:00 am');
    const sat = page.locator('fieldset#sat');
    await sat.getByLabel('Opens', { exact: true }).fill('1:00 am');
    await sat.getByLabel('Closes', { exact: true }).fill('4:00 am');
    await expect(page.getByTestId('hours-save-bar')).toContainText('Unsaved changes · 2 days changed');
    await page.getByRole('button', { name: 'Save hours' }).click();
    const summary = page.getByTestId('hours-error-summary');
    await expect(summary).toBeFocused();
    await expect(summary).toContainText('Fix 2 things to save your hours');
    await expect(summary.getByRole('link', { name: 'Friday: two time ranges overlap' })).toHaveAttribute('href', '#fri');
    await expect(
      summary.getByRole('link', { name: 'Friday and Saturday: Friday 2:00 pm – 2:00 am runs into Saturday 1:00 am – 4:00 am' }),
    ).toBeVisible();
    await expect(fri.getByText('Overlaps 11:00 am – 3:00 pm. Change one of them.')).toBeVisible();
    await expect(sat.getByText('Overlaps Friday 2:00 pm – 2:00 am, which runs to 2:00 am on Saturday. Change one of them.')).toBeVisible();
    expect(store.puts).toHaveLength(0);
    await shot(page, 'overlap');

    // Fix both: Friday 5:00 pm – 2:00 am, Saturday from 2:00 am.
    await fri.getByLabel('Opens, range 2').fill('5:00 pm');
    await sat.getByLabel('Opens', { exact: true }).fill('2:00 am');
    await sat.getByLabel('Closes', { exact: true }).fill('1:00 am');
    await page.getByRole('button', { name: 'Save hours' }).click();
    const closesNow = page.getByRole('alertdialog', { name: 'Save and close now?' });
    await expect(page.getByText('Hours saved').or(closesNow).first()).toBeVisible();
    if (await closesNow.isVisible().catch(() => false)) await closesNow.getByRole('button', { name: 'Save and close now' }).click();
    await expect(page.getByText('Hours saved').first()).toBeVisible();
    const sent = store.puts.at(-1);
    const friday = sent.intervals.filter((i: any) => i.day_of_week === 5);
    expect(friday).toEqual([
      { day_of_week: 5, opens_at: '11:00', closes_at: '15:00', crosses_midnight: false },
      { day_of_week: 5, opens_at: '17:00', closes_at: '02:00', crosses_midnight: true },
    ]);
    // The special dates the server had are kept (the PUT replaces both lists).
    expect(sent.overrides).toHaveLength(2);
    const table = page.getByRole('table', { name: 'Weekly opening hours' });
    await expect(table.getByRole('row', { name: /Friday/ })).toContainText('11:00 am – 3:00 pm');
    await expect(table.getByRole('row', { name: /Friday/ })).toContainText('5:00 pm – 2:00 am');
    await expectNoDocumentScroll(page);
    await shot(page, 'saved');
  });

  test('edit: leaving with unsaved changes asks in the save bar', async ({ page }) => {
    await hoursStore(page);
    await availabilityStore(page, await openAv(page));
    await openSignedIn(page, '/hours');
    await page.getByRole('button', { name: 'Edit hours' }).click();
    await page.locator('fieldset#mon').getByLabel('Closes', { exact: true }).fill('9:00 pm');
    await page.getByTestId('console-rail').getByRole('link', { name: /Live orders/ }).click();
    const ask = page.getByRole('alertdialog', { name: 'Leave without saving?' });
    await expect(ask).toBeVisible();
    await expect(ask).toContainText('You’re going to Live orders.');
    await expect(page).toHaveURL(/\/hours/);
    await shot(page, 'unsaved');
    await ask.getByRole('button', { name: 'Keep editing' }).click();
    await expect(page.getByRole('region', { name: 'Edit weekly hours' })).toBeVisible();
  });

  test('special date: the panel replaces the list, saves straight away with the weekly hours as loaded', async ({ page }) => {
    const store = await hoursStore(page);
    await availabilityStore(page, await openAv(page));
    await openSignedIn(page, '/hours');
    await page.getByRole('button', { name: 'Add a special date' }).click();
    await expect(page).toHaveURL(/date=new/);
    const panel = page.getByRole('complementary', { name: 'Special date' });
    await expect(panel.getByRole('heading', { name: 'Add a special date' })).toBeFocused();
    await expect(page.getByRole('region', { name: 'Special dates' })).toHaveCount(0);
    // Errors first: nothing chosen.
    await panel.getByRole('button', { name: 'Save date' }).click();
    await expect(panel.getByText('Fix 1 thing to add this date')).toBeVisible();
    await expect(panel.getByText('Choose a date.')).toBeVisible();
    const date = torontoDate(40);
    await panel.locator('#sd-date').fill(date);
    await panel.getByLabel('Reason (optional)').fill('Staff training');
    await shot(page, 'special-panel');
    await panel.getByRole('button', { name: 'Save date' }).click();
    await expect(page.getByRole('region', { name: 'Special dates' })).toBeVisible();
    await expect(page.getByText('Staff training')).toBeVisible();
    const sent = store.puts.at(-1);
    expect(sent.overrides).toContainEqual({ date, is_closed: true, opens_at: null, closes_at: null, reason: 'Staff training' });
    expect(sent.intervals).toHaveLength(7);
    await expectNoDocumentScroll(page);
  });

  test('loading error, no hours yet, and the suspended account (still editable)', async ({ page }) => {
    let fail = true;
    await page.route('**/v1/restaurant/hours', (route) =>
      fail
        ? route.fulfill({ status: 500, json: { error: { code: 'INTERNAL_ERROR', message: 'x', request_id: 'r' } } })
        : route.fulfill({ json: { data: { timezone: 'America/Toronto', intervals: [], overrides: [] } } }),
    );
    await availabilityStore(page, await openAv(page));
    await openSignedIn(page, '/hours');
    const alert = page.getByRole('alert').filter({ hasText: 'We couldn’t load your hours' });
    await expect(alert).toBeVisible();
    await expect(alert).toContainText('Your hours haven’t changed. Check your connection and try again.');
    await shot(page, 'error');
    fail = false;
    await alert.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByRole('heading', { name: 'Add the times you take orders' })).toBeVisible();
    await expect(page.getByTestId('right-now-reason')).toHaveText('You have no opening hours set, so customers can’t order.');
    await expect(page.getByTestId('special-dates-empty')).toBeVisible();
    await expectNoDocumentScroll(page);
    await shot(page, 'none');
  });

  test('suspended: banner, Right now locked, hours still editable', async ({ page }) => {
    await hoursStore(page);
    const profile = await mockFixture(page, 'restaurant_profile');
    await page.route('**/v1/restaurant/profile', (route) => route.fulfill({ json: { data: { ...profile, account_state: 'SUSPENDED' } } }));
    const suspended = await mockFixture(page, 'restaurant_open_state_closed_suspended');
    await availabilityStore(page, { ...suspended, reason: 'This restaurant is temporarily unavailable.', resolvable_by: 'ADMIN', pause_until: null });
    await openSignedIn(page, '/hours');
    await expect(page.getByText('Your account is suspended. You can still update your hours.')).toBeVisible();
    await expect(page.getByTestId('right-now-badge')).toHaveText('Suspended');
    await expect(page.getByRole('switch', { name: 'New orders' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Edit hours' })).toBeVisible();
    await expectNoDocumentScroll(page);
    await shot(page, 'suspended');
  });
});

// ── Real API (devworld) ──────────────────────────────────────────────────────────────────

const PASSWORD = 'Seed!2026';

type Grant = { access_token: string; principal: { account_id: string } };

/** The devworld personas (`paused`, `suspended`) do not exist in the CI e2e world. */
class NoSuchPersona extends Error {}
const grants = new Map<string, Promise<Grant>>();

/** One sign-in per persona per worker: the API rate-limits sign-in per account. */
function apiLogin(request: APIRequestContext, email: string): Promise<Grant> {
  let grant = grants.get(email);
  if (!grant) {
    grant = signIn(request, email);
    grants.set(email, grant);
  }
  return grant;
}

async function signIn(request: APIRequestContext, email: string): Promise<Grant> {
  const res = await request.post(`${REAL_API}/v1/auth/login`, {
    headers: { 'X-HG-Client': 'restaurant-web', 'Content-Type': 'application/json' },
    data: { email, password: email === LIVE_OWNER.email ? LIVE_OWNER.password : PASSWORD },
  });
  if (res.status() === 401) throw new NoSuchPersona(email);
  if (!res.ok()) throw new Error(`sign in as ${email}: ${res.status()} ${await res.text()}`);
  return (await res.json()).data as Grant;
}

async function apiHours(request: APIRequestContext, token: string) {
  const res = await request.get(`${REAL_API}/v1/restaurant/hours`, { headers: { Authorization: `Bearer ${token}` } });
  return (await res.json()).data;
}

async function apiPutHours(request: APIRequestContext, token: string, hours: { intervals: unknown[]; overrides: unknown[] }) {
  const res = await request.put(`${REAL_API}/v1/restaurant/hours`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    data: { intervals: hours.intervals, overrides: hours.overrides },
  });
  expect(res.ok(), 'restore hours').toBeTruthy();
}

/** Opens `path` as a devworld persona (not the worker's shared owner); skips where it does not exist. */
async function openAs(page: Page, email: string, path: string) {
  let grant: Grant;
  try {
    grant = await apiLogin(page.request, email);
  } catch (e) {
    test.skip(e instanceof NoSuchPersona, `${email} is a devworld persona; this world has none`);
    throw e;
  }
  await page.addInitScript(
    ([token, account]) => window.localStorage.setItem('hg_restaurant_session_v1', JSON.stringify({ accessToken: token, accountId: account })),
    [grant.access_token, grant.principal.account_id],
  );
  await page.goto(path);
}

test.describe('Hours (real API)', () => {
  test.skip(MODE !== 'real', 'real-API journeys');
  test.describe.configure({ mode: 'serial' });

  test('bismillah-grill: Friday split with a late range past midnight saves and survives a reload; the original hours come back', async ({ page }) => {
    const owner = await apiLogin(page.request, LIVE_OWNER.email);
    const original = await apiHours(page.request, owner.access_token);
    try {
      await openSignedIn(page, '/hours');
      await expect(page.getByRole('table', { name: 'Weekly opening hours' })).toBeVisible();
      await page.getByRole('button', { name: 'Edit hours' }).click();
      const fri = page.locator('fieldset#fri');
      // Whatever Friday had, make it 11:00 am – 3:00 pm and 5:00 pm – 2:00 am.
      if ((await fri.getByRole('switch', { name: 'Friday' }).getAttribute('aria-checked')) !== 'true') {
        await fri.getByRole('switch', { name: 'Friday' }).click();
      }
      while ((await fri.getByRole('button', { name: /^Remove / }).count()) > 1) {
        await fri.getByRole('button', { name: /^Remove / }).last().click();
      }
      await fri.getByLabel('Opens', { exact: true }).fill('11:00 am');
      await fri.getByLabel('Closes', { exact: true }).fill('3:00 pm');
      await fri.getByRole('button', { name: 'Add hours on Friday' }).click();
      await fri.getByLabel('Opens, range 2').fill('5:00 pm');
      await fri.getByLabel('Closes, range 2').fill('2:00 am');
      // Saturday must start after Friday's late range ends; whatever it had runs into it.
      const sat = page.locator('fieldset#sat');
      if ((await sat.getByRole('switch', { name: 'Saturday' }).getAttribute('aria-checked')) === 'true') {
        await page.getByRole('button', { name: 'Save hours' }).click();
        const summary = page.getByTestId('hours-error-summary');
        if (await summary.isVisible().catch(() => false)) {
          await expect(summary).toBeFocused();
          await expect(summary.getByRole('link', { name: /^Friday and Saturday: Friday 5:00 pm – 2:00 am runs into Saturday/ })).toBeVisible();
          await shot(page, 'real-overlap-night');
          const satOpens = sat.getByLabel(/^Opens/).first();
          await satOpens.fill('2:00 am');
        }
      }
      await page.getByRole('button', { name: 'Save hours' }).click();
      const closesNow = page.getByRole('alertdialog', { name: 'Save and close now?' });
      await expect(page.getByText('Hours saved').or(closesNow).first()).toBeVisible();
      if (await closesNow.isVisible().catch(() => false)) await closesNow.getByRole('button', { name: 'Save and close now' }).click();
      await expect(page.getByText('Hours saved').first()).toBeVisible();
      await page.reload();
      const friRow = page.getByRole('table', { name: 'Weekly opening hours' }).getByRole('row', { name: /Friday/ });
      await expect(friRow).toContainText('11:00 am – 3:00 pm');
      await expect(friRow).toContainText('5:00 pm – 2:00 am');
      await expect(friRow).toContainText('Past midnight');
      const stored = await apiHours(page.request, owner.access_token);
      expect(stored.intervals.filter((i: any) => i.day_of_week === 5)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ opens_at: '11:00', closes_at: '15:00' }),
          expect.objectContaining({ opens_at: '17:00', closes_at: '02:00', crosses_midnight: true }),
        ]),
      );
      await expectNoDocumentScroll(page);
      await shot(page, 'real-friday-saved');
    } finally {
      await apiPutHours(page.request, owner.access_token, original);
    }
  });

  test('bismillah-grill: a closed special date 30+ days ahead lists, then is removed in its panel', async ({ page }) => {
    const owner = await apiLogin(page.request, LIVE_OWNER.email);
    const original = await apiHours(page.request, owner.access_token);
    const date = torontoDate(45 + test.info().parallelIndex);
    try {
      await openSignedIn(page, '/hours');
      await page.getByRole('button', { name: 'Add a special date' }).click();
      const panel = page.getByRole('complementary', { name: 'Special date' });
      await panel.locator('#sd-date').fill(date);
      await panel.getByLabel('Reason (optional)').fill('WP9 e2e closure');
      await panel.getByRole('button', { name: 'Save date' }).click();
      const list = page.getByRole('region', { name: 'Special dates' });
      const row = list.locator(`[data-date="${date}"]`);
      await expect(row).toContainText('Closed all day');
      await expect(row).toContainText('WP9 e2e closure');
      await expect(row).toBeFocused();
      await shot(page, 'real-special-added');
      const stored = await apiHours(page.request, owner.access_token);
      expect(stored.overrides).toContainEqual(expect.objectContaining({ date, is_closed: true }));
      // The weekly hours went back unchanged with it.
      expect(stored.intervals).toHaveLength(original.intervals.length);

      await row.getByRole('button', { name: /^Edit special date/ }).click();
      await panel.getByRole('button', { name: 'Remove date' }).click();
      const ask = panel.getByRole('alertdialog');
      await expect(ask).toContainText('Remove WP9 e2e closure');
      await expect(ask.getByRole('button', { name: 'Keep it' })).toBeFocused();
      await shot(page, 'real-special-remove');
      await ask.getByRole('button', { name: 'Remove now' }).click();
      await expect(page.getByText('Special date removed').first()).toBeVisible();
      await expect(list.locator(`[data-date="${date}"]`)).toHaveCount(0);
      const after = await apiHours(page.request, owner.access_token);
      expect(after.overrides.find((o: any) => o.date === date)).toBeUndefined();
    } finally {
      await apiPutHours(page.request, owner.access_token, original);
    }
  });

  test('bismillah-grill: pause 15 minutes, Right now says paused until the time, then resume', async ({ page }) => {
    const owner = await apiLogin(page.request, LIVE_OWNER.email);
    try {
      await openSignedIn(page, '/hours');
      const badge = page.getByTestId('right-now-badge');
      await expect(badge).toHaveText(/Open|Not receiving orders|Not accepting orders|Paused/);
      if ((await badge.textContent()) !== 'Open') {
        // Another suite left it off or paused: switch it on through the API first.
        await page.request.patch(`${REAL_API}/v1/restaurant/availability`, {
          headers: { Authorization: `Bearer ${owner.access_token}`, 'Content-Type': 'application/json' },
          data: { is_accepting_orders: true, pause_until: null },
        });
        await page.reload();
        await expect(badge).toHaveText('Open');
      }
      await page.getByTestId('right-now').getByRole('button', { name: 'Pause new orders' }).click();
      const item = page.getByRole('menuitem', { name: /^Pause for 15 minutes \(until / });
      const label = (await item.textContent())!;
      const until = /until (\d{1,2}:\d{2} (?:am|pm))/.exec(label)![1];
      await item.click();
      await expect(badge).toHaveText('Paused');
      // The label read back from the server names the same end time the menu item offered.
      await expect(page.getByTestId('right-now-reason')).toHaveText(`Paused until ${until}.`);
      await shot(page, 'real-paused');
      await page.getByTestId('right-now').getByRole('button', { name: 'Resume now' }).click();
      await page.getByRole('group', { name: 'Resume new orders now?' }).getByRole('button', { name: 'Resume now' }).click();
      await expect(badge).toHaveText('Open');
      await expect(page.getByTestId('right-now-reason')).toHaveText('Open and accepting orders.');
    } finally {
      await page.request.patch(`${REAL_API}/v1/restaurant/availability`, {
        headers: { Authorization: `Bearer ${owner.access_token}`, 'Content-Type': 'application/json' },
        data: { is_accepting_orders: true, pause_until: null },
      });
    }
  });

  test('paused persona: Right now shows new orders stopped, with the switch off', async ({ page }) => {
    await openAs(page, 'paused@seed.hg', '/hours');
    const card = page.getByRole('region', { name: 'Right now' });
    await expect(card).toBeVisible();
    // devworld seeds `paused` with the toggle off, so the server reports CLOSED_TOGGLE.
    await expect(page.getByTestId('right-now-badge')).toHaveText(/Not accepting orders|Paused/);
    await expect(page.getByRole('switch', { name: 'New orders' })).toHaveAttribute('aria-checked', 'false');
    await shot(page, 'real-paused-persona');
  });

  test('suspended persona: banner, locked switch, and the hours editor still opens (nothing saved)', async ({ page }) => {
    await openAs(page, 'suspended@seed.hg', '/hours');
    await expect(page.getByText('Your account is suspended. You can still update your hours.')).toBeVisible();
    await expect(page.getByTestId('right-now-badge')).toHaveText('Suspended');
    const add = page.getByRole('button', { name: /^(Edit hours|Add your hours)$/ });
    await add.click();
    await expect(page.getByRole('region', { name: 'Edit weekly hours' })).toBeVisible();
    await expect(page.getByTestId('hours-save-bar')).toBeVisible();
    await expectNoDocumentScroll(page);
    await shot(page, 'real-suspended-editing');
  });
});
