/**
 * WP4 D5/D6: the restaurant page and its certification sheet, against the contract's fixtures.
 *
 * DONE list (manifest §3 WP4): one test per RestaurantAvailabilityState and per
 * HalalDisplayState, HALAL_CERTIFIED never a dietary badge, the sheet, plus loading, deep-link
 * error, 404, empty menu, menu error, offline within and past 15 minutes, and dark.
 */
import * as React from 'react';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';

import { resetClientErrorReporter, setClientErrorReporter } from '../../ds';
import { resetConnectivity } from '../../lib/connectivity';
import { setNowOverride } from '../../lib/now';
import { mockApi, payloadOf, type MockApi } from '../../test/mockApi';
import { navSpy, renderRedesign, type NavSpy } from '../../test/render';
import { NOT_AVAILABLE_TITLE, RestaurantScreen } from '../RestaurantScreen';

const DETAIL = payloadOf('restaurant_detail_certified');
const ID: string = DETAIL.id;

let mock: MockApi;
let nav: NavSpy;
let reported: jest.Mock;

function detailWith(patch: Record<string, unknown>): { status: number; body: unknown } {
  return { status: 200, body: { data: { ...payloadOf('restaurant_detail_certified'), ...patch } } };
}

function withAvailability(scenario: string): { status: number; body: unknown } {
  return detailWith({ availability: payloadOf(scenario) });
}

function show(options: { scheme?: 'light' | 'dark'; onOpenItem?: (item: unknown) => void } = {}) {
  nav = navSpy({ name: 'restaurant', restaurantId: ID });
  return renderRedesign(<RestaurantScreen restaurantId={ID} onOpenItem={options.onOpenItem} />, {
    nav,
    scheme: options.scheme,
  });
}

async function ready(): Promise<void> {
  await screen.findByTestId('Restaurant-name');
}

async function menuReady(): Promise<void> {
  await waitFor(() => expect(screen.queryByTestId('Restaurant-menuLoading')).toBeNull());
}

beforeEach(() => {
  resetConnectivity();
  // 10 Aug 2026, 2:00 pm in Toronto (a Monday): inside the fixtures' world.
  setNowOverride({ at: Date.parse('2026-08-10T18:00:00Z') });
  mock = mockApi({
    getCart: 'cart_many_lines',
    listAddresses: 'addresses_list',
    getRestaurant: 'restaurant_detail_certified',
    getRestaurantMenu: 'menu_full',
    getRestaurantCertification: 'certification_panel_certified',
  });
  reported = jest.fn();
  setClientErrorReporter(reported);
});

afterEach(() => {
  resetClientErrorReporter();
  mock.restore();
  setNowOverride(null);
  resetConnectivity();
});

