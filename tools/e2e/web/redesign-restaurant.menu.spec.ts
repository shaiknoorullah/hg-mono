/**
 * Restaurant redesign WP8: Menu (manifest §2.4, §3 WP8, §6 row WP8; canvas MH). Runs at desktop
 * 1440×900 and tablet 1024×768, flag on.
 *
 * - Mock mode (`E2E_MODE` unset or `mock`): the app on `pnpm mock`. `getOwnMenu` is answered here
 *   with a menu covering every row state (it stands in for the "OwnedMenu covering every row
 *   state" fixture requested in #676; built from the contract's own item fixtures), the profile
 *   is the contract's `restaurant_profile` patched per account state, and each write is answered
 *   with the item it changed (the mock is stateless).
 * - Real mode (`E2E_MODE=real`): the app on `services/hg` with devworld personas
 *   (`bismillah-grill`, `suspended`). Every change a journey makes is put back at its end.
 */
import { execSync } from 'node:child_process';
import { copyFileSync, mkdirSync } from 'node:fs';
import { expect, test, type APIRequestContext, type Page, type TestInfo } from '@playwright/test';
import { DEVWORLD, MODE, MOCK_API, REAL_API, documentScrolls, openSignedIn } from './redesign-restaurant.support';
import { projectMeta } from './mode';

const SHOTS = process.env.E2E_SHOTS_DIR ?? '/tmp/claude-0/-home-user-hg-mono/d41301d3-8d3a-541d-a6f4-40d847c8b738/scratchpad/shots/wp8';

/** Saves a screenshot to the test output and to the WP shots folder as `<viewport>-<state>.png`. */
async function shot(page: Page, info: TestInfo, state: string) {
  const file = info.outputPath(`${state}.png`);
  await page.screenshot({ path: file });
  try {
    mkdirSync(SHOTS, { recursive: true });
    copyFileSync(file, `${SHOTS}/${info.project.name}-${state}.png`);
  } catch {
    /* the shots folder is a convenience */
  }
}

/** A toast by its text (the toast region also repeats it in a polite live region). */
const toast = (page: Page, text: string) => page.getByTestId('hg-toast').filter({ hasText: text });

async function expectNoDocumentScroll(page: Page) {
  const m = await documentScrolls(page);
  expect(m.scrollHeight, 'document must not scroll vertically').toBeLessThanOrEqual(m.innerHeight);
  expect(m.scrollWidth, 'document must not scroll horizontally').toBeLessThanOrEqual(m.innerWidth);
}

// ── Mock mode ────────────────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- fixtures are JSON
type Json = any;

async function mockFixture(page: Page, name: string): Promise<Json> {
  const res = await page.request.get(`${MOCK_API}/__mock/scenarios/${name}`);
  return (await res.json()).data.payload;
}

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const CAT = { mains: uuid(1), drinks: uuid(2), catering: uuid(3), desserts: uuid(4), wraps: uuid(5) };

