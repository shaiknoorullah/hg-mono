/**
 * D1 Home and D2 the address switcher, against the contract's fixtures (WP2 DONE list): every
 * state family member, both rows' sorts, the offline halal cache at 14 and 16 minutes, and a
 * switcher that never calls `setDefaultAddress`.
 */
import * as React from 'react';
import { RefreshControl } from 'react-native';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';

import { resetConnectivity } from '../../lib/connectivity';
import { setNowOverride } from '../../lib/now';
import { formatTime } from '../../lib/time';
import { mockApi, payloadOf, type MockApi } from '../../test/mockApi';
import { navSpy, renderRedesign } from '../../test/render';
import { HomeScreen } from '../HomeScreen';
import { getChosenAddressId, resetChosenAddress } from '../deliveryAddress';
import { resetHomeCache } from '../homeData';
import type { Address, RestaurantCard } from '../format';

const T0 = Date.parse('2026-10-09T22:42:00Z'); // 6:42 pm in Toronto
const MIN = 60_000;

const restaurants = payloadOf<RestaurantCard[]>('restaurant_list_populated');
const addresses = payloadOf<Address[]>('addresses_list');
const home = addresses[0]!;
const work = addresses[1]!;

function listBody(data: RestaurantCard[], hasMore = false) {
  return { status: 200, body: { data, meta: { next_cursor: hasMore ? 'next' : null, has_more: hasMore, total: data.length } } };
}

/** The ordinary signed-in Home: addresses, no active order, an empty cart. */
const BASE = {
  listAddresses: 'addresses_list',
  getCustomerProfile: 'customer_profile',
  listRestaurants: 'restaurant_list_populated',
  getCart: 'cart_empty',
  getActiveOrder: 'order_no_active',
} as const;

let mock: MockApi;

beforeEach(() => {
  resetConnectivity();
  resetHomeCache();
  resetChosenAddress();
  setNowOverride({ at: T0 });
});

afterEach(() => {
  mock?.restore();
  setNowOverride(null);
});

async function renderHome(answers: Record<string, unknown> = {}, scheme: 'light' | 'dark' = 'light') {
  mock = mockApi({ ...BASE, ...(answers as Record<string, never>) });
  const nav = navSpy({ name: 'home' });
  renderRedesign(<HomeScreen />, { nav, scheme });
  return nav;
}

const restaurantCalls = () => mock.callsTo('listRestaurants').map((c) => new URL(c.url).searchParams);

