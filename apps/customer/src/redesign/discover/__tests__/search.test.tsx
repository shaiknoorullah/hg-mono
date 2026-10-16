/**
 * Search against the contract's fixtures: nothing is asked under two letters, the two groups page
 * independently, a dish shows its restaurant's badge only when the record is whole, and the
 * empty, failed and offline answers.
 */
import * as React from 'react';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';

import { setApiFetch } from '../../api/client';
import { resetConnectivity } from '../../lib/connectivity';
import { setNowOverride } from '../../lib/now';
import { mockApi, payloadOf, type MockApi } from '../../test/mockApi';
import { navSpy, renderRedesign } from '../../test/render';
import { SearchScreen } from '../SearchScreen';
import { resetChosenAddress } from '../deliveryAddress';
import type { Address } from '../format';
import { clearRecent, getRecent, type DishResult } from '../searchData';

const home = payloadOf<Address[]>('addresses_list')[0]!;
const populated = payloadOf<{ restaurants: unknown[]; dishes: DishResult[] }>('search_results_populated');

const BASE = {
  listAddresses: 'addresses_list',
  getCustomerProfile: 'customer_profile',
  search: 'search_results_populated',
  getCart: 'cart_empty',
} as const;

let mock: MockApi;

beforeEach(() => {
  resetConnectivity();
  resetChosenAddress();
  clearRecent();
  setNowOverride({ at: Date.parse('2026-10-09T22:42:00Z') });
});
afterEach(() => {
  mock?.restore();
  setApiFetch(null);
  setNowOverride(null);
});

function results(
  restaurants: unknown[],
  dishes: unknown[],
  more: { restaurants?: string; dishes?: string } = {},
) {
  const meta = (c?: string) => ({ next_cursor: c ?? null, has_more: c != null, total: null });
  return { status: 200, body: { data: { restaurants, dishes }, meta: { restaurants: meta(more.restaurants), dishes: meta(more.dishes) } } };
}

function renderSearch(answers: Record<string, unknown> = {}) {
  mock = mockApi({ ...BASE, ...(answers as Record<string, never>) });
  const nav = navSpy({ name: 'search' });
  renderRedesign(<SearchScreen />, { nav });
  return nav;
}

const field = () => screen.getByTestId('Search-input-field');
const type = async (text: string) => {
  await act(async () => {
    fireEvent.changeText(field(), text);
  });
};
const searchCalls = () => mock.callsTo('search').map((c) => new URL(c.url).searchParams);

describe('Search', () => {
  it('shows the first-use note, then asks nothing for one letter', async () => {
    renderSearch();
    await screen.findByTestId('Search-firstUse');
    await type('s');
    await screen.findByTestId('Search-shortQuery');
    await new Promise((r) => setTimeout(r, 400));
    expect(searchCalls().length).toBe(0);
  });

  it('searches from two letters with the address coordinates, in two groups', async () => {
    renderSearch();
    await screen.findByTestId('Search-firstUse');
    await type('shawarma');
    await screen.findByTestId('Search-results');
    const q = searchCalls()[0]!;
    expect(q.get('q')).toBe('shawarma');
    expect(Number(q.get('latitude'))).toBe(home.latitude);
    expect(Number(q.get('longitude'))).toBe(home.longitude);
    expect(screen.getByText('Restaurants')).toBeTruthy();
    expect(screen.getByText('Dishes')).toBeTruthy();
    expect(screen.getAllByTestId(/^Search-dish-/).length).toBeGreaterThan(0);
  });

  it('pages one group on its own cursor and leaves the other untouched', async () => {
    const r = populated.restaurants.slice(0, 1);
    const d = populated.dishes.slice(0, 1);
    renderSearch({ search: [results(r, d, { restaurants: 'R2', dishes: 'D2' }), results(populated.restaurants.slice(1), [])] });
    await type('kebab');
    fireEvent.press(await screen.findByTestId('Search-moreRestaurants'));
    await waitFor(() => expect(searchCalls().length).toBe(2));
    const q = searchCalls()[1]!;
    expect(q.get('restaurants_cursor')).toBe('R2');
    expect(q.get('dishes_cursor')).toBeNull();
    expect(screen.getByTestId('Search-moreDishes')).toBeTruthy(); // dishes still have their own "more"
  });

  it('draws a dish’s restaurant badge only when that restaurant’s record is whole', async () => {
    const whole = populated.dishes[0]!;
    const partial: DishResult = {
      ...whole,
      menu_item_id: '00000000-0000-4000-8000-0000000000aa',
      name: 'Partial record dish',
      restaurant: { ...whole.restaurant, halal: { display_state: 'CERTIFIED' } },
    };
    renderSearch({ search: results([], [whole, partial]) });
    await type('tikka');
    await screen.findByText('Partial record dish');
    expect(screen.getByTestId(`Search-dish-${whole.menu_item_id}-halal`)).toBeTruthy();
    expect(screen.queryByTestId(`Search-dish-${partial.menu_item_id}-halal`)).toBeNull();
    expect(screen.getByText('Certificate details unavailable')).toBeTruthy();
    expect(screen.getByText('No restaurant names match "tikka".')).toBeTruthy();
  });

  it('says so, and offers a way on, when nothing matches', async () => {
    renderSearch({ search: results([], []) });
    await type('sushi');
    await screen.findByText('No results for "sushi"');
    fireEvent.press(screen.getByText('Browse all restaurants'));
  });

  it('remembers a search once a result is opened and lists it next time', async () => {
    const nav = renderSearch();
    await type('shawarma');
    const first = (await screen.findAllByTestId(/^Search-card-/))[0]!;
    fireEvent.press(first);
    expect(nav.log.some((l) => l.route?.name === 'restaurant')).toBe(true);
    expect(getRecent()).toEqual(['shawarma']);
  });

  it('offers a retry when search fails, and the offline note when it could not be reached', async () => {
    renderSearch({ search: [{ status: 500, code: 'INTERNAL_ERROR' }, 'search_results_populated'] });
    await type('karahi');
    await screen.findByTestId('Search-error');
    fireEvent.press(screen.getByText('Try again'));
    await screen.findByTestId('Search-results');
  });

  it('says the phone is offline instead of "not working"', async () => {
    renderSearch({ search: 'offline' });
    await type('karahi');
    await screen.findByTestId('Search-offline');
    expect(screen.queryByTestId('Search-error')).toBeNull();
  });
});