/** A menu covering every row state, from `menu_item_marked_out_of_stock_until` + patches. */
async function richMenu(page: Page): Promise<Json> {
  const base = await mockFixture(page, 'menu_item_marked_out_of_stock_until');
  const groups = await mockFixture(page, 'menu_item_many_variants_and_addons');
  let seq = 0;
  const inAnHour = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const version = (name: string, patch: Json = {}) => ({
    ...base.live_version,
    id: uuid(7000 + ++seq),
    name,
    review_status: 'PENDING_REVIEW',
    submitted_at: '2026-09-27T18:05:00.000Z',
    reviewed_at: null,
    ...patch,
  });
  const item = (name: string, categoryId: string, patch: Json = {}) => {
    const id = uuid(1000 + ++seq);
    return {
      ...base,
      id,
      name,
      category_id: categoryId,
      availability_state: 'AVAILABLE',
      out_of_stock_until: null,
      dietary_tags: ['SPICY'],
      variant_groups: [],
      addon_groups: [],
      live_version: { ...base.live_version, id: uuid(5000 + seq), menu_item_id: id, name, dietary_tags: ['SPICY'] },
      pending_version: null,
      sort_order: seq,
      ...patch,
    };
  };
  const cat = (id: string, name: string, items: Json[], patch: Json = {}) => ({ id, name, description: null, sort_order: 1, is_active: true, items, ...patch });
  return {
    restaurant_id: uuid(9),
    categories: [
      cat(CAT.mains, 'Mains', [
        item('Beef kofta plate', CAT.mains, { price_cents: 1895, variant_groups: groups.variant_groups.slice(0, 1), addon_groups: groups.addon_groups.slice(0, 1) }),
        item('Chicken shawarma', CAT.mains, { pending_version: version('Chicken shawarma wrap') }),
        item('Lamb mandi', CAT.mains, { availability_state: 'OUT_OF_STOCK', out_of_stock_until: inAnHour }),
        item('Mixed grill', CAT.mains, { availability_state: 'OUT_OF_STOCK', out_of_stock_until: null }),
        item('Falafel plate', CAT.mains, { availability_state: 'BLOCKED' }),
        item('Fish curry', CAT.mains, {
          pending_version: version('Fish curry', {
            review_status: 'REJECTED',
            rejection_reason_code: 'UNSUBSTANTIATED_HALAL_CLAIM',
            review_note: 'Remove “zabiha certified” from the description.',
            reviewed_at: '2026-09-26T15:00:00.000Z',
            description: 'Zabiha certified fish curry.',
          }),
        }),
      ]),
      cat(CAT.drinks, 'Drinks', [
        item('Mango lassi', CAT.drinks, { availability_state: 'OUT_OF_STOCK', out_of_stock_until: null }),
        item('Mint lemonade', CAT.drinks, { availability_state: 'OUT_OF_STOCK', out_of_stock_until: inAnHour }),
      ]),
      cat(CAT.catering, 'Catering', [item('Party tray', CAT.catering, { availability_state: 'HIDDEN' })], { is_active: false }),
      cat(CAT.desserts, 'Desserts', []),
      cat(CAT.wraps, 'Wraps', [item('Halloumi wrap', CAT.wraps, { live_version: null, pending_version: version('Halloumi wrap') })]),
    ],
  };
}

function findItem(menu: Json, name: string): Json {
  for (const c of menu.categories) for (const i of c.items) if (i.name === name) return i;
  throw new Error(`no item ${name}`);
}

interface MockOpts {
  menu?: Json;
  /** Patch on `restaurant_profile` (account_state, halal). */
  profile?: Json;
  /** Delay the menu read, ms; or `error` to fail it. */
  menuRead?: number | 'error';
}

/** Opens the Menu in mock mode with the rich menu (or `opts.menu`) and a patched profile. */
async function openMock(page: Page, path: string, opts: MockOpts = {}): Promise<Json> {
  const menu = opts.menu ?? (await richMenu(page));
  const profile = { ...(await mockFixture(page, 'restaurant_profile')), ...(opts.profile ?? {}) };
  await page.route('**/v1/restaurant/profile', (route) => route.fulfill({ json: { data: profile } }));
  await page.route('**/v1/restaurant/menu', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    if (opts.menuRead === 'error') return route.fulfill({ status: 503, json: { error: { code: 'SERVICE_UNAVAILABLE', message: 'down', request_id: 'r' } } });
    if (typeof opts.menuRead === 'number') await new Promise((r) => setTimeout(r, opts.menuRead as number));
    return route.fulfill({ json: { data: menu } });
  });
  await openSignedIn(page, path);
  await expect(page.getByTestId('menu-page')).toBeVisible();
  return menu;
}

/** Answers availability writes with the item as the request asked (the mock is stateless). */
async function answerAvailability(page: Page, menu: Json) {
  await page.route('**/v1/restaurant/menu/items/*/availability', async (route) => {
    const id = route.request().url().split('/items/')[1]!.split('/')[0]!;
    const body = route.request().postDataJSON();
    const item = menu.categories.flatMap((c: Json) => c.items).find((i: Json) => i.id === id);
    await route.fulfill({ json: { data: { ...item, ...body } } });
  });
}

