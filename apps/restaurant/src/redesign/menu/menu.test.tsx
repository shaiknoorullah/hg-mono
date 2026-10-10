/**
 * WP8 — Menu (manifest §2.4, §3 WP8 DONE; spec specs/wp8-menu.md). Every board state asserted by
 * role and name against contract fixtures (patched where the contract has no fixture yet, #676).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { installDomShims } from '@hg/ui-web/testing';
import { setSession } from '../../lib/api';
import { resetSignedOut } from '../data/client';
import { resetServerClock } from '../data/serverClock';
import { consoleRoutes, errorBody, fixture, installFakeApi, type Handler } from '../test/fakeApi';
import { IDS, byName, category, item, richMenu } from './testMenu';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const MENU = 'GET /v1/restaurant/menu';

function profile(patch: Record<string, unknown> = {}) {
  return { body: { ...fixture('restaurant_profile'), ...patch } };
}

function routes(overrides: Record<string, Handler> = {}, menu = richMenu()) {
  return consoleRoutes({ [MENU]: { body: menu }, ...overrides });
}

/**
 * `renderRedesign` at a desktop width: the shared DOM shims match no media query (tablet), and
 * the Menu grid folds Price and Review into the Item cell below 1280 px.
 */
async function renderRedesign(path: string, { desktop = true }: { desktop?: boolean } = {}) {
  installDomShims();
  if (desktop) {
    const mm = window.matchMedia;
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: (query: string) => ({ ...mm(query), matches: query.includes('min-width: 1280px') }),
    });
  }
  resetServerClock();
  resetSignedOut();
  setSession({ accessToken: 'access-token-1' });
  const { default: RedesignRoot } = await import('../RedesignRoot');
  return render(
    <MemoryRouter initialEntries={[path]}>
      <RedesignRoot />
    </MemoryRouter>,
  );
}

async function openMenu(path = '/menu', opts: { desktop?: boolean } = {}) {
  await renderRedesign(path, opts);
  await screen.findByTestId('menu-page');
  await waitFor(() => expect(screen.queryByText('Loading your menu…')).toBeNull());
  return screen.queryByRole('navigation', { name: 'Menu categories' }) as HTMLElement;
}

const grid = () => screen.getByTestId('menu-grid');
const bodyOf = async (req: Request) => JSON.parse(await req.clone().text());