describe('D5 restaurant page: halal display states', () => {
  it('CERTIFIED: badge and "View certification" with its full accessible name, no expiry', async () => {
    show();
    await ready();
    expect(screen.getByText('Karachi Kitchen')).toBeTruthy();
    expect(screen.getByTestId('Restaurant-halalBadge')).toBeTruthy();
    expect(screen.queryByTestId('Restaurant-halalExpiry')).toBeNull();
    expect(screen.getByLabelText('View certification: halal certificate for Karachi Kitchen')).toBeTruthy();
    // "Halal" as a cuisine word is dropped: halal is shown only by the seal.
    expect(screen.getByText('Pakistani · Biryani · $$')).toBeTruthy();
    expect(screen.getByText('25–40 min · open until 6:00 pm ·')).toBeTruthy();
    expect(screen.getByTestId('Restaurant-hoursLink')).toBeTruthy();
    // The page is judged against the selected address (the default, Home).
    const call = mock.callsTo('getRestaurant')[0]!;
    expect(call.url).toContain('delivery_address_id=b7b6c797-5584-44b3-ac8d-9af8e9572de8');
  });

  it('EXPIRING_SOON: badge plus "expires 28 Aug", never red', async () => {
    mock.answer('getRestaurant', 'restaurant_detail_expiring_soon');
    show();
    await ready();
    expect(screen.getByTestId('Restaurant-halalBadge')).toBeTruthy();
    expect(screen.getByText('expires 28 Aug')).toBeTruthy();
    expect(screen.getByTestId('Restaurant-viewCertification')).toBeTruthy();
  });

  it('EXPIRED: the not-available page, with no halal reason', async () => {
    mock.answer('getRestaurant', 'restaurant_detail_expired');
    show();
    expect(await screen.findByText(NOT_AVAILABLE_TITLE)).toBeTruthy();
    expect(screen.getByText('It isn\'t listed on HalalGoes right now. You can find other certified restaurants near you.')).toBeTruthy();
    expect(screen.queryByText(/expired/i)).toBeNull();
    expect(screen.queryByTestId('Restaurant-halalBadge')).toBeNull();
    fireEvent.press(screen.getByText('Back to Home'));
    expect(nav.log).toContainEqual({ action: 'open', route: { name: 'home' } });
  });

  it('UNVERIFIED: the not-available page', async () => {
    mock.answer('getRestaurant', 'restaurant_detail_unverified');
    show();
    expect(await screen.findByText(NOT_AVAILABLE_TITLE)).toBeTruthy();
    expect(screen.queryByTestId('Restaurant-halalBadge')).toBeNull();
  });

  it('404 from getRestaurant: the not-available page', async () => {
    mock.answer('getRestaurant', { status: 404, code: 'NOT_FOUND' });
    show();
    expect(await screen.findByText(NOT_AVAILABLE_TITLE)).toBeTruthy();
  });

  it('partial record: no badge, no View certification, the neutral line, no retry', async () => {
    const cert = payloadOf('restaurant_detail_certified').certification;
    mock.answer(
      'getRestaurant',
      detailWith({ certification: { ...cert, certifying_body_name: null, issued_on: null, expires_on: null } }),
    );
    show();
    await ready();
    expect(screen.getByText('Certificate details unavailable')).toBeTruthy();
    expect(screen.queryByTestId('Restaurant-halalBadge')).toBeNull();
    expect(screen.queryByTestId('Restaurant-viewCertification')).toBeNull();
    expect(screen.queryByText('Try again')).toBeNull();
    // Adding stays open: the menu is listed as usual.
    await menuReady();
    expect(screen.getByText('Chicken Biryani')).toBeTruthy();
    // The missing fields are reported, once, never swallowed.
    expect(reported).toHaveBeenCalledTimes(1);
    expect(reported).toHaveBeenCalledWith('HALAL_DISPLAY_STATE_MISSING', {
      restaurantId: ID,
      surface: 'restaurant-page',
      missing: 'certifying_body_name,expires_on',
    });
  });

  it('missing record: the quiet read finds none, so the neutral line and nothing else', async () => {
    mock.answer('getRestaurant', detailWith({ certification: undefined }));
    mock.answer('getRestaurantCertification', { status: 404, code: 'NOT_FOUND' });
    show();
    await ready();
    expect(await screen.findByText('Certificate details unavailable')).toBeTruthy();
    expect(screen.queryByTestId('Restaurant-halalBadge')).toBeNull();
    expect(screen.queryByText('Try again')).toBeNull();
    expect(reported).toHaveBeenCalledWith('HALAL_DISPLAY_STATE_MISSING', {
      restaurantId: ID,
      surface: 'restaurant-page',
      missing: 'certification',
    });
  });

  it('a complete record reports nothing', async () => {
    show();
    await ready();
    await menuReady();
    expect(reported).not.toHaveBeenCalled();
  });

  it('failed read: the neutral line with Try again, and the badge returns when a read succeeds', async () => {
    mock.answer('getRestaurant', detailWith({ certification: undefined }));
    mock.answer('getRestaurantCertification', [{ status: 503, code: 'INTERNAL_ERROR' }, 'certification_panel_certified']);
    show();
    await ready();
    expect(await screen.findByTestId('Restaurant-halalRetry')).toBeTruthy();
    expect(screen.getByText('Certificate details unavailable')).toBeTruthy();
    expect(screen.queryByTestId('Restaurant-halalBadge')).toBeNull();
    fireEvent.press(screen.getByTestId('Restaurant-halalRetry'));
    expect(await screen.findByTestId('Restaurant-halalBadge')).toBeTruthy();
    expect(screen.getByTestId('Restaurant-viewCertification')).toBeTruthy();
  });
});