test.describe('restaurant redesign · menu (mock)', () => {
  test.skip(MODE === 'real', 'mock-mode screens');

  test('the menu: categories, the grid with every row state, the page never scrolls', async ({ page }, info) => {
    await openMock(page, '/menu');
    const nav = page.getByRole('navigation', { name: 'Menu categories' });
    await expect(nav.getByRole('link', { name: /^Mains/ })).toHaveAttribute('aria-current', 'true');
    await expect(nav.getByRole('link', { name: /Catering.*Inactive/ })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Mains' })).toBeVisible();
    const grid = page.getByTestId('menu-grid');
    await expect(grid.getByText('Under review: Chicken shawarma wrap')).toBeVisible();
    await expect(grid.getByText('Blocked by HalalGoes')).toBeVisible();
    await expect(page.getByText(/draft/i)).toHaveCount(0);
    await expect(page.getByText('Your menu: 10 items in 5 categories. Customers can order 3 of them now.')).toBeVisible();
    if (projectMeta().viewport === 'desktop') {
      await expect(page.getByRole('columnheader', { name: 'Review' })).toBeVisible();
      await expect(grid.getByText('Not approved')).toBeVisible();
    }
    await expectNoDocumentScroll(page);
    await shot(page, info, 'default');

    await nav.getByRole('link', { name: /^Drinks/ }).click();
    await expect(page.getByText('All out of stock')).toBeVisible();
    await shot(page, info, 'category-all-out');
    await nav.getByRole('link', { name: /^Desserts/ }).click();
    await expect(page.getByRole('heading', { name: 'No items in Desserts yet' })).toBeVisible();
    await shot(page, info, 'category-empty');
    await expectNoDocumentScroll(page);
  });

  test('loading, then load error with Try again', async ({ page }, info) => {
    await openMock(page, '/menu', { menuRead: 1500 });
    await expect(page.getByText('Loading your menu…')).toBeVisible();
    await shot(page, info, 'loading');
    await expect(page.getByRole('heading', { level: 2, name: 'Mains' })).toBeVisible();
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await openMock(page, '/menu', { menuRead: 'error' });
    await expect(page.getByRole('heading', { name: 'We couldn’t load your menu' })).toBeVisible();
    await expect(page.getByText('Your menu didn’t load.')).toBeVisible();
    await expectNoDocumentScroll(page);
    await shot(page, info, 'error');
  });

  test('first run and Add a category', async ({ page }, info) => {
    await openMock(page, '/menu', { menu: { restaurant_id: uuid(9), categories: [] } });
    await expect(page.getByRole('region', { name: 'Start your menu' })).toBeVisible();
    await shot(page, info, 'first-run');
    await page.getByRole('button', { name: 'Create your first category' }).click();
    const panel = page.getByRole('region', { name: 'Add a category' });
    await expect(panel).toBeVisible();
    await expect(panel.getByRole('heading', { name: 'Add a category' })).toBeFocused();
    await panel.getByRole('textbox', { name: /Category name/ }).fill('Grills');
    await expectNoDocumentScroll(page);
    await shot(page, info, 'category-panel');
    await page.route('**/v1/restaurant/menu/categories', (route) =>
      route.fulfill({ status: 409, json: { error: { code: 'CATEGORY_NAME_TAKEN', message: 'taken', request_id: 'r' } } }),
    );
    await panel.getByRole('button', { name: 'Add category' }).click();
    await expect(panel.getByText('You already have a category called Grills. Choose another name.')).toBeVisible();
    await shot(page, info, 'category-taken');
  });

  test('availability: off goes out of stock at once and opens the length menu; Escape keeps it', async ({ page }, info) => {
    const menu = await richMenu(page);
    await answerAvailability(page, menu);
    await openMock(page, '/menu', { menu });
    const sw = page.getByRole('switch', { name: 'Beef kofta plate available' });
    await expect(sw).toHaveAttribute('aria-checked', 'true');
    await sw.click();
    const lengthMenu = page.getByRole('menu', { name: 'Change how long Beef kofta plate is out of stock' });
    await expect(lengthMenu).toBeVisible();
    await expect(lengthMenu.getByRole('menuitemradio', { name: /For 1 hour/ })).toBeFocused();
    await expect(lengthMenu.getByRole('menuitem', { name: /Until closing/ })).toHaveAttribute('aria-disabled', 'true');
    await expect(page.getByText('Out of stock now. Choose another length, or press Escape to keep this one.')).toBeVisible();
    await expectNoDocumentScroll(page);
    await shot(page, info, 'availability-length-menu');
    await page.keyboard.press('Escape');
    await expect(lengthMenu).toHaveCount(0);
    await expect(sw).toHaveAttribute('aria-checked', 'false');
    await sw.click();
    await expect(sw).toHaveAttribute('aria-checked', 'true');
    // A save the server refuses because HalalGoes blocked the item.
    await page.route('**/v1/restaurant/menu/items/*/availability', (route) =>
      route.fulfill({ status: 403, json: { error: { code: 'ITEM_BLOCKED_BY_ADMIN', message: 'blocked', request_id: 'r' } } }),
    );
    await page.getByRole('switch', { name: 'Chicken shawarma available' }).click();
    await expect(page.getByText('Your change wasn’t saved. HalalGoes had blocked it.')).toBeVisible();
    await shot(page, info, 'availability-blocked-refusal');
  });

  test('item details panel opens in the page and closes back to its opener', async ({ page }, info) => {
    await openMock(page, '/menu');
    const opener = page.getByRole('button', { name: 'Show details for Beef kofta plate' });
    await opener.click();
    const panel = page.getByRole('complementary', { name: 'Beef kofta plate' });
    await expect(panel).toBeVisible();
    await expect(panel.getByRole('heading', { name: 'Beef kofta plate' })).toBeFocused();
    await expect(page.getByRole('navigation', { name: 'Menu categories, collapsed' })).toBeVisible();
    await expectNoDocumentScroll(page);
    await shot(page, info, 'details');
    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);
    await expect(opener).toBeFocused();
  });

  test('item editor: new item, the local price hint, then sent for review', async ({ page }, info) => {
    const menu = await richMenu(page);
    await openMock(page, '/menu', { menu });
    await page.getByRole('button', { name: 'Add item' }).click();
    const editor = page.getByRole('region', { name: 'New item' });
    await expect(editor).toBeVisible();
    await expect(editor.getByRole('heading', { name: 'New item' })).toBeFocused();
    await expectNoDocumentScroll(page);
    await shot(page, info, 'editor-new');
    await editor.getByRole('textbox', { name: /^Price/ }).fill('0.25');
    await editor.getByRole('textbox', { name: /^Name/ }).fill('Halloumi plate');
    await editor.getByRole('button', { name: 'Submit for review' }).click();
    await expect(editor.getByText('1 thing to fix before you can submit')).toBeVisible();
    await shot(page, info, 'editor-errors');
    let sent: Json = null;
    await page.route('**/v1/restaurant/menu/items', async (route) => {
      sent = route.request().postDataJSON();
      const created = { ...findItem(menu, 'Halloumi wrap'), id: uuid(4242), name: sent.name, category_id: sent.category_id, price_cents: sent.price_cents };
      await route.fulfill({ status: 201, json: { data: created } });
    });
    await editor.getByRole('textbox', { name: /^Price/ }).fill('12.50');
    await editor.getByRole('button', { name: 'Submit for review' }).click();
    await expect(toast(page, 'Halloumi plate sent for review')).toBeVisible();
    expect(sent).toMatchObject({ name: 'Halloumi plate', price_cents: 1250, category_id: CAT.mains });
    await expect(editor).toHaveCount(0);
  });

  test('item editor: an item under review, and a not-approved one', async ({ page }, info) => {
    const menu = await richMenu(page);
    await openMock(page, `/menu?edit=${findItem(menu, 'Chicken shawarma').id}`, { menu });
    const editor = page.getByRole('region', { name: 'Edit Chicken shawarma' });
    await expect(editor.getByText('Approved name (live now)')).toBeVisible();
    await expect(editor.getByRole('button', { name: 'Submit updated change' })).toHaveAttribute('aria-disabled', 'true');
    await expect(page.getByRole('separator', { name: 'Resize the items list and the editor' })).toBeVisible();
    await expectNoDocumentScroll(page);
    await shot(page, info, 'editor-pending');
    await page.goto(`/menu?edit=${findItem(menu, 'Fish curry').id}`);
    const rejected = page.getByRole('region', { name: 'Edit Fish curry' });
    await expect(rejected.getByText('Change not approved')).toBeVisible();
    await expect(rejected.getByText('Flagged by the reviewer: Halal claim not supported')).toBeVisible();
    await shot(page, info, 'editor-rejected');
  });

  test('search results and the filtered empty state', async ({ page }, info) => {
    await openMock(page, '/menu');
    await page.getByRole('searchbox', { name: 'Search this menu' }).fill('lassi');
    await expect(page.getByRole('heading', { level: 2, name: '1 item matches “lassi”' })).toBeVisible();
    await expect(page.getByText('In Drinks')).toBeVisible();
    await shot(page, info, 'search');
    await page.getByRole('combobox', { name: 'Show' }).selectOption('oos');
    await page.getByRole('searchbox', { name: 'Search this menu' }).fill('zzz');
    await expect(page.getByRole('heading', { name: 'No out-of-stock items match “zzz”' })).toBeVisible();
    await expectNoDocumentScroll(page);
    await shot(page, info, 'filtered-empty');
  });

  test('SUSPENDED: read-only, availability included, and ?new=1 opens no editor', async ({ page }, info) => {
    await openMock(page, '/menu?new=1', { profile: { account_state: 'SUSPENDED' } });
    await expect(page.getByRole('region', { name: 'New item' })).toHaveCount(0);
    await expect(page.getByText('Your menu is read-only while your account is suspended.')).toBeVisible();
    for (const sw of await page.getByTestId('menu-grid').getByRole('switch').all()) await expect(sw).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Add item' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'View Beef kofta plate' })).toBeVisible();
    await expectNoDocumentScroll(page);
    await shot(page, info, 'suspended');
  });

  test('certificate expired: a neutral banner, never red', async ({ page }, info) => {
    await openMock(page, '/menu', { profile: { halal: { display_state: 'EXPIRED', expires_on: '2026-09-20', certifying_body_name: null } } });
    const banner = page.locator('#cert-banner [data-testid="banner"]');
    await expect(banner).toHaveAttribute('data-variant', 'neutral');
    await expect(banner).toContainText('Your halal certificate expired on 20 September 2026.');
    await expectNoDocumentScroll(page);
    await shot(page, info, 'cert-expired');
  });

  test('DEACTIVATED: view only, and ?new=1 opens no editor', async ({ page }, info) => {
    await openMock(page, '/menu?new=1', { profile: { account_state: 'DEACTIVATED' } });
    await expect(page.getByText('View only while deactivated.')).toBeVisible();
    // The menu grid's switches (the status bar's Orders switch is on every console page).
    await expect(page.getByTestId('menu-grid').getByRole('switch')).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'New item' })).toHaveCount(0);
    await expect(page).not.toHaveURL(/new=1/);
    await expectNoDocumentScroll(page);
    await shot(page, info, 'deactivated');
  });
});

