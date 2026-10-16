/**
 * Browse's data (the "All restaurants" list): `listRestaurants` with the customer's filters and
 * sort, one keyset page at a time.
 *
 * - The server prices, measures and decides who is listed. This file builds a query and passes the
 *   answer through: no distance, ETA, fee or halal state is derived on the device.
 * - Filters sent are the ones the contract has and the launch releases: open now, distance, price
 *   band and dietary. There is no minimum-rating filter (every restaurant would read "New" until
 *   ratings ship) and no cuisine filter (the contract returns no cuisine ids to pick from).
 * - Distance sort, ETA sort and the distance filter need an address; with none they are neither
 *   offered nor sent.
 * - The last good first page is kept in memory with the time it was fetched, so Browse can show it
 *   offline ("Showing restaurants as of 6:42 pm") under the 15-minute halal rule. It is dropped when
 *   the session ends.
 */
import { unwrap, type operations, type Schema } from '@hg/api-client';

import { isAuthed, subscribe as subscribeToken } from '../../api/token';
import { api } from '../api/client';
import { getNow } from '../lib/now';
import type { Address, RestaurantCard } from './format';

type ListQuery = NonNullable<operations['listRestaurants']['parameters']['query']>;
export type PriceBand = Schema['PriceBand'];
export type DietaryTag = Schema['DietaryTag'];

export const PAGE_LIMIT = 20;

/** The sorts Browse offers. `RATING_DESC` is left out until ratings ship. */
export type BrowseSort = 'RECOMMENDED' | 'ETA_ASC' | 'DISTANCE_ASC';

export const SORT_LABELS: Record<BrowseSort, string> = {
  RECOMMENDED: 'Recommended',
  ETA_ASC: 'Quickest delivery',
  DISTANCE_ASC: 'Closest first',
};

/** Which sorts make sense: ETA and distance are measured from an address. */
export function sortsFor(address: Address | null): BrowseSort[] {
  return address ? ['RECOMMENDED', 'ETA_ASC', 'DISTANCE_ASC'] : ['RECOMMENDED'];
}

/** The route's `sort` string, checked: anything Browse does not offer falls back to Recommended. */
export function parseSort(value: string | undefined): BrowseSort {
  return value === 'ETA_ASC' || value === 'DISTANCE_ASC' ? value : 'RECOMMENDED';
}

export interface BrowseFilters {
  openNow: boolean;
  /** Metres, within the contract's 500-20000 range; null is any distance. */
  maxDistanceM: number | null;
  priceBands: PriceBand[];
  dietary: DietaryTag[];
}

export const NO_FILTERS: BrowseFilters = { openNow: false, maxDistanceM: null, priceBands: [], dietary: [] };

/** The distances the sheet offers, in metres. */
export const DISTANCE_CHOICES = [1000, 2000, 5000, 10000, 20000] as const;

export const PRICE_BAND_LABELS: Record<PriceBand, string> = {
  $: 'Inexpensive',
  $$: 'Moderate',
  $$$: 'Expensive',
  $$$$: 'Very expensive',
};

/** Dietary choices. `HALAL_CERTIFIED` is never one: halal is shown only by the badge. */
export const DIETARY_CHOICES: { tag: DietaryTag; label: string }[] = [
  { tag: 'VEGETARIAN', label: 'Vegetarian' },
  { tag: 'VEGAN', label: 'Vegan' },
  { tag: 'GLUTEN_FREE', label: 'Gluten free' },
  { tag: 'DAIRY_FREE', label: 'Dairy free' },
  { tag: 'NUT_FREE', label: 'Nut free' },
];

export function distanceLabel(metres: number): string {
  return `Within ${metres / 1000} km`;
}

/** How many filters are on: open now, a distance, each price band, each dietary choice. */
export function filterCount(f: BrowseFilters): number {
  return (f.openNow ? 1 : 0) + (f.maxDistanceM != null ? 1 : 0) + f.priceBands.length + f.dietary.length;
}

/** Drops what an address-less customer cannot use (the distance filter). */
export function withoutAddressOnly(f: BrowseFilters): BrowseFilters {
  return { ...f, maxDistanceM: null };
}

export interface Page {
  data: RestaurantCard[];
  nextCursor: string | null;
  hasMore: boolean;
}

export async function loadPage(args: {
  address: Address | null;
  filters: BrowseFilters;
  sort: BrowseSort;
  cursor?: string | null;
}): Promise<Page> {
  const { address, filters, sort, cursor } = args;
  const query: ListQuery = { limit: PAGE_LIMIT };
  if (address) query.delivery_address_id = address.id;
  if (filters.openNow) query.open_now = true;
  if (address && filters.maxDistanceM != null) query.max_distance_m = filters.maxDistanceM;
  if (filters.priceBands.length) query.price_band = filters.priceBands;
  if (filters.dietary.length) query.dietary = filters.dietary;
  if (sort !== 'RECOMMENDED' && address) query.sort = sort;
  if (cursor) query.cursor = cursor;
  // The contract sends lists as one comma-separated value, not a repeated key.
  const body = await unwrap(
    api.GET('/v1/restaurants', { params: { query }, querySerializer: { array: { style: 'form', explode: false } } }),
  );
  return {
    data: (body.data ?? []) as RestaurantCard[],
    nextCursor: body.meta?.next_cursor ?? null,
    hasMore: Boolean(body.meta?.has_more),
  };
}

/* ------------------------------------------------------------------ cache */

let cache: { page: Page; asOf: number; key: string } | null = null;

/** A cached first page, only for the same address, filters and sort it was fetched for. */
export function cachedPage(key: string): { page: Page; asOf: number } | null {
  return cache && cache.key === key ? cache : null;
}

export function rememberPage(key: string, page: Page, asOf: number = getNow()): void {
  cache = { page, asOf, key };
}

export function resetBrowseCache(): void {
  cache = null;
}

export function cacheKey(address: Address | null, filters: BrowseFilters, sort: BrowseSort): string {
  return JSON.stringify([address?.id ?? null, filters, sort]);
}

// One customer's list: signing out drops it, so the next customer never sees it.
subscribeToken(() => {
  if (!isAuthed()) resetBrowseCache();
});