describe('menu list', () => {
  it('shows categories with their notes and counts, and the Review column never says Draft', async () => {
    installFakeApi(routes());
    const nav = await openMenu();
    const links = within(nav).getAllByRole('link');
    expect(links.map((l) => l.textContent)).toEqual([
      'Mains, 6 items',
      'Drinks, 2 items',
      'CateringInactive, 1 item',
      'DessertsEmpty, 0 items',
      'WrapsNot on your menu yet, 1 item',
    ]);
    expect(links[0]!.getAttribute('aria-current')).toBe('true');
    expect(screen.getByRole('heading', { level: 2, name: 'Mains' })).toBeTruthy();
    const g = grid();
    expect(within(g).getAllByText('Approved').length).toBeGreaterThan(0);
    expect(within(g).getByText('Under review')).toBeTruthy();
    expect(within(g).getByText('Under review: Chicken shawarma wrap')).toBeTruthy();
    expect(within(g).getByText('Not approved')).toBeTruthy();
    expect(within(g).getByText('Halal claim not supported')).toBeTruthy();
    expect(within(g).getByText('2 option groups')).toBeTruthy();
    expect(screen.queryByText(/draft/i)).toBeNull();
    expect(screen.getByText('Your menu: 10 items in 5 categories. Customers can order 3 of them now.')).toBeTruthy();
    // A blocked row names its state and never offers a switch.
    expect(within(g).getByText('Blocked by HalalGoes')).toBeTruthy();
    expect(screen.queryByRole('switch', { name: 'Falafel plate available' })).toBeNull();
    expect(screen.getByRole('button', { name: 'View Falafel plate' })).toBeTruthy();
  });

  it('first run: no categories → Start your menu, and its button opens Add a category', async () => {
    installFakeApi(routes({}, { restaurant_id: 'x', categories: [] }));
    await renderRedesign('/menu');
    const card = await screen.findByRole('region', { name: 'Start your menu' });
    expect(screen.getByText('Your menu is empty.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add item' }).getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(within(card).getByRole('button', { name: 'Create your first category' }));
    expect(await screen.findByRole('heading', { name: 'Add a category' })).toBeTruthy();
  });

  it('loading → skeleton, busy main, disabled toolbar; error → a way out', async () => {
    let release: () => void = () => {};
    const api = installFakeApi(
      routes({
        [MENU]: () =>
          new Promise((resolve) => {
            release = () => resolve({ status: 500, body: errorBody('INTERNAL_ERROR') });
          }),
      }),
    );
    await renderRedesign('/menu');
    expect(await screen.findByText('Loading your menu…')).toBeTruthy();
    expect(document.getElementById('main')!.getAttribute('aria-busy')).toBe('true');
    expect(screen.getByRole('button', { name: 'Add item' }).getAttribute('aria-disabled')).toBe('true');
    act(() => release());
    const alert = (await screen.findByRole('heading', { name: 'We couldn’t load your menu' })).closest('[role="alert"]') as HTMLElement;
    expect(screen.getByText('Your menu didn’t load.')).toBeTruthy();
    api.set(MENU, { body: richMenu() });
    fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { level: 2, name: 'Mains' })).toBeTruthy();
  });

  it('re-reads on window focus; a failed re-read keeps the menu and says it is stale, a good one clears it', async () => {
    const api = installFakeApi(routes());
    await openMenu();
    const reads = () => api.callsTo(MENU).length;
    const first = reads();
    api.set(MENU, { status: 503, body: errorBody('SERVICE_UNAVAILABLE') });
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    await waitFor(() => expect(reads()).toBe(first + 1));
    expect(await screen.findByText(/^Showing your menu as it was at \d{1,2}:\d{2} [ap]m\.$/)).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'Mains' })).toBeTruthy();
    api.set(MENU, { body: richMenu() });
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    await waitFor(() => expect(reads()).toBe(first + 2));
    await waitFor(() => expect(screen.queryByText(/^Showing your menu as it was/)).toBeNull());
  });

  it('refreshes every 60 s', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'], shouldAdvanceTime: true });
    const api = installFakeApi(routes());
    await openMenu();
    const n = api.callsTo(MENU).length;
    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    await waitFor(() => expect(api.callsTo(MENU).length).toBe(n + 1));
  });

  it('search finds items across categories; a search with no match says so', async () => {
    installFakeApi(routes());
    await openMenu();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search this menu' }), { target: { value: 'lassi' } });
    expect(await screen.findByRole('heading', { level: 2, name: '1 item matches “lassi”' })).toBeTruthy();
    expect(within(grid()).getByText('In Drinks')).toBeTruthy();
    expect(screen.getByText('1 item in 1 category. Categories with no match are left out.')).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'Menu categories' }).querySelector('[aria-current]')).toBeNull();
    fireEvent.change(screen.getByRole('combobox', { name: 'Show' }), { target: { value: 'oos' } });
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search this menu' }), { target: { value: 'zzz' } });
    expect(await screen.findByRole('heading', { name: 'No out-of-stock items match “zzz”' })).toBeTruthy();
    expect(screen.getByText('No matches.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Clear search and filter' }));
    expect(await screen.findByRole('heading', { level: 2, name: 'Mains' })).toBeTruthy();
  });

  it('choosing a category while searching leaves the search and opens the category', async () => {
    installFakeApi(routes());
    const nav = await openMenu();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search this menu' }), { target: { value: 'lassi' } });
    expect(await screen.findByRole('heading', { level: 2, name: '1 item matches “lassi”' })).toBeTruthy();
    fireEvent.click(within(nav).getByRole('link', { name: /^Wraps/ }));
    expect(await screen.findByRole('heading', { level: 2, name: 'Wraps' })).toBeTruthy();
    expect((screen.getByRole('searchbox', { name: 'Search this menu' }) as HTMLInputElement).value).toBe('');
    expect(within(nav).getByRole('link', { name: /^Wraps/ }).getAttribute('aria-current')).toBe('true');
  });

  it('a category with everything out of stock says so; an inactive one explains itself', async () => {
    installFakeApi(routes());
    await renderRedesign(`/menu?category=${IDS.drinks}`);
    expect(await screen.findByText('All out of stock')).toBeTruthy();
    expect(screen.getByText(/Everything in Drinks is out of stock\./)).toBeTruthy();
    cleanup();
    installFakeApi(routes());
    await renderRedesign(`/menu?category=${IDS.catering}`);
    expect(await screen.findByText('Inactive category')).toBeTruthy();
    expect(screen.getByText('Its category, Catering, is inactive.')).toBeTruthy();
    cleanup();
    installFakeApi(routes());
    await renderRedesign(`/menu?category=${IDS.desserts}`);
    expect(await screen.findByRole('heading', { name: 'No items in Desserts yet' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add item to Desserts' })).toBeTruthy();
  });
});

describe('availability switch', () => {
  it('turning off marks it out of stock at once (For 1 hour until closing time exists), then opens the length menu; Escape keeps it', async () => {
    const menu = richMenu();
    const kofta = byName(menu, 'Beef kofta plate');
    let resolve: (r: { body: unknown }) => void = () => {};
    const api = installFakeApi(
      routes(
        {
          [`PUT /v1/restaurant/menu/items/${kofta.id}/availability`]: (req) =>
            new Promise(async (done) => {
              const b = await bodyOf(req);
              resolve = () => done({ body: { ...kofta, availability_state: b.availability_state, out_of_stock_until: b.out_of_stock_until } });
            }),
        },
        menu,
      ),
    );
    await openMenu();
    const sw = screen.getByRole('switch', { name: 'Beef kofta plate available' });
    expect(sw.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(sw);
    // No optimistic flip: the switch moves when HalalGoes confirms.
    expect(await screen.findByText('Saving. The switch moves when HalalGoes confirms.')).toBeTruthy();
    expect(screen.getByRole('switch', { name: 'Beef kofta plate available' }).getAttribute('aria-checked')).toBe('true');
    const sent = await bodyOf(api.callsTo(`PUT /v1/restaurant/menu/items/${kofta.id}/availability`)[0]!);
    expect(sent.availability_state).toBe('OUT_OF_STOCK');
    const ms = Date.parse(sent.out_of_stock_until) - Date.now();
    expect(ms).toBeGreaterThan(59 * 60_000);
    expect(ms).toBeLessThan(61 * 60_000);
    await act(async () => resolve({ body: null }));
    const lengthMenu = await screen.findByRole('menu', { name: 'Change how long Beef kofta plate is out of stock' });
    const ticked = within(lengthMenu).getByRole('menuitemradio', { name: /^✓ For 1 hour \(until .+\)\s?, current$/ });
    expect(ticked.getAttribute('aria-checked')).toBe('true');
    await waitFor(() => expect(document.activeElement).toBe(ticked));
    // Until closing needs the next closing time from the server (Needs API): offered but off.
    expect(within(lengthMenu).getByRole('menuitem', { name: /^Until closing, / }).getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByText('Out of stock now. Choose another length, or press Escape to keep this one.')).toBeTruthy();
    fireEvent.keyDown(ticked, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    expect(screen.getByRole('switch', { name: 'Beef kofta plate available' }).getAttribute('aria-checked')).toBe('false');
    expect(api.callsTo(`PUT /v1/restaurant/menu/items/${kofta.id}/availability`)).toHaveLength(1);
    expect(within(grid()).getByText(/^for 1 hour \(until \d{1,2}:\d{2} [ap]m\)$/)).toBeTruthy();
  });

  it('back to Available is one tap; Until you turn it back on sends no end time', async () => {
    const menu = richMenu();
    const lamb = byName(menu, 'Lamb mandi');
    const route = `PUT /v1/restaurant/menu/items/${lamb.id}/availability`;
    const api = installFakeApi(
      routes({ [route]: async (req) => ({ body: { ...lamb, ...(await bodyOf(req)) } }) }, menu),
    );
    await openMenu();
    expect(within(grid()).getByText(/^until \d{1,2}:\d{2} [ap]m( tomorrow)?$/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^Change how long Lamb mandi is out of stock/ }));
    const m = screen.getByRole('menu', { name: 'Change how long Lamb mandi is out of stock' });
    expect(within(m).getByText(/^Now: out of stock until/)).toBeTruthy();
    fireEvent.click(within(m).getByRole('menuitemradio', { name: /Until you turn it back on/ }));
    await waitFor(() => expect(api.callsTo(route)).toHaveLength(1));
    expect(await bodyOf(api.callsTo(route)[0]!)).toEqual({ availability_state: 'OUT_OF_STOCK', out_of_stock_until: null });
    const lambRow = () => screen.getByRole('switch', { name: 'Lamb mandi available' }).closest('tr') as HTMLElement;
    expect(await within(lambRow()).findByText('until you turn it back on')).toBeTruthy();
    fireEvent.click(screen.getByRole('switch', { name: 'Lamb mandi available' }));
    await waitFor(() => expect(api.callsTo(route)).toHaveLength(2));
    expect(await bodyOf(api.callsTo(route)[1]!)).toEqual({ availability_state: 'AVAILABLE', out_of_stock_until: null });
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Lamb mandi available' }).getAttribute('aria-checked')).toBe('true'));
  });

  it('a failed save says it is still available and offers Try again with the same change', async () => {
    const menu = richMenu();
    const kofta = byName(menu, 'Beef kofta plate');
    const route = `PUT /v1/restaurant/menu/items/${kofta.id}/availability`;
    const api = installFakeApi(routes({ [route]: { status: 503, body: errorBody('SERVICE_UNAVAILABLE') } }, menu));
    await openMenu();
    fireEvent.click(screen.getByRole('switch', { name: 'Beef kofta plate available' }));
    expect(await screen.findByText('Couldn’t mark it out of stock. It’s still available to customers.')).toBeTruthy();
    expect(await screen.findByText('Couldn’t mark Beef kofta plate out of stock')).toBeTruthy();
    expect(screen.getByRole('switch', { name: 'Beef kofta plate available' }).getAttribute('aria-checked')).toBe('true');
    api.set(route, async (req) => ({ body: { ...kofta, ...(await bodyOf(req)) } }));
    fireEvent.click(screen.getByRole('button', { name: 'Try again: Beef kofta plate' }));
    await waitFor(() => expect(api.callsTo(route)).toHaveLength(2));
    expect((await bodyOf(api.callsTo(route)[1]!)).availability_state).toBe('OUT_OF_STOCK');
  });

  it('403 ITEM_BLOCKED_BY_ADMIN turns the row Blocked and says the change was not saved', async () => {
    const menu = richMenu();
    const kofta = byName(menu, 'Beef kofta plate');
    installFakeApi(routes({ [`PUT /v1/restaurant/menu/items/${kofta.id}/availability`]: 'error_item_blocked_by_admin' }, menu));
    await openMenu();
    fireEvent.click(screen.getByRole('switch', { name: 'Beef kofta plate available' }));
    expect(await screen.findByText('Your change wasn’t saved. HalalGoes had blocked it.')).toBeTruthy();
    expect(screen.queryByRole('switch', { name: 'Beef kofta plate available' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Contact support about Beef kofta plate' })).toBeTruthy();
    // The admin's reason is not rendered (Needs API).
    expect(screen.queryByText(/photo shows a different dish/)).toBeNull();
  });

  it('403 MENU_LOCKED from a stale tab: the row says so and the page turns read-only (MenuSuspendedRefused)', async () => {
    const menu = richMenu();
    const kofta = byName(menu, 'Beef kofta plate');
    installFakeApi(routes({ [`PUT /v1/restaurant/menu/items/${kofta.id}/availability`]: 'error_menu_locked' }, menu));
    await openMenu();
    fireEvent.click(screen.getByRole('switch', { name: 'Beef kofta plate available' }));
    expect(await screen.findByText('Not saved: your account is suspended. Beef kofta plate is still available to customers.')).toBeTruthy();
    expect(screen.getByText('Your menu is read-only while your account is suspended.')).toBeTruthy();
    expect(screen.getByRole('switch', { name: 'Beef kofta plate available' }).hasAttribute('disabled')).toBe(true);
    expect(screen.queryByRole('button', { name: 'Add item' })).toBeNull();
    expect(screen.getByRole('button', { name: 'View Beef kofta plate' })).toBeTruthy();
  });

  it('429 says how long to wait', async () => {
    const menu = richMenu();
    const kofta = byName(menu, 'Beef kofta plate');
    installFakeApi(
      routes(
        {
          [`PUT /v1/restaurant/menu/items/${kofta.id}/availability`]: {
            status: 429,
            body: errorBody('RATE_LIMITED'),
            headers: { 'Retry-After': '700' },
          },
        },
        menu,
      ),
    );
    await openMenu();
    fireEvent.click(screen.getByRole('switch', { name: 'Beef kofta plate available' }));
    expect(await screen.findByText('Too many availability changes')).toBeTruthy();
    expect(screen.getByText('You can make 120 changes an hour. Try again in 12 minutes. Nothing else changed.')).toBeTruthy();
  });
});

describe('account and certificate states', () => {
  it('SUSPENDED: banner, everything read-only (switches, no Change menu, View, no Add)', async () => {
    installFakeApi(routes({ 'GET /v1/restaurant/profile': profile({ account_state: 'SUSPENDED' }) }));
    await openMenu();
    expect(await screen.findByText('Your menu is read-only while your account is suspended.')).toBeTruthy();
    // The menu grid's switches (the status bar's Orders switch is on every console page).
    const switches = within(grid()).getAllByRole('switch');
    expect(switches.length).toBeGreaterThan(0);
    for (const sw of switches) expect(sw.hasAttribute('disabled')).toBe(true);
    expect(screen.queryByRole('button', { name: /^Change how long/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add item' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add category' })).toBeNull();
    expect(screen.getByRole('columnheader', { name: 'View' })).toBeTruthy();
    expect(document.getElementById(`${IDS.mains}-lock`)?.textContent).toBe('Availability is locked: read-only while your account is suspended.');
  });

  it('DEACTIVATED: view only — availability as text, no Edit column, no Add', async () => {
    installFakeApi(routes({ 'GET /v1/restaurant/profile': profile({ account_state: 'DEACTIVATED' }) }));
    await openMenu();
    expect(await screen.findByText('View only while deactivated.')).toBeTruthy();
    expect(screen.getByText('Your restaurant is deactivated.')).toBeTruthy();
    // The menu grid's switches (the status bar's Orders switch is on every console page).
    expect(within(grid()).queryAllByRole('switch')).toHaveLength(0);
    expect(screen.queryByRole('columnheader', { name: 'Edit' })).toBeNull();
    expect(within(grid()).getAllByText('Available').length).toBeGreaterThan(0);
    expect(within(grid()).getByText('Until it’s marked available')).toBeTruthy();
  });

  it('DELISTED: editable, with the delisted banner; Show items not approved sets the filter', async () => {
    installFakeApi(routes({ 'GET /v1/restaurant/profile': profile({ account_state: 'DELISTED' }) }));
    await openMenu();
    expect(await screen.findByText('Customers can’t find your restaurant right now.')).toBeTruthy();
    expect(screen.getByRole('switch', { name: 'Beef kofta plate available' }).hasAttribute('disabled')).toBe(false);
    expect(screen.getByRole('button', { name: 'Add item' }).getAttribute('data-variant')).toBe('tertiary');
    fireEvent.click(screen.getByRole('button', { name: 'Show items not approved' }));
    expect(await screen.findByRole('heading', { level: 2, name: 'Items not approved' })).toBeTruthy();
  });

  it('an expired certificate is a neutral banner, never danger; no halal field is never read as certified', async () => {
    installFakeApi(
      routes({ 'GET /v1/restaurant/profile': profile({ halal: { display_state: 'EXPIRED', expires_on: '2026-09-20', certifying_body_name: null } }) }),
    );
    await openMenu();
    const title = await screen.findByText('Customers can’t find your restaurant right now.');
    const banner = title.closest('[data-testid="banner"]')!;
    expect(banner.getAttribute('data-variant')).toBe('neutral');
    expect(banner.textContent).toContain('Your halal certificate expired on 20 September 2026.');
    expect(screen.getByRole('link', { name: 'Upload renewed certificate' })).toBeTruthy();
    expect(screen.getByText(/Customers can’t see it right now\.$/)).toBeTruthy();
    cleanup();
    // Missing halal field: no certificate banner, and nothing that only a certificate allows.
    // With the certified fixture the same item reads "Live on your menu" (the edit test below);
    // without a halal field it must not.
    const menu = richMenu();
    const p = fixture('restaurant_profile');
    expect(p.halal.display_state).toBe('CERTIFIED');
    delete p.halal;
    installFakeApi(routes({ 'GET /v1/restaurant/profile': { body: p } }, menu));
    await openMenu(`/menu?edit=${byName(menu, 'Beef kofta plate').id}`);
    const editor = await screen.findByRole('region', { name: 'Edit Beef kofta plate' });
    expect(document.getElementById('cert-banner')).toBeNull();
    expect(within(editor).queryByText('Live on your menu')).toBeNull();
    expect(within(editor).getByText('Approved')).toBeTruthy();
  });

  it('?new=1 never opens an editor on a suspended, deactivated or empty menu', async () => {
    for (const account_state of ['SUSPENDED', 'DEACTIVATED']) {
      const api = installFakeApi(routes({ 'GET /v1/restaurant/profile': profile({ account_state }) }));
      await openMenu('/menu?new=1');
      await waitFor(() => expect(screen.getByRole('navigation', { name: 'Menu categories' })).toBeTruthy());
      expect(screen.queryByRole('region', { name: 'New item' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Submit for review' })).toBeNull();
      expect(api.callsTo('POST /v1/restaurant/menu/items')).toHaveLength(0);
      cleanup();
    }
    installFakeApi(routes({}, { restaurant_id: 'x', categories: [] }));
    await renderRedesign('/menu?new=1');
    expect(await screen.findByRole('region', { name: 'Start your menu' })).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'New item' })).toBeNull();
  });

  it('the profile failed to load: the menu is view only (never editable) until Try again reads it', async () => {
    let fail = true;
    installFakeApi(
      routes({
        'GET /v1/restaurant/profile': () => (fail ? { status: 503, body: errorBody('SERVICE_UNAVAILABLE') } : profile()),
      }),
    );
    await openMenu('/menu?new=1');
    expect(await screen.findByText('We couldn’t check your account, so your menu is view only for now.')).toBeTruthy();
    expect(screen.getByText('View only until your account loads.')).toBeTruthy();
    // The menu grid's switches (the status bar's Orders switch is on every console page).
    expect(within(grid()).queryAllByRole('switch')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'Add item' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add category' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'New item' })).toBeNull();
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('switch', { name: 'Beef kofta plate available' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add item' })).toBeTruthy();
    expect(screen.queryByText('We couldn’t check your account, so your menu is view only for now.')).toBeNull();
  });
});

describe('add a category', () => {
  it('creates with one Idempotency-Key reused on retry; 409 names the clash', async () => {
    const created = { ...fixture('menu_category_created'), name: 'Grills' };
    let n = 0;
    const api = installFakeApi(
      routes({
        'POST /v1/restaurant/menu/categories': () => {
          n += 1;
          if (n === 1) return { status: 409, body: errorBody('CATEGORY_NAME_TAKEN') };
          if (n === 2) return { status: 503, body: errorBody('SERVICE_UNAVAILABLE') };
          return { status: 201, body: created };
        },
      }),
    );
    await openMenu('/menu?panel=category');
    expect(document.activeElement?.id).toBe('cat-panel-h');
    const name = screen.getByRole('textbox', { name: /Category name/ });
    const panel = screen.getByRole('region', { name: 'Add a category' });
    fireEvent.change(name, { target: { value: 'Mains' } });
    fireEvent.click(within(panel).getByRole('button', { name: 'Add category' }));
    expect(await screen.findByText('You already have a category called Mains. Choose another name.')).toBeTruthy();
    fireEvent.change(name, { target: { value: 'Grills' } });
    fireEvent.click(within(panel).getByRole('button', { name: 'Add category' }));
    expect(await screen.findByText('We couldn’t add Grills.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Grills added')).toBeTruthy();
    const keys = api.callsTo('POST /v1/restaurant/menu/categories').map((r) => r.headers.get('Idempotency-Key'));
    expect(keys[1]).toBeTruthy();
    expect(keys[2]).toBe(keys[1]);
    expect(keys[0]).not.toBe(keys[1]);
    // Created: the new category is selected, empty.
    expect(await screen.findByRole('heading', { name: 'No items in Grills yet' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Add a category' })).toBeNull();
  });

  it('409 IDEMPOTENCY_KEY_REUSE after a lost answer: the menu is re-read and the category the first try made is shown', async () => {
    const created = { ...fixture('menu_category_created'), id: '00000000-0000-4000-8000-000000000777', name: 'Grills' };
    const api = installFakeApi(
      routes({
        'POST /v1/restaurant/menu/categories': (_req, n) =>
          n === 1 ? { status: 503, body: errorBody('SERVICE_UNAVAILABLE') } : { status: 409, body: errorBody('IDEMPOTENCY_KEY_REUSE') },
      }),
    );
    await openMenu('/menu?panel=category');
    const panel = screen.getByRole('region', { name: 'Add a category' });
    fireEvent.change(screen.getByRole('textbox', { name: /Category name/ }), { target: { value: 'Grills' } });
    fireEvent.click(within(panel).getByRole('button', { name: 'Add category' }));
    expect(await screen.findByText('We couldn’t add Grills.')).toBeTruthy();
    // The first try did reach the server: the menu now has Grills.
    const menu = richMenu();
    menu.categories.push({ ...created, items: [] });
    api.set(MENU, { body: menu });
    fireEvent.change(screen.getByRole('textbox', { name: /Description/ }), { target: { value: 'Off the charcoal' } });
    fireEvent.click(within(panel).getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Grills added')).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Add a category' })).toBeNull());
    // No second category: the 409 was answered from the menu, not by sending again.
    expect(api.callsTo('POST /v1/restaurant/menu/categories')).toHaveLength(2);
    expect(await screen.findByRole('heading', { name: 'No items in Grills yet' })).toBeTruthy();
  });

  it('at 40 categories Add category is off and says why', async () => {
    const cats = Array.from({ length: 40 }, (_, i) => category(`Cat ${i + 1}`, [], { id: `00000000-0000-4000-8000-1000000000${String(i).padStart(2, '0')}` }));
    installFakeApi(routes({}, { restaurant_id: 'x', categories: cats }));
    await openMenu();
    const add = screen.getByRole('button', { name: 'Add category. Not available: you have 40 categories, the most allowed.' });
    expect(add.getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByText(/You have 40 categories, the most allowed\./)).toBeTruthy();
  });
});

describe('item details panel', () => {
  it('?item= opens the details (focus to heading); sizes and add-ons are listed; close returns focus to the opener', async () => {
    installFakeApi(routes());
    await openMenu();
    const opener = screen.getByRole('button', { name: 'Show details for Beef kofta plate' });
    opener.focus();
    fireEvent.click(opener);
    const panel = await screen.findByRole('complementary', { name: 'Beef kofta plate' });
    expect(document.activeElement?.id).toBe('item-panel-h');
    expect(within(panel).getByText('Mains · item details')).toBeTruthy();
    expect(within(panel).getByRole('heading', { name: 'What customers see' })).toBeTruthy();
    expect(within(panel).getByText('Dietary tags describe the recipe. They never describe halal certification.')).toBeTruthy();
    expect(within(panel).getByText(/Required · choose 1/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Details open for Beef kofta plate' }).getAttribute('aria-expanded')).toBe('true');
    // Narrow grid while a panel is open: no Price or Review column.
    expect(screen.queryByRole('columnheader', { name: 'Review' })).toBeNull();
    expect(screen.getByRole('navigation', { name: 'Menu categories, collapsed' })).toBeTruthy();
    fireEvent.click(within(panel).getByRole('button', { name: 'Close details for Beef kofta plate' }));
    await waitFor(() => expect(screen.queryByRole('complementary', { name: 'Beef kofta plate' })).toBeNull());
    await waitFor(() => expect((document.activeElement as HTMLElement).getAttribute('aria-label')).toBe('Show details for Beef kofta plate'));
  });

  it('turning an item off in the details panel opens the length menu in the panel, beside that switch', async () => {
    const menu = richMenu();
    const kofta = byName(menu, 'Beef kofta plate');
    const route = `PUT /v1/restaurant/menu/items/${kofta.id}/availability`;
    installFakeApi(routes({ [route]: async (req) => ({ body: { ...kofta, ...(await bodyOf(req)) } }) }, menu));
    await openMenu(`/menu?item=${kofta.id}`);
    const panel = await screen.findByRole('complementary', { name: 'Beef kofta plate' });
    fireEvent.click(within(panel).getByRole('switch', { name: 'Beef kofta plate available' }));
    const lengthMenu = await within(panel).findByRole('menu', { name: 'Change how long Beef kofta plate is out of stock' });
    await waitFor(() => expect(lengthMenu.contains(document.activeElement)).toBe(true));
    expect(within(panel).getByText('Out of stock now. Choose another length, or press Escape to keep this one.')).toBeTruthy();
    expect(within(grid()).queryByRole('menu')).toBeNull();
    expect(within(grid()).queryByText('Out of stock now. Choose another length, or press Escape to keep this one.')).toBeNull();
  });

  it('a not-approved item shows the reviewer’s note and Edit and resubmit', async () => {
    const menu = richMenu();
    installFakeApi(routes({}, menu));
    await openMenu(`/menu?item=${byName(menu, 'Fish curry').id}`);
    const panel = await screen.findByRole('complementary', { name: 'Fish curry' });
    expect(within(panel).getByText('Not approved: Halal claim not supported')).toBeTruthy();
    expect(within(panel).getByText('Reviewer’s note: “Remove “zabiha certified” from the description.”')).toBeTruthy();
    expect(within(panel).getByText('Flagged by the reviewer')).toBeTruthy();
    expect(within(panel).getByRole('button', { name: 'Edit and resubmit Fish curry' })).toBeTruthy();
  });
});

describe('item editor', () => {
  it('new item: price is checked locally (hint only), then createMenuItem with one Idempotency-Key and integer cents', async () => {
    const created = { ...fixture('menu_item_created_pending_review'), name: 'Halloumi plate', category_id: IDS.mains };
    let fail = true;
    const api = installFakeApi(
      routes({
        'POST /v1/restaurant/menu/items': () => {
          if (fail) {
            fail = false;
            return { status: 503, body: errorBody('SERVICE_UNAVAILABLE') };
          }
          return { status: 201, body: created };
        },
      }),
    );
    await openMenu('/menu?new=1');
    const editor = await screen.findByRole('region', { name: 'New item' });
    expect(document.activeElement?.id).toBe('item-editor-h');
    expect(within(editor).getByText('Not submitted yet')).toBeTruthy();
    expect(within(editor).getByText('Nothing to submit yet')).toBeTruthy();
    // Halal certified is never offered as a dietary tag.
    expect(within(editor).queryByRole('checkbox', { name: /halal/i })).toBeNull();
    fireEvent.change(within(editor).getByRole('textbox', { name: /^Price/ }), { target: { value: '0.25' } });
    fireEvent.change(within(editor).getByRole('textbox', { name: /^Name/ }), { target: { value: 'Halloumi plate' } });
    fireEvent.click(within(editor).getByRole('button', { name: 'Submit for review' }));
    const summary = (await within(editor).findByText('1 thing to fix before you can submit')).closest('[role="alert"]') as HTMLElement;
    expect(within(summary).getByRole('link', { name: 'Price is outside the allowed range' })).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(summary));
    expect(within(editor).getByText('Enter a price between $0.50 and $500.00.')).toBeTruthy();
    expect(api.callsTo('POST /v1/restaurant/menu/items')).toHaveLength(0);
    fireEvent.change(within(editor).getByRole('textbox', { name: /^Price/ }), { target: { value: '12.50' } });
    fireEvent.click(within(editor).getByRole('checkbox', { name: 'Sesame' }));
    fireEvent.click(within(editor).getByRole('button', { name: 'Submit for review' }));
    expect(await within(editor).findByText('We couldn’t submit your changes')).toBeTruthy();
    fireEvent.click(within(editor).getByRole('button', { name: 'Submit again' }));
    expect(await screen.findByText('Halloumi plate sent for review')).toBeTruthy();
    const calls = api.callsTo('POST /v1/restaurant/menu/items');
    expect(calls).toHaveLength(2);
    expect(calls[1]!.headers.get('Idempotency-Key')).toBe(calls[0]!.headers.get('Idempotency-Key'));
    const body = await bodyOf(calls[1]!);
    expect(body).toMatchObject({ category_id: IDS.mains, name: 'Halloumi plate', price_cents: 1250, allergen_tags: ['SESAME'] });
    expect(Number.isInteger(body.price_cents)).toBe(true);
    await waitFor(() => expect(screen.queryByRole('region', { name: 'New item' })).toBeNull());
  });

  it('edit: sends only what changed; a price-only change says Save changes and goes live now', async () => {
    const menu = richMenu();
    const kofta = byName(menu, 'Beef kofta plate');
    const route = `PATCH /v1/restaurant/menu/items/${kofta.id}`;
    const api = installFakeApi(routes({ [route]: async (req) => ({ body: { ...kofta, ...(await bodyOf(req)) } }) }, menu));
    await openMenu(`/menu?edit=${kofta.id}`);
    const editor = await screen.findByRole('region', { name: 'Edit Beef kofta plate' });
    expect(within(editor).getByText('Mains · editing')).toBeTruthy();
    expect(within(editor).getByText('Live on your menu')).toBeTruthy();
    expect(within(grid()).getByText('Editing')).toBeTruthy();
    const submit = within(editor).getByRole('button', { name: 'Save changes' });
    expect(submit.getAttribute('aria-disabled')).toBe('true');
    fireEvent.change(within(editor).getByRole('textbox', { name: /^Price/ }), { target: { value: '19.25' } });
    expect(within(editor).getByText('Only the price changed. It goes live as soon as you save.')).toBeTruthy();
    fireEvent.click(within(editor).getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Price saved')).toBeTruthy();
    expect(screen.getByText('Beef kofta plate is now $19.25 for new orders. Orders already placed keep their price.')).toBeTruthy();
    expect(await bodyOf(api.callsTo(route)[0]!)).toEqual({ price_cents: 1925 });
  });

  it('server answers are mapped: PRICE_OUT_OF_RANGE, PROHIBITED_INGREDIENT, FIELD_NOT_WRITABLE', async () => {
    const menu = richMenu();
    const kofta = byName(menu, 'Beef kofta plate');
    const route = `PATCH /v1/restaurant/menu/items/${kofta.id}`;
    const api = installFakeApi(routes({ [route]: 'error_prohibited_ingredient' }, menu));
    await openMenu(`/menu?edit=${kofta.id}`);
    const editor = await screen.findByRole('region', { name: 'Edit Beef kofta plate' });
    fireEvent.change(within(editor).getByRole('textbox', { name: /^Ingredients/ }), { target: { value: 'beef, pork fat' } });
    fireEvent.click(within(editor).getByRole('button', { name: 'Save changes' }));
    expect(await within(editor).findByText('Ingredients include something that can’t be sold')).toBeTruthy();
    expect(within(editor).getByText('Items with pork or alcohol can’t be sold on HalalGoes. Check the ingredients and remove them to submit.')).toBeTruthy();
    expect(await bodyOf(api.callsTo(route)[0]!)).toEqual({ ingredients_text: 'beef, pork fat' });
    api.set(route, 'error_price_out_of_range');
    fireEvent.change(within(editor).getByRole('textbox', { name: /^Ingredients/ }), { target: { value: 'beef' } });
    fireEvent.click(within(editor).getByRole('button', { name: 'Save changes' }));
    expect(await within(editor).findByText('Price is outside the allowed range')).toBeTruthy();
    expect(within(editor).getByText('We checked your changes. Fix the items below; nothing was saved.')).toBeTruthy();
    api.set(route, 'error_halal_tag_not_writable');
    fireEvent.click(within(editor).getByRole('button', { name: 'Save changes' }));
    expect(await within(editor).findByText('“Halal certified” comes from your approved certificate, so it can’t be added to an item.')).toBeTruthy();
    expect(within(editor).getByRole('button', { name: 'Reload the item' })).toBeTruthy();
  });

  it('closing with changes asks in the footer; Keep editing keeps them', async () => {
    const menu = richMenu();
    const kofta = byName(menu, 'Beef kofta plate');
    installFakeApi(routes({}, menu));
    await openMenu(`/menu?edit=${kofta.id}`);
    const editor = await screen.findByRole('region', { name: 'Edit Beef kofta plate' });
    fireEvent.change(within(editor).getByRole('textbox', { name: /^Price/ }), { target: { value: '20.00' } });
    fireEvent.change(within(editor).getByRole('textbox', { name: /^Description/ }), { target: { value: 'New words' } });
    fireEvent.click(within(editor).getByRole('button', { name: 'Close Edit Beef kofta plate' }));
    const bar = await screen.findByRole('alertdialog', { name: 'Discard your changes?' });
    expect(within(bar).getByText(/You changed the price and the description of Beef kofta plate\./)).toBeTruthy();
    expect(document.activeElement?.id).toBe('discard-h');
    fireEvent.click(within(bar).getByRole('button', { name: 'Keep editing' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect((within(editor).getByRole('textbox', { name: /^Price/ }) as HTMLInputElement).value).toBe('20.00');
    fireEvent.click(within(editor).getByRole('button', { name: 'Cancel' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Discard' }));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Edit Beef kofta plate' })).toBeNull());
  });

  it('an item under review shows the approved copy beside the pending one; first review and not approved say so', async () => {
    const menu = richMenu();
    installFakeApi(routes({}, menu));
    await openMenu(`/menu?edit=${byName(menu, 'Chicken shawarma').id}`);
    const editor = await screen.findByRole('region', { name: 'Edit Chicken shawarma' });
    expect(within(editor).getByText('Under review')).toBeTruthy();
    expect(within(editor).getByText('Approved name (live now)')).toBeTruthy();
    expect((within(editor).getByRole('textbox', { name: /^Name \(under review\)/ }) as HTMLInputElement).value).toBe('Chicken shawarma wrap');
    expect(within(editor).getByRole('button', { name: 'Submit updated change' })).toBeTruthy();
    cleanup();
    installFakeApi(routes({}, menu));
    await openMenu(`/menu?edit=${byName(menu, 'Fish curry').id}`);
    const rejected = await screen.findByRole('region', { name: 'Edit Fish curry' });
    expect(within(rejected).getByText('Change not approved')).toBeTruthy();
    expect(within(rejected).getByText('Change the flagged field to submit again')).toBeTruthy();
    expect(within(rejected).getByText('Flagged by the reviewer: Halal claim not supported')).toBeTruthy();
    fireEvent.click(within(rejected).getByRole('link', { name: 'Halal claim not supported' }));
    expect(document.activeElement?.id).toBe('description-input');
  });

  it('a blocked item opens read-only with Contact support', async () => {
    const menu = richMenu();
    installFakeApi(routes({}, menu));
    await openMenu(`/menu?edit=${byName(menu, 'Falafel plate').id}`);
    const editor = await screen.findByRole('region', { name: 'Falafel plate' });
    expect(within(editor).getByText('Mains · view only')).toBeTruthy();
    expect(within(editor).getByText('Blocked by HalalGoes')).toBeTruthy();
    expect(within(editor).queryByRole('textbox')).toBeNull();
    expect(within(editor).getByRole('link', { name: 'Contact support about Falafel plate' })).toBeTruthy();
  });

  it('Add item from an empty category: closing the editor returns focus to that button', async () => {
    installFakeApi(routes());
    await openMenu(`/menu?category=${IDS.desserts}`);
    const add = screen.getByRole('button', { name: 'Add item to Desserts' });
    add.focus();
    fireEvent.click(add);
    const editor = await screen.findByRole('region', { name: 'New item' });
    fireEvent.click(within(editor).getByRole('button', { name: 'Close New item' }));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'New item' })).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Add item to Desserts' })));
  });

  it('403 MENU_LOCKED on a new item closes the editor and the page turns read-only', async () => {
    const api = installFakeApi(routes({ 'POST /v1/restaurant/menu/items': 'error_menu_locked' }));
    await openMenu('/menu?new=1');
    const editor = await screen.findByRole('region', { name: 'New item' });
    fireEvent.change(within(editor).getByRole('textbox', { name: /^Price/ }), { target: { value: '12.50' } });
    fireEvent.change(within(editor).getByRole('textbox', { name: /^Name/ }), { target: { value: 'Halloumi plate' } });
    fireEvent.click(within(editor).getByRole('button', { name: 'Submit for review' }));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'New item' })).toBeNull());
    expect(screen.getByText('Your menu is read-only while your account is suspended.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add item' })).toBeNull();
    expect(api.callsTo('POST /v1/restaurant/menu/items')).toHaveLength(1);
  });

  it('a changed body after a lost answer (409 IDEMPOTENCY_KEY_REUSE): nothing was made, so it is sent under a new key', async () => {
    const created = { ...fixture('menu_item_created_pending_review'), name: 'Halloumi platter', category_id: IDS.mains };
    const api = installFakeApi(
      routes({
        'POST /v1/restaurant/menu/items': (_req, n) =>
          n === 1
            ? { status: 503, body: errorBody('SERVICE_UNAVAILABLE') }
            : n === 2
              ? { status: 409, body: errorBody('IDEMPOTENCY_KEY_REUSE') }
              : { status: 201, body: created },
      }),
    );
    await openMenu('/menu?new=1');
    const editor = await screen.findByRole('region', { name: 'New item' });
    fireEvent.change(within(editor).getByRole('textbox', { name: /^Price/ }), { target: { value: '12.50' } });
    fireEvent.change(within(editor).getByRole('textbox', { name: /^Name/ }), { target: { value: 'Halloumi plate' } });
    fireEvent.click(within(editor).getByRole('button', { name: 'Submit for review' }));
    expect(await within(editor).findByText('We couldn’t submit your changes')).toBeTruthy();
    fireEvent.change(within(editor).getByRole('textbox', { name: /^Name/ }), { target: { value: 'Halloumi platter' } });
    fireEvent.click(within(editor).getByRole('button', { name: 'Submit again' }));
    expect(await screen.findByText('Halloumi platter sent for review')).toBeTruthy();
    const calls = api.callsTo('POST /v1/restaurant/menu/items');
    expect(calls).toHaveLength(3);
    const keys = calls.map((r) => r.headers.get('Idempotency-Key'));
    expect(keys[1]).toBe(keys[0]);
    expect(keys[2]).not.toBe(keys[1]);
    expect((await bodyOf(calls[2]!)).name).toBe('Halloumi platter');
  });

  it('422 VALIDATION_FAILED maps each field to its control; a cleared prep time or a non-number position is refused locally', async () => {
    const menu = richMenu();
    const kofta = byName(menu, 'Beef kofta plate');
    const route = `PATCH /v1/restaurant/menu/items/${kofta.id}`;
    const invalid = fixture('error_validation_failed');
    invalid.error.details = [
      { field: 'prep_minutes', code: 'maximum', message: 'Prep time is too long.' },
      { field: 'name', code: 'maxLength', message: 'Use a shorter name' },
    ];
    const api = installFakeApi(routes({ [route]: { status: 422, body: invalid } }, menu));
    await openMenu(`/menu?edit=${kofta.id}`);
    const editor = await screen.findByRole('region', { name: 'Edit Beef kofta plate' });
    const prep = within(editor).getByRole('textbox', { name: /^Prep time/ }) as HTMLInputElement;
    expect(prep.value).toBe(String(kofta.prep_minutes));
    // Cleared and junk: refused before anything is sent (an empty field would send nothing yet say "saved").
    fireEvent.change(prep, { target: { value: '' } });
    fireEvent.change(within(editor).getByRole('textbox', { name: /^Position in category/ }), { target: { value: 'top' } });
    fireEvent.click(within(editor).getByRole('button', { name: 'Save changes' }));
    const local = (await within(editor).findByText('2 things to fix before you can submit')).closest('[role="alert"]') as HTMLElement;
    expect(within(local).getByRole('link', { name: 'Prep time must be from 1 to 120 minutes' })).toBeTruthy();
    expect(within(local).getByRole('link', { name: 'Position must be a whole number' })).toBeTruthy();
    expect(within(editor).getByText('Enter a whole number, such as 1.')).toBeTruthy();
    expect(api.callsTo(route)).toHaveLength(0);
    fireEvent.click(within(local).getByRole('link', { name: 'Position must be a whole number' }));
    expect(document.activeElement?.id).toBe('position-input');
    // Valid locally; the server's field errors land on their controls.
    fireEvent.change(prep, { target: { value: '45' } });
    fireEvent.change(within(editor).getByRole('textbox', { name: /^Position in category/ }), { target: { value: String(kofta.sort_order) } });
    fireEvent.change(within(editor).getByRole('textbox', { name: /^Name/ }), { target: { value: 'Beef kofta plate with rice' } });
    fireEvent.click(within(editor).getByRole('button', { name: 'Save changes' }));
    const server = (await within(editor).findByText('We checked your changes. Fix the items below; nothing was saved.')).closest('[role="alert"]') as HTMLElement;
    expect(within(server).getByText('2 things to fix before you can submit')).toBeTruthy();
    expect(within(server).getByRole('link', { name: 'Prep time must be from 1 to 120 minutes' })).toBeTruthy();
    expect(within(server).getByRole('link', { name: 'Use a shorter name' })).toBeTruthy();
    expect(within(editor).getByText('Enter a prep time from 1 to 120 minutes.')).toBeTruthy();
    expect(await bodyOf(api.callsTo(route)[0]!)).toEqual({ prep_minutes: 45, name: 'Beef kofta plate with rice' });
  });

  it('a change under review that appears while editing an item that had none is a conflict (EditorConflict)', async () => {
    const menu = richMenu();
    const kofta = byName(menu, 'Beef kofta plate');
    const api = installFakeApi(routes({}, menu));
    await openMenu(`/menu?edit=${kofta.id}`);
    const editor = await screen.findByRole('region', { name: 'Edit Beef kofta plate' });
    fireEvent.change(within(editor).getByRole('textbox', { name: /^Description/ }), { target: { value: 'Mine' } });
    expect(within(editor).queryByText('Someone else changed this item while you were editing')).toBeNull();
    const changed = richMenu();
    byName(changed, 'Beef kofta plate').pending_version = {
      ...byName(changed, 'Beef kofta plate').live_version,
      id: '00000000-0000-4000-8000-000000009999',
      review_status: 'PENDING_REVIEW',
      submitted_at: '2026-09-27T18:12:00.000Z',
      description: 'Theirs',
    };
    api.set(MENU, { body: changed });
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    expect(await within(editor).findByText('Someone else changed this item while you were editing')).toBeTruthy();
    expect((within(editor).getByRole('textbox', { name: /^Description/ }) as HTMLTextAreaElement).value).toBe('Mine');
  });

  it('an item that is no longer on the menu says so', async () => {
    installFakeApi(routes());
    await openMenu('/menu?edit=00000000-0000-4000-8000-999999999999');
    expect(await screen.findByText('This item is no longer on your menu')).toBeTruthy();
  });
});

void item;