// ── Real API ────────────────────────────────────────────────────────────────────────────

const PASSWORD = 'Seed!2026';
const grants = new Map<string, Promise<{ access_token: string; principal: { account_id: string } }>>();

/** One sign-in per persona per worker; a 429 flushes the rate limits once (Redis is disposable). */
function grant(request: APIRequestContext, email: string) {
  if (!grants.has(email)) {
    grants.set(
      email,
      (async () => {
        const login = () =>
          request.post(`${REAL_API}/v1/auth/login`, {
            headers: { 'X-HG-Client': 'restaurant-web', 'Content-Type': 'application/json' },
            data: { email, password: PASSWORD },
          });
        let res = await login();
        if (res.status() === 429 && process.env.E2E_RESET_LIMITS_CMD) {
          execSync(process.env.E2E_RESET_LIMITS_CMD);
          res = await login();
        }
        if (!res.ok()) throw new Error(`sign-in as ${email} failed: ${res.status()} ${await res.text()}`);
        return (await res.json()).data;
      })(),
    );
  }
  return grants.get(email)!;
}

async function api(request: APIRequestContext, email: string, method: string, path: string, data?: unknown, key = false) {
  const g = await grant(request, email);
  const headers: Record<string, string> = { Authorization: `Bearer ${g.access_token}`, 'X-HG-Client': 'restaurant-web' };
  if (key) headers['Idempotency-Key'] = crypto.randomUUID();
  const res = await request.fetch(`${REAL_API}${path}`, { method, headers, ...(data !== undefined ? { data } : {}) });
  const text = await res.text();
  return { status: res.status(), body: text ? JSON.parse(text) : null };
}