describe('D5 restaurant page: availability states', () => {
  it('OPEN: the "Hours" link opens the opening-hours disclosure', async () => {
    show();
    await ready();
    expect(screen.queryByTestId('Restaurant-hoursList')).toBeNull();
    fireEvent.press(screen.getByTestId('Restaurant-hoursLink'));
    expect(screen.getByTestId('Restaurant-hoursList')).toBeTruthy();
    expect(screen.getByTestId('Restaurant-hours').props.accessibilityState).toMatchObject({ expanded: true });
  });

  it('OPEN: no banner, fee and minimum from the server', async () => {
    show();
    await ready();
    expect(screen.queryByTestId('Restaurant-availability')).toBeNull();
    expect(screen.getByText('delivery (estimate)')).toBeTruthy();
    expect(screen.getByText('Min. order')).toBeTruthy();
  });

  it('CLOSED_HOURS: "Closed now · opens tomorrow at …" and Find an open restaurant', async () => {
    mock.answer('getRestaurant', withAvailability('restaurant_availability_closed_hours'));
    show();
    await ready();
    const banner = screen.getByTestId('Restaurant-availability');
    expect(within(banner).getByText('Closed now · opens tomorrow at 5:42 am')).toBeTruthy();
    expect(within(banner).getByText('You can read the menu. Adding to your cart opens when the kitchen does.')).toBeTruthy();
    expect(screen.getByText('3.2 km · closed now')).toBeTruthy();
    fireEvent.press(within(banner).getByText('Find an open restaurant'));
    expect(nav.log).toContainEqual({ action: 'push', route: { name: 'browse', openNow: true } });
  });

  it('PAUSED: "Not taking orders right now" with its way forward', async () => {
    mock.answer('getRestaurant', withAvailability('restaurant_availability_paused'));
    show();
    await ready();
    const banner = screen.getByTestId('Restaurant-availability');
    expect(within(banner).getByText('Not taking orders right now')).toBeTruthy();
    expect(
      within(banner).getByText('The kitchen has paused new orders. You can read the menu and check back later.'),
    ).toBeTruthy();
    expect(within(banner).getByText('Find an open restaurant')).toBeTruthy();
  });

  it('OUT_OF_RANGE: "Too far to deliver to Home" and Change address', async () => {
    mock.answer('getRestaurant', withAvailability('restaurant_availability_out_of_range'));
    show();
    await ready();
    const banner = screen.getByTestId('Restaurant-availability');
    expect(within(banner).getByText('Too far to deliver to Home')).toBeTruthy();
    expect(
      within(banner).getByText(
        "88 Harbour Street is outside this restaurant's delivery area. Choose another address to order.",
      ),
    ).toBeTruthy();
    fireEvent.press(within(banner).getByText('Change address'));
    expect(nav.log).toContainEqual({ action: 'push', route: { name: 'addresses' } });
  });

  it('NO_ADDRESS: "Add a delivery address to order" and Add an address', async () => {
    mock.answer('listAddresses', 'addresses_empty');
    mock.answer('getCart', 'cart_empty');
    mock.answer('getRestaurant', withAvailability('restaurant_availability_no_address'));
    show();
    await ready();
    expect(mock.callsTo('getRestaurant')[0]!.url).not.toContain('delivery_address_id');
    const banner = screen.getByTestId('Restaurant-availability');
    expect(within(banner).getByText('Add a delivery address to order')).toBeTruthy();
    expect(
      within(banner).getByText(
        'We need it to check that Karachi Kitchen delivers to you and to show the delivery time and fee.',
      ),
    ).toBeTruthy();
    expect(screen.getByText('Add an address for time and fee')).toBeTruthy();
    fireEvent.press(within(banner).getByText('Add an address'));
    expect(nav.log).toContainEqual({ action: 'push', route: { name: 'addressForm', addressId: null } });
  });
});