describe('Home (D1)', () => {
  it('shows the address, both rows and the list, populated', async () => {
    await renderHome();
    expect(await screen.findByTestId('Home-list')).toBeTruthy();
    expect(screen.getByText('Home · 88 Harbour Street')).toBeTruthy();
    expect(screen.getByText('Deliver to')).toBeTruthy();
    expect(screen.getByText('Open now, closest first')).toBeTruthy();
    expect(screen.getByText('Quickest delivery')).toBeTruthy();
    expect(screen.getByText('All restaurants')).toBeTruthy();
    expect(screen.getByText('How we check halal certificates')).toBeTruthy();
    expect(screen.getByLabelText('Change delivery address, now 88 Harbour Street')).toBeTruthy();
    // No cart bar for an empty cart; no order strip with no active order.
    expect(screen.queryByTestId('Home-cartBar')).toBeNull();
    expect(screen.queryByTestId('Home-activeOrder')).toBeNull();
  });

  it('asks for the right sort on each row, and the list for the chosen address', async () => {
    await renderHome();
    await screen.findByTestId('Home-list');
    const calls = restaurantCalls();
    expect(calls).toHaveLength(3);
    const closest = calls.find((q) => q.get('sort') === 'DISTANCE_ASC')!;
    const quickest = calls.find((q) => q.get('sort') === 'ETA_ASC')!;
    const list = calls.find((q) => !q.has('sort'))!;
    expect(closest.get('open_now')).toBe('true');
    expect(quickest.get('open_now')).toBe('true');
    for (const q of [closest, quickest, list]) expect(q.get('delivery_address_id')).toBe(home.id);
    expect(list.has('open_now')).toBe(false);
  });

  it('composes one accessible name per card and opens the restaurant', async () => {
    const nav = await renderHome();
    await screen.findByTestId('Home-list');
    const karachi = restaurants[0]!;
    const card = screen.getByTestId(`Home-card-${karachi.id}`);
    expect(card.props.accessibilityLabel).toBe(
      'Karachi Kitchen. Halal certified by Halal Monitoring Authority (HMA Canada). Pakistani, Biryani. Moderately priced. ' +
        '25 to 40 minutes, 1.2 kilometres. Delivery about 4 dollars and 49 cents, estimate. Minimum order 15 dollars.',
    );
    fireEvent.press(card);
    expect(nav.log).toContainEqual({ action: 'push', route: { name: 'restaurant', restaurantId: karachi.id } });
  });

  it('dates an expiring certificate on the card, never as a second claim', async () => {
    await renderHome();
    await screen.findByTestId('Home-list');
    const zaytoun = restaurants.find((r) => r.halal.display_state === 'EXPIRING_SOON')!;
    const card = screen.getByTestId(`Home-card-${zaytoun.id}`);
    expect(within(card).getByTestId(`Home-card-${zaytoun.id}-halal`)).toBeTruthy();
    expect(within(card).getByText('expires 28 Aug')).toBeTruthy();
    expect(card.props.accessibilityLabel).toContain('certificate expires 28 August.');
  });

  it('renders no badge for a missing or partial halal record, only the neutral line', async () => {
    const [a, b, c] = restaurants;
    const missing = { ...a!, halal: undefined as never };
    const partial = { ...b!, halal: { ...b!.halal, certifying_body_name: null } };
    await renderHome({ listRestaurants: listBody([missing, partial, c!]) });
    await screen.findByTestId('Home-list');
    for (const r of [missing, partial]) {
      const card = screen.getByTestId(`Home-card-${r.id}`);
      expect(within(card).queryByTestId(`Home-card-${r.id}-halal`)).toBeNull();
      expect(within(card).getByText('Certificate details unavailable')).toBeTruthy();
      expect(card.props.accessibilityLabel).not.toContain('Halal certified');
    }
    expect(within(screen.getByTestId(`Home-card-${c!.id}`)).getByTestId(`Home-card-${c!.id}-halal`)).toBeTruthy();
  });

  it('shows closed and paused restaurants with their reason, not a time and fee', async () => {
    const [a, b] = restaurants;
    const closed = { ...a!, availability: { ...a!.availability, state: 'CLOSED_HOURS' as const, opens_at: '2026-10-10T15:00:00Z' } };
    const paused = { ...b!, availability: { ...b!.availability, state: 'PAUSED' as const } };
    await renderHome({ listRestaurants: listBody([closed, paused]) });
    await screen.findByTestId('Home-list');
    expect(screen.getAllByText('Closed · opens tomorrow at 11:00 am').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Not taking orders right now').length).toBeGreaterThan(0);
  });

  it('shows the View cart bar while the cart has items, and opens the cart', async () => {
    const nav = await renderHome({ getCart: 'cart_many_lines' });
    const bar = await screen.findByTestId('Home-cartBar');
    expect(within(bar).getByText('View cart · 11 items ·')).toBeTruthy();
    expect(bar.props.accessibilityLabel).toBe('View cart, 11 items, 380 dollars and 51 cents');
    fireEvent.press(bar);
    expect(nav.log).toContainEqual({ action: 'push', route: { name: 'cart' } });
  });

  it('shows the order in progress and opens its tracking', async () => {
    const nav = await renderHome({ getActiveOrder: 'order_preparing', getOrderTracking: 'tracking_preparing' });
    const strip = await screen.findByTestId('Home-activeOrder');
    const eta = formatTime(payloadOf('tracking_preparing').eta_at);
    expect(within(strip).getByText('Order HG-4K2M-9T · Karachi Kitchen')).toBeTruthy();
    expect(within(strip).getByText(`Arriving about ${eta}`)).toBeTruthy();
    expect(within(strip).getByText('Being prepared')).toBeTruthy();
    expect(strip.props.accessibilityLabel).toBe(
      `Your order HG-4K2M-9T from Karachi Kitchen is being prepared. Arriving about ${eta}. View order.`,
    );
    fireEvent.press(strip);
    expect(nav.log).toContainEqual({
      action: 'push',
      route: { name: 'tracking', orderId: payloadOf('order_preparing').id },
    });
  });

  it('shows skeletons while loading, and no badge', async () => {
    await renderHome({ listRestaurants: 'hang' });
    expect(await screen.findByTestId('Home-loading')).toBeTruthy();
    expect(await screen.findByText('Loading restaurants near Home…')).toBeTruthy();
    expect(screen.queryByTestId(/-halal$/)).toBeNull();
  });

  it('with no address: lists Ontario restaurants without rows and asks for an address', async () => {
    const noAddress = restaurants.slice(0, 3).map((r) => ({
      ...r,
      availability: { state: 'NO_ADDRESS' as const, distance_m: null },
    }));
    const nav = await renderHome({ listAddresses: 'addresses_empty', listRestaurants: listBody(noAddress) });
    expect(await screen.findByText('Set your delivery address')).toBeTruthy();
    expect(screen.getByText('Set an address')).toBeTruthy();
    expect(screen.getByText('Restaurants in Ontario')).toBeTruthy();
    expect(screen.getAllByText('Add an address for delivery time and fee')).toHaveLength(3);
    expect(screen.queryByText('Open now, closest first')).toBeNull();
    expect(restaurantCalls()).toHaveLength(1);
    expect(restaurantCalls()[0]!.has('delivery_address_id')).toBe(false);
    fireEvent.press(screen.getByText('Add an address'));
    expect(nav.log).toContainEqual({ action: 'push', route: { name: 'addressForm', addressId: null } });
  });

  it('says when nothing delivers to the address, and offers another', async () => {
    await renderHome({ listRestaurants: 'restaurant_list_empty' });
    expect(await screen.findByText('No restaurants deliver to 88 Harbour Street yet')).toBeTruthy();
    expect(screen.getByText("We're adding certified restaurants across Ontario one area at a time.")).toBeTruthy();
    fireEvent.press(screen.getByText('Try a different address'));
    expect(await screen.findByTestId('Switcher')).toBeTruthy();
  });

  it('shows the error with Try again, and recovers', async () => {
    await renderHome({ listRestaurants: [{ status: 500, code: 'INTERNAL_ERROR' }, 'restaurant_list_populated'] });
    expect(await screen.findByText("We couldn't load restaurants")).toBeTruthy();
    expect(screen.getByText('Check your connection and try again. Your cart and address are saved.')).toBeTruthy();
    // The rows failed too on the first round; a retry reloads all three.
    mock.answer('listRestaurants', 'restaurant_list_populated');
    fireEvent.press(screen.getByText('Try again'));
    expect(await screen.findByTestId('Home-list')).toBeTruthy();
  });

  it('pull to refresh re-runs the three calls and keeps the content on screen', async () => {
    await renderHome();
    await screen.findByTestId('Home-list');
    mock.answer('listRestaurants', 'hang');
    await act(async () => {
      screen.UNSAFE_getByType(RefreshControl).props.onRefresh();
    });
    expect(await screen.findByText('Refreshing restaurants…')).toBeTruthy();
    expect(screen.getByTestId('Home-list')).toBeTruthy();
    await waitFor(() => expect(restaurantCalls()).toHaveLength(6));
  });

  it('offline: shows the cache as of its time, with badges for 15 minutes and the neutral line after', async () => {
    await renderHome();
    await screen.findByTestId('Home-list');
    const karachi = restaurants[0]!;

    // The phone loses its connection: every call fails in transport.
    for (const op of ['listAddresses', 'getCustomerProfile', 'listRestaurants', 'getCart', 'getActiveOrder']) {
      mock.answer(op, 'offline');
    }
    await act(async () => {
      setNowOverride({ at: T0 + 5 * MIN });
      screen.UNSAFE_getByType(RefreshControl).props.onRefresh();
    });
    expect(await screen.findByText("You're offline")).toBeTruthy();
    expect(
      screen.getByText(
        `Showing restaurants as of 6:42 pm. You can browse; adding to your cart is paused until you're back online.`,
      ),
    ).toBeTruthy();

    act(() => setNowOverride({ at: T0 + 14 * MIN }));
    let card = screen.getByTestId(`Home-card-${karachi.id}`);
    expect(within(card).getByTestId(`Home-card-${karachi.id}-halal`)).toBeTruthy();
    expect(within(card).queryByText("We can't check the certification while you're offline.")).toBeNull();

    act(() => setNowOverride({ at: T0 + 16 * MIN }));
    card = screen.getByTestId(`Home-card-${karachi.id}`);
    expect(within(card).queryByTestId(`Home-card-${karachi.id}-halal`)).toBeNull();
    expect(within(card).getByText("We can't check the certification while you're offline.")).toBeTruthy();
    expect(card.props.accessibilityLabel).toContain('Certification cannot be checked while offline.');
    expect(screen.queryAllByTestId(/-halal$/)).toHaveLength(0);
  });

  it('renders in dark', async () => {
    await renderHome({ getCart: 'cart_many_lines' }, 'dark');
    expect(await screen.findByTestId('Home-list')).toBeTruthy();
    expect(screen.getByTestId('Home-cartBar')).toBeTruthy();
  });

  it('opens How we check and the search tab', async () => {
    const nav = await renderHome();
    await screen.findByTestId('Home-list');
    fireEvent.press(screen.getByText('How we check halal certificates'));
    expect(nav.log).toContainEqual({ action: 'push', route: { name: 'howWeCheck' } });
    fireEvent.press(screen.getByLabelText('Search restaurants or dishes'));
    expect(nav.log).toContainEqual({ action: 'selectTab', tab: 'search' });
    fireEvent.press(screen.getByLabelText('See all restaurants, quickest delivery first'));
    expect(nav.log).toContainEqual({ action: 'push', route: { name: 'browse', sort: 'ETA_ASC', openNow: true } });
  });
});

describe('the address switcher (D2)', () => {
  async function openSwitcher() {
    await screen.findByTestId('Home-list');
    fireEvent.press(screen.getByLabelText('Change delivery address, now 88 Harbour Street'));
    return screen.findByTestId('Switcher');
  }

  it('lists saved addresses and switches for this session only, never the default', async () => {
    await renderHome();
    await openSwitcher();
    expect(await screen.findByText('Home (default) · 88 Harbour Street')).toBeTruthy();
    expect(screen.getByText('Unit 4211, Toronto, ON M5J 0C3')).toBeTruthy();
    expect(
      screen.getByText('This changes where we deliver and which restaurants you see. Your default address stays the same.'),
    ).toBeTruthy();

    fireEvent.press(screen.getByText('Work · 35 Fontenay Court'));
    expect(await screen.findByText('Work · 35 Fontenay Court', {}, { timeout: 3000 })).toBeTruthy();
    expect(await screen.findByText('Delivering to Work')).toBeTruthy();
    expect(screen.getByText('Showing restaurants that deliver to 35 Fontenay Court.')).toBeTruthy();
    expect(screen.queryByTestId('Switcher')).toBeNull();

    const forWork = restaurantCalls().filter((q) => q.get('delivery_address_id') === work.id);
    expect(forWork.map((q) => q.get('sort'))).toEqual(expect.arrayContaining([null, 'DISTANCE_ASC', 'ETA_ASC']));
    expect(getChosenAddressId()).toBe(work.id);
    expect(mock.callsTo('setDefaultAddress')).toHaveLength(0);
    expect(mock.calls.filter((c) => c.method !== 'GET')).toHaveLength(0);
  });

  it('keeps the current address when the switch fails, and says so', async () => {
    await renderHome();
    await openSwitcher();
    await screen.findByText('Work · 35 Fontenay Court');
    mock.answer('listRestaurants', 'offline');
    fireEvent.press(screen.getByText('Work · 35 Fontenay Court'));
    expect(await screen.findByText("We couldn't switch to Work")).toBeTruthy();
    expect(
      screen.getByText("You're still delivering to 88 Harbour Street. Check your connection and pick Work again."),
    ).toBeTruthy();
    expect(getChosenAddressId()).toBeNull();
    expect(mock.callsTo('setDefaultAddress')).toHaveLength(0);
  });

  it('shows loading, then a load failure with Try again', async () => {
    await renderHome();
    await screen.findByTestId('Home-list');
    mock.answer('listAddresses', 'hang');
    fireEvent.press(screen.getByLabelText('Change delivery address, now 88 Harbour Street'));
    expect(await screen.findByTestId('Switcher-loading')).toBeTruthy();
  });

  it('shows the error when the addresses do not load', async () => {
    await renderHome();
    await screen.findByTestId('Home-list');
    mock.answer('listAddresses', { status: 500, code: 'INTERNAL_ERROR' });
    fireEvent.press(screen.getByLabelText('Change delivery address, now 88 Harbour Street'));
    expect(await screen.findByText("We couldn't load your addresses")).toBeTruthy();
    expect(screen.getByText("You're still delivering to 88 Harbour Street. Try again to see the others.")).toBeTruthy();
  });

  it('with no saved address, invites one', async () => {
    const nav = await renderHome({ listAddresses: 'addresses_empty' });
    await screen.findByText('Set your delivery address');
    fireEvent.press(screen.getByLabelText('Choose a delivery address'));
    expect(await screen.findByText('Where should we deliver?')).toBeTruthy();
    expect(screen.getByText('Add an address to see which restaurants deliver to you and to order.')).toBeTruthy();
    fireEvent.press(screen.getByText('Add address'));
    expect(nav.log).toContainEqual({ action: 'push', route: { name: 'addressForm', addressId: null } });
  });
});