async function openAs(page: Page, email: string, path: string) {
  const g = await grant(page.request, email);
  await page.addInitScript(
    ([token, account]) => window.localStorage.setItem('hg_restaurant_session_v1', JSON.stringify({ accessToken: token, accountId: account })),
    [g.access_token, g.principal.account_id],
  );
  await page.goto(path);
  await expect(page.getByTestId('menu-page')).toBeVisible();
}

async function ownItem(request: APIRequestContext, email: string, name: string): Promise<Json> {
  const { body } = await api(request, email, 'GET', '/v1/restaurant/menu');
  for (const c of body.data.categories) for (const i of c.items) if (i.name === name) return i;
  return null;
}

const LIVE = 'bismillah-grill@seed.hg';

test.describe('restaurant redesign · menu (real API)', () => {
  test.skip(MODE !== 'real' || !DEVWORLD, 'devworld personas (bismillah-grill, suspended): real API with a devworld database (E2E_DEVWORLD=1)');
  test.describe.configure({ mode: 'serial' });

  test('bismillah-grill: an item goes out of stock and back, and getOwnMenu agrees', async ({ page }, info) => {
    const name = 'Chicken Pakora';
    const before = await ownItem(page.request, LIVE, name);
    expect(before, `${name} is on the seeded menu`).toBeTruthy();
    if (before.availability_state !== 'AVAILABLE') {
      await api(page.request, LIVE, 'PUT', `/v1/restaurant/menu/items/${before.id}/availability`, { availability_state: 'AVAILABLE', out_of_stock_until: null });
    }
    try {
      await openSignedIn(page, `/menu?category=${before.category_id}`);
      const sw = page.getByRole('switch', { name: `${name} available` });
      await expect(sw).toHaveAttribute('aria-checked', 'true');
      await expectNoDocumentScroll(page);
      await shot(page, info, 'real-default');
      await sw.click();
      const lengthMenu = page.getByRole('menu', { name: `Change how long ${name} is out of stock` });
      await expect(lengthMenu).toBeVisible();
      await expect(lengthMenu.getByRole('menuitemradio', { name: /For 1 hour/ })).toBeFocused();
      await shot(page, info, 'real-length-menu');
      await page.keyboard.press('Escape');
      await expect(lengthMenu).toHaveCount(0);
      await expect(sw).toHaveAttribute('aria-checked', 'false');
      const off = await ownItem(page.request, LIVE, name);
      expect(off.availability_state).toBe('OUT_OF_STOCK');
      const ms = Date.parse(off.out_of_stock_until) - Date.now();
      expect(ms).toBeGreaterThan(55 * 60_000);
      expect(ms).toBeLessThan(61 * 60_000);
      await sw.click();
      await expect(sw).toHaveAttribute('aria-checked', 'true');
      const on = await ownItem(page.request, LIVE, name);
      expect(on.availability_state).toBe('AVAILABLE');
      expect(on.out_of_stock_until).toBeNull();
    } finally {
      const now = await ownItem(page.request, LIVE, name);
      if (now && now.availability_state !== 'AVAILABLE') {
        await api(page.request, LIVE, 'PUT', `/v1/restaurant/menu/items/${now.id}/availability`, { availability_state: 'AVAILABLE', out_of_stock_until: null });
      }
    }
  });

  test('bismillah-grill: a new category and a new item, which waits for its first review', async ({ page }, info) => {
    const stamp = `${info.project.name}-${Date.now().toString(36)}`;
    const catName = `E2E ${stamp}`;
    const itemName = `E2E plate ${stamp}`;
    let categoryId: string | null = null;
    let itemId: string | null = null;
    try {
      await openSignedIn(page, '/menu');
      await page.getByRole('button', { name: 'Add category' }).click();
      const panel = page.getByRole('region', { name: 'Add a category' });
      await panel.getByRole('textbox', { name: /Category name/ }).fill(catName);
      await panel.getByRole('button', { name: 'Add category' }).click();
      await expect(toast(page, `${catName} added`)).toBeVisible();
      await expect(page.getByRole('heading', { name: `No items in ${catName} yet` })).toBeVisible();
      const cats = (await api(page.request, LIVE, 'GET', '/v1/restaurant/menu')).body.data.categories as Json[];
      categoryId = cats.find((c) => c.name === catName)?.id ?? null;
      expect(categoryId).toBeTruthy();

      await page.getByRole('button', { name: `Add item to ${catName}` }).click();
      const editor = page.getByRole('region', { name: 'New item' });
      await editor.getByRole('textbox', { name: /^Price/ }).fill('12.50');
      await editor.getByRole('textbox', { name: /^Name/ }).fill(itemName);
      await editor.getByRole('textbox', { name: /^Ingredients/ }).fill('chickpeas, tahini, lemon');
      await editor.getByRole('checkbox', { name: 'Sesame' }).click();
      await editor.getByRole('checkbox', { name: 'I have checked this item’s allergens' }).click();
      await shot(page, info, 'real-editor-new');
      await editor.getByRole('button', { name: 'Submit for review' }).click();
      await expect(toast(page, `${itemName} sent for review`)).toBeVisible();
      await expect(editor).toHaveCount(0);
      const row = page.getByRole('switch', { name: `${itemName} available` }).locator('xpath=ancestor::tr');
      await expect(row.getByText('Waiting for first review')).toBeVisible();
      await shot(page, info, 'real-item-under-review');
      const created = await ownItem(page.request, LIVE, itemName);
      itemId = created.id;
      expect(created.live_version).toBeNull();
      expect(created.pending_version.review_status).toBe('PENDING_REVIEW');
      expect(created.price_cents).toBe(1250);
      expect(created.allergen_tags).toEqual(['SESAME']);
    } finally {
      if (!itemId) itemId = (await ownItem(page.request, LIVE, itemName))?.id ?? null;
      if (!categoryId) {
        const all = (await api(page.request, LIVE, 'GET', '/v1/restaurant/menu')).body.data.categories as Json[];
        categoryId = all.find((c) => c.name === catName)?.id ?? null;
      }
      if (itemId) await api(page.request, LIVE, 'DELETE', `/v1/restaurant/menu/items/${itemId}`);
      if (categoryId) await api(page.request, LIVE, 'DELETE', `/v1/restaurant/menu/categories/${categoryId}`);
    }
  });

  test('bismillah-grill: a price-only edit goes live at once', async ({ page }, info) => {
    const name = 'Vegetable Samosa (2 pc)';
    const before = await ownItem(page.request, LIVE, name);
    expect(before).toBeTruthy();
    const original = before.price_cents as number;
    const next = original === 649 ? 699 : 649;
    try {
      await openSignedIn(page, `/menu?edit=${before.id}`);
      const editor = page.getByRole('region', { name: `Edit ${name}` });
      await expect(editor.getByText('Live on your menu')).toBeVisible();
      await editor.getByRole('textbox', { name: /^Price/ }).fill((next / 100).toFixed(2));
      await expect(editor.getByText('Only the price changed. It goes live as soon as you save.')).toBeVisible();
      await shot(page, info, 'real-editor-price');
      await editor.getByRole('button', { name: 'Save changes' }).click();
      await expect(toast(page, 'Price saved')).toBeVisible();
      expect((await ownItem(page.request, LIVE, name)).price_cents).toBe(next);
      expect((await ownItem(page.request, LIVE, name)).pending_version).toBeNull();
    } finally {
      await api(page.request, LIVE, 'PATCH', `/v1/restaurant/menu/items/${before.id}`, { price_cents: original });
    }
  });

  test('suspended: everything is read-only', async ({ page }, info) => {
    await openAs(page, 'suspended@seed.hg', '/menu');
    await expect(page.getByText('Your menu is read-only while your account is suspended.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add item' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Add category' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Create your first category' })).toHaveCount(0);
    for (const sw of await page.getByTestId('menu-grid').getByRole('switch').all()) await expect(sw).toBeDisabled();
    for (const b of await page.getByRole('button', { name: /^Edit / }).all()) await expect(b).toHaveCount(0);
    await expectNoDocumentScroll(page);
    await shot(page, info, 'real-suspended');
    // The server agrees: the menu is locked for writes.
    const res = await api(page.request, 'suspended@seed.hg', 'POST', '/v1/restaurant/menu/categories', { name: 'Should not exist' }, true);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('MENU_LOCKED');
  });
});
