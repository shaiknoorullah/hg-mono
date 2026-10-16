/**
 * Browse, "All restaurants", against the contract's fixtures: what the list asks for, a partial
 * halal record drawing no badge, the filters, paging, the offline halal cache, and the failures.
 */
import * as React from 'react';
import { fireEvent, screen, waitFor, within } from '@testing-library/react-native';

import { setApiFetch } from '../../api/client';
import { resetConnectivity } from '../../lib/connectivity';
import { setNowOverride } from '../../lib/now';
import { mockApi, payloadOf, type MockApi } from '../../test/mockApi';
import { navSpy, renderRedesign } from '../../test/render';
import { BrowseScreen } from '../BrowseScreen';
import { NO_FILTERS, cacheKey, rememberPage, resetBrowseCache } from '../browseData';
import { resetChosenAddress } from '../deliveryAddress';
import type { Address, RestaurantCard } from '../format';

const T0 = Date.parse('2026-10-09T22:42:00Z'); // 6:42 pm in Toronto
const MIN = 60_000;
const home = payloadOf<Address[]>('addresses_list')[0]!;

const BASE = {
  listAddresses: 'addresses_list',
  getCustomerProfile: 'customer_profile',
  listRestaurants: 'restaurant_list_populated',
  getCart: 'cart_empty',
} as const;

let mock: MockApi;

beforeEach(() => {
  resetConnectivity();
  resetBrowseCache();
  resetChosenAddress();
  setNowOverride({ at: T0 });
});
afterEach(() => {
  mock?.restore();
  setApiFetch(null);
  setNowOverride(null);
});

function page(data: RestaurantCard[], next: string | null = null) {
  return { status: 200, body: { data, meta: { next_cursor: next, has_more: next != null, total: data.length } } };
}

function renderBrowse(answers: Record<string, unknown> = {}, props: { sort?: string; openNow?: boolean } = {}) {
  mock = mockApi({ ...BASE, ...(answers as Record<string, never>) });
  const nav = navSpy({ name: 'browse', ...props });
  renderRedesign(<BrowseScreen {...props} />, { nav });
  return nav;
}

const listCalls = () => mock.callsTo('listRestaurants').map((c) => new URL(c.url).searchParams);