describe('D5 restaurant page: menu', () => {
  it('lists categories as jump tabs, rows with price and allergens, and never HALAL_CERTIFIED as a dietary badge', async () => {
    show();
    await ready();
    await menuReady();
    const tabs = screen.getByTestId('Restaurant-tabs');
    for (const c of ['Biryani & Rice', 'From the Charcoal Grill', 'Desserts']) {
      expect(within(tabs).getByText(c)).toBeTruthy();
    }
    expect(screen.getByLabelText('Chicken Biryani, 16 dollars and 95 cents. Contains milk.')).toBeTruthy();
    expect(screen.getByLabelText('Beef Nihari, 21 dollars and 45 cents. Spicy. Contains wheat.')).toBeTruthy();
    // Every item in menu_full carries HALAL_CERTIFIED; no row shows it.
    const rows = screen.getAllByTestId(/^MenuItemRow-/);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(within(row).queryByText(/halal/i)).toBeNull();
      expect(String(row.props.accessibilityLabel)).not.toMatch(/halal/i);
    }
  });

  it('out of stock says when it is back; HIDDEN and BLOCKED items are not listed', async () => {
    const menu = payloadOf('menu_full');
    const desserts = menu.categories[2];
    const extra = [
      { ...desserts.items[0], id: '00000000-0000-4000-8000-000000000001', name: 'Hidden halwa', availability_state: 'HIDDEN' },
      { ...desserts.items[0], id: '00000000-0000-4000-8000-000000000002', name: 'Blocked barfi', availability_state: 'BLOCKED' },
    ];
    mock.answer('getRestaurantMenu', {
      status: 200,
      body: { data: { ...menu, categories: [menu.categories[0], menu.categories[1], { ...desserts, items: [...desserts.items, ...extra] }] } },
    });
    show();
    await ready();
    await menuReady();
    expect(screen.getByText('Out of stock · back at 6:42 pm')).toBeTruthy();
    expect(screen.getByLabelText(/^Mango Lassi, 5 dollars and 49 cents\. Out of stock, back at 6:42 pm\./)).toBeTruthy();
    expect(screen.queryByText('Hidden halwa')).toBeNull();
    expect(screen.queryByText('Blocked barfi')).toBeNull();
  });

  it('tapping a dish hands it to the item sheet hook (WP5) and pushes nothing', async () => {
    const opened: unknown[] = [];
    show({ onOpenItem: (item) => opened.push(item) });
    await ready();
    await menuReady();
    fireEvent.press(screen.getByTestId('MenuItemRow-' + payloadOf('menu_full').categories[0].items[0].id));
    expect(opened).toHaveLength(1);
    expect(nav.log.filter((l) => l.action === 'push')).toEqual([]);
  });

  it('empty menu: "No menu yet" with a way to find another restaurant', async () => {
    mock.answer('getRestaurantMenu', 'menu_empty');
    show();
    await ready();
    expect(await screen.findByText('No menu yet')).toBeTruthy();
    expect(screen.getByText("Karachi Kitchen hasn't published its menu. Check back later.")).toBeTruthy();
    fireEvent.press(screen.getByText('Find another restaurant'));
    expect(nav.log).toContainEqual({ action: 'push', route: { name: 'browse' } });
  });

  it('menu error: the header stands and the menu offers Try again', async () => {
    mock.answer('getRestaurantMenu', [{ status: 500, code: 'INTERNAL_ERROR' }, 'menu_full']);
    show();
    await ready();
    expect(await screen.findByText("We couldn't load the menu")).toBeTruthy();
    expect(screen.getByText('The restaurant details above are current. Try the menu again.')).toBeTruthy();
    expect(screen.getByTestId('Restaurant-halalBadge')).toBeTruthy();
    fireEvent.press(within(screen.getByTestId('Restaurant-menuError')).getByText(/Try again/));
    expect(await screen.findByText('Chicken Biryani')).toBeTruthy();
  });
});