describe('Browse', () => {
  it('lists the restaurants for the chosen address, with the server’s own figures', async () => {
    renderBrowse();
    await screen.findByText('Karachi Kitchen');
    const q = listCalls()[0]!;
    expect(q.get('delivery_address_id')).toBe(home.id);
    expect(q.get('sort')).toBeNull(); // Recommended is the server's default
    expect(screen.getByText(`Near ${home.label?.trim() || home.line1}`)).toBeTruthy();
  });

  it('draws no halal badge for a record missing its certifier or its expiry, only the neutral line', async () => {
    renderBrowse({ listRestaurants: 'restaurant_list_missing_halal_fields' });
    await screen.findByText('Karachi Kitchen');
    expect(screen.queryByTestId(/^Browse-card-.*-halal$/)).toBeNull();
    expect(screen.getAllByText('Certificate details unavailable').length).toBe(4);
  });

  it('shows the badge only for the whole record in a partly complete list', async () => {
    renderBrowse({ listRestaurants: 'restaurant_list_partial_halal' });
    await screen.findByText('Karachi Kitchen');
    const cards = payloadOf<RestaurantCard[]>('restaurant_list_partial_halal');
    expect(screen.getByTestId(`Browse-card-${cards[0]!.id}-halal`)).toBeTruthy();
    for (const partial of cards.slice(1)) expect(screen.queryByTestId(`Browse-card-${partial.id}-halal`)).toBeNull();
    expect(screen.getAllByText('Certificate details unavailable').length).toBe(3);
  });

  it('sends the sort and the open-now filter it was opened with, and the filters from the sheet', async () => {
    renderBrowse({}, { sort: 'DISTANCE_ASC', openNow: true });
    await screen.findByText('Karachi Kitchen');
    expect(listCalls()[0]!.get('sort')).toBe('DISTANCE_ASC');
    expect(listCalls()[0]!.get('open_now')).toBe('true');

    fireEvent.press(screen.getByTestId('Browse-filters'));
    fireEvent.press(await screen.findByTestId('Filters-price-Moderate'));
    fireEvent.press(screen.getByTestId('Filters-dietary-Vegetarian'));
    fireEvent.press(screen.getByTestId('Filters-apply'));
    await waitFor(() => expect(listCalls().length).toBe(2));
    const q = listCalls()[1]!;
    expect(q.get('price_band')).toBe('$$'); // one comma-separated value, as the contract says
    expect(q.get('dietary')).toBe('VEGETARIAN');
    expect(q.get('open_now')).toBe('true');
    expect(screen.getByLabelText('Filters, 3 applied')).toBeTruthy();
  });

  it('removes a filter from its chip', async () => {
    renderBrowse({}, { openNow: true });
    await screen.findByText('Karachi Kitchen');
    fireEvent.press(within(screen.getByTestId('Browse-chip-open')).getByLabelText(/Remove/));
    await waitFor(() => expect(listCalls().length).toBe(2));
    expect(listCalls()[1]!.get('open_now')).toBeNull();
  });

  it('offers no distance sort and sends no address when the customer has none', async () => {
    renderBrowse({ listAddresses: { status: 200, body: { data: [], meta: { next_cursor: null, has_more: false } } }, getCustomerProfile: 'customer_profile', listRestaurants: 'restaurant_list_no_address' }, { sort: 'DISTANCE_ASC' });
    await screen.findByText('Karachi Kitchen');
    const q = listCalls()[0]!;
    expect(q.get('delivery_address_id')).toBeNull();
    expect(q.get('sort')).toBeNull();
    expect(screen.getByTestId('Browse-noAddress')).toBeTruthy();
    expect(screen.getAllByText('Add an address for delivery time and fee').length).toBeGreaterThan(0);
  });

  it('loads the next page when the list ends, and says when there is no more', async () => {
    const all = payloadOf<RestaurantCard[]>('restaurant_list_populated');
    const second = payloadOf<RestaurantCard[]>('restaurant_list_page_2');
    renderBrowse({ listRestaurants: [page(all.slice(0, 3), 'CURSOR-2'), page(second.slice(0, 2))] });
    await screen.findByText(all[0]!.name);
    fireEvent(screen.getByTestId('Browse-list'), 'endReached');
    await screen.findByText(second[0]!.name);
    expect(listCalls()[1]!.get('cursor')).toBe('CURSOR-2');
    expect(screen.getByText(all[0]!.name)).toBeTruthy(); // the first page stays
    expect(screen.getByTestId('Browse-end')).toBeTruthy();
  });

  it('offers to clear the filters when none match', async () => {
    renderBrowse({ listRestaurants: [page([]), 'restaurant_list_populated'] }, { openNow: true });
    await screen.findByTestId('Browse-filteredEmpty');
    fireEvent.press(screen.getByText('Clear all filters'));
    await screen.findByText('Karachi Kitchen');
    expect(listCalls()[1]!.get('open_now')).toBeNull();
  });

  it('keeps the filters and offers a retry when the list cannot load', async () => {
    renderBrowse({ listRestaurants: [{ status: 500, code: 'INTERNAL_ERROR' }, 'restaurant_list_populated'] }, { openNow: true });
    await screen.findByTestId('Browse-error');
    fireEvent.press(screen.getByText('Try again'));
    await screen.findByText('Karachi Kitchen');
    expect(listCalls()[1]!.get('open_now')).toBe('true');
  });

  it('offline shows the cached list as of its time, and omits the badge once it is over 15 minutes old', async () => {
    const cards = payloadOf<RestaurantCard[]>('restaurant_list_populated').slice(0, 2);
    const key = cacheKey(home, NO_FILTERS, 'RECOMMENDED');
    rememberPage(key, { data: cards, nextCursor: null, hasMore: false }, T0 - 16 * MIN);
    resetConnectivity({ online: false, lastOnlineAt: T0 - 16 * MIN });
    renderBrowse({ listRestaurants: 'offline' });
    await screen.findByTestId('Browse-offline');
    expect(screen.getByText(/Showing restaurants as of 6:26 pm/)).toBeTruthy();
    expect(screen.getByText(cards[0]!.name)).toBeTruthy();
    expect(screen.queryByTestId(`Browse-card-${cards[0]!.id}-halal`)).toBeNull();
    expect(screen.getAllByText("We can't check the certification while you're offline.").length).toBe(2);
  });
});