describe('D5 restaurant page: loading, errors, offline, cart', () => {
  it('loading: a neutral skeleton, never a placeholder badge', () => {
    mock.answer('getRestaurant', 'hang');
    show();
    expect(screen.getByTestId('Restaurant-loading')).toBeTruthy();
    expect(screen.getByLabelText('Loading the restaurant…')).toBeTruthy();
    expect(screen.queryByTestId('Restaurant-halalBadge')).toBeNull();
  });

  it('deep link error: "We couldn\'t load this restaurant" with Try again and Back to Home', async () => {
    mock.answer('getRestaurant', [{ status: 500, code: 'INTERNAL_ERROR' }, 'restaurant_detail_certified']);
    show();
    expect(await screen.findByText("We couldn't load this restaurant")).toBeTruthy();
    expect(screen.getByText('Back to Home')).toBeTruthy();
    fireEvent.press(screen.getByText(/Try again/));
    expect(await screen.findByTestId('Restaurant-name')).toBeTruthy();
  });

  it('offline within 15 minutes keeps the cached badge; past 15 minutes it becomes the neutral line', async () => {
    const t0 = Date.parse('2026-08-10T18:00:00Z');
    show();
    await ready();
    await menuReady();
    act(() => {
      resetConnectivity({ online: false, lastOnlineAt: t0 });
      setNowOverride({ at: t0 + 10 * 60 * 1000 });
    });
    expect(screen.getByText("You're offline")).toBeTruthy();
    expect(
      screen.getByText('Showing this page as of 2:00 pm. Adding to your cart is paused until you\'re back online.'),
    ).toBeTruthy();
    expect(screen.getByText('As of 2:00 pm')).toBeTruthy();
    expect(screen.getByTestId('Restaurant-halalBadge')).toBeTruthy();

    act(() => setNowOverride({ at: t0 + 16 * 60 * 1000 }));
    expect(screen.queryByTestId('Restaurant-halalBadge')).toBeNull();
    expect(screen.queryByTestId('Restaurant-viewCertification')).toBeNull();
    expect(screen.getByText("We can't check the certification while you're offline.")).toBeTruthy();
  });

  it('offline within 15 minutes, View certification opens the cached details with no read; the badge stays', async () => {
    const t0 = Date.parse('2026-08-10T18:00:00Z');
    show();
    await ready();
    await menuReady();
    act(() => {
      resetConnectivity({ online: false, lastOnlineAt: t0 });
      setNowOverride({ at: t0 + 10 * 60 * 1000 });
    });
    mock.answer('getRestaurantCertification', 'offline');
    fireEvent.press(screen.getByTestId('Restaurant-viewCertification'));
    expect(await screen.findByText('Halal Monitoring Authority (HMA Canada)')).toBeTruthy();
    expect(screen.queryByText("We couldn't load the certificate details.")).toBeNull();
    expect(mock.callsTo('getRestaurantCertification')).toHaveLength(0);
    fireEvent.press(screen.getByTestId('Restaurant-certSheet-close'));
    await waitFor(() => expect(screen.queryByTestId('Restaurant-certSheet')).toBeNull());
    expect(screen.getByTestId('Restaurant-halalBadge')).toBeTruthy();
    expect(screen.queryByTestId('Restaurant-halalRetry')).toBeNull();
  });

  it('a sheet read lost to the network never drops the page badge', async () => {
    mock.answer('getRestaurantCertification', 'offline');
    show();
    await ready();
    fireEvent.press(screen.getByTestId('Restaurant-viewCertification'));
    expect(await screen.findByText("We couldn't load the certificate details.")).toBeTruthy();
    fireEvent.press(screen.getByTestId('Restaurant-certSheet-close'));
    await waitFor(() => expect(screen.queryByTestId('Restaurant-certSheet')).toBeNull());
    expect(screen.getByTestId('Restaurant-halalBadge')).toBeTruthy();
    expect(screen.queryByTestId('Restaurant-halalRetry')).toBeNull();
  });

  it('shows the View cart bar from the server cart, and none for an empty cart', async () => {
    show();
    await ready();
    // The bar shows the server's indicative subtotal as given (cart_many_lines, after #644).
    expect(screen.getByText('View cart · 11 items · $386.51')).toBeTruthy();
    fireEvent.press(screen.getByTestId('Restaurant-viewCart'));
    expect(nav.log).toContainEqual({ action: 'push', route: { name: 'cart' } });
  });

  it('no cart bar when the cart is empty', async () => {
    mock.answer('getCart', 'cart_empty');
    show();
    await ready();
    expect(screen.queryByTestId('Restaurant-cartBar')).toBeNull();
  });

  it('renders in dark', async () => {
    mock.answer('getRestaurant', 'restaurant_detail_expiring_soon');
    show({ scheme: 'dark' });
    await ready();
    expect(screen.getByTestId('Restaurant-halalBadge')).toBeTruthy();
    expect(screen.getByText('expires 28 Aug')).toBeTruthy();
  });
});

describe('D6 certification sheet', () => {
  it('reads the panel when it opens and "View certificate" opens the viewer', async () => {
    show();
    await ready();
    expect(mock.callsTo('getRestaurantCertification')).toHaveLength(0);
    fireEvent.press(screen.getByTestId('Restaurant-viewCertification'));
    expect(await screen.findByText('Halal Monitoring Authority (HMA Canada)')).toBeTruthy();
    expect(mock.callsTo('getRestaurantCertification')).toHaveLength(1);
    fireEvent.press(screen.getByText('View certificate'));
    expect(nav.log).toContainEqual({ action: 'push', route: { name: 'certificate', restaurantId: ID } });
    // Minted by the viewer, never here.
    expect(mock.callsTo('createCertificateViewUrl')).toHaveLength(0);
  });

  it('loading says so and guesses no state', async () => {
    mock.answer('getRestaurantCertification', 'hang');
    show();
    await ready();
    fireEvent.press(screen.getByTestId('Restaurant-viewCertification'));
    expect(await screen.findByText('Loading certification details…')).toBeTruthy();
    // The page keeps its badge while the sheet loads.
    expect(screen.getByTestId('Restaurant-halalBadge')).toBeTruthy();
  });

  it('certificate not viewable: no View certificate, and the sheet says why', async () => {
    const cert = payloadOf('certification_panel_expiring_soon');
    mock.answer('getRestaurant', 'restaurant_detail_expiring_soon');
    mock.answer('getRestaurantCertification', { status: 200, body: { data: { ...cert, certificate_viewable: false } } });
    show();
    await ready();
    fireEvent.press(screen.getByTestId('Restaurant-viewCertification'));
    expect(
      await screen.findByText("The certificate image isn't available to view. The details above are what HalalGoes verified."),
    ).toBeTruthy();
    expect(screen.queryByText('View certificate')).toBeNull();
  });

  it('a sheet read that finds the certificate lapsed turns the page into the not-available page', async () => {
    mock.answer('getRestaurantCertification', 'certification_panel_expired');
    show();
    await ready();
    fireEvent.press(screen.getByTestId('Restaurant-viewCertification'));
    expect(await screen.findByText(NOT_AVAILABLE_TITLE)).toBeTruthy();
    expect(screen.queryByTestId('Restaurant-halalBadge')).toBeNull();
    expect(screen.queryByTestId('Restaurant-menuLoading')).toBeNull();
  });

  it('failed: one retry; closing drops the page badge for the neutral line until a read succeeds', async () => {
    mock.answer('getRestaurantCertification', { status: 500, code: 'INTERNAL_ERROR' });
    show();
    await ready();
    fireEvent.press(screen.getByTestId('Restaurant-viewCertification'));
    expect(await screen.findByText("We couldn't load the certificate details.")).toBeTruthy();
    expect(screen.getByText('Adding to your cart stays open.')).toBeTruthy();
    fireEvent.press(screen.getByTestId('Restaurant-certSheet-close'));
    expect(await screen.findByTestId('Restaurant-halalRetry')).toBeTruthy();
    expect(screen.queryByTestId('Restaurant-halalBadge')).toBeNull();
    mock.answer('getRestaurantCertification', 'certification_panel_certified');
    fireEvent.press(screen.getByTestId('Restaurant-halalRetry'));
    expect(await screen.findByTestId('Restaurant-halalBadge')).toBeTruthy();
  });
});
