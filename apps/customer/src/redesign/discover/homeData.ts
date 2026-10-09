/**
 * Home's data (D1): the delivery address, the two rows and the list.
 *
 * - Address: `listAddresses` (+ `getCustomerProfile` for its `default_address_id`), resolved
 *   through the session's switcher choice (`deliveryAddress.ts`).
 * - Rows: `listRestaurants` with `open_now=true` and `sort=DISTANCE_ASC` ("Open now, closest
 *   first") and `sort=ETA_ASC` ("Quickest delivery"), first page only. A row that fails or comes
 *   back empty is omitted (never an empty shell); with no address there are no rows (nothing to
 *   measure from).
 * - List: `listRestaurants` with the default sort, first page, for the chosen address.
 *
 * The last good feed is kept in memory with the time it was fetched, so Home can show it offline
 * ("Showing restaurants as of 6:42 pm") under the 15-minute halal rule.
 */
import { unwrap, type operations, type Schema } from '@hg/api-client';

import { api } from '../api/client';
import { getNow } from '../lib/now';
import { resolveDeliveryAddress } from './deliveryAddress';
import type { Address, RestaurantCard } from './format';

type ListQuery = NonNullable<operations['listRestaurants']['parameters']['query']>;
type Sort = Schema['RestaurantSort'];

export const ROW_LIMIT = 10;
export const LIST_LIMIT = 20;

export interface Restaurants {
  /** Null when the row failed, came back empty or was not asked for: the row is then absent. */
  closest: RestaurantCard[] | null;
  quickest: RestaurantCard[] | null;
  all: RestaurantCard[];
  /** More restaurants than the first page: "See all restaurants" opens Browse. */
  hasMore: boolean;
}

export interface HomeFeed extends Restaurants {
  addresses: Address[];
  address: Address | null;
}

export async function loadAddresses(chosen?: string | null): Promise<{ addresses: Address[]; address: Address | null }> {
  const [list, profile] = await Promise.all([
    unwrap(api.GET('/v1/addresses', { params: { query: { limit: 50 } } })),
    // The profile only breaks a tie when no address is marked default; its failure is not Home's.
    unwrap(api.GET('/v1/me/profile')).catch(() => null),
  ]);
  const addresses = (list.data ?? []) as Address[];
  return { addresses, address: resolveDeliveryAddress(addresses, profile?.data.default_address_id, chosen) };
}

async function list(query: ListQuery): Promise<{ data: RestaurantCard[]; hasMore: boolean }> {
  const body = await unwrap(api.GET('/v1/restaurants', { params: { query } }));
  return { data: (body.data ?? []) as RestaurantCard[], hasMore: Boolean(body.meta?.has_more) };
}

async function row(addressId: string, sort: Sort): Promise<RestaurantCard[] | null> {
  try {
    const r = await list({ delivery_address_id: addressId, open_now: true, sort, limit: ROW_LIMIT });
    return r.data.length > 0 ? r.data : null;
  } catch {
    return null;
  }
}

/** The three `listRestaurants` calls for one address (or none). Only the list's failure throws. */
export async function loadRestaurants(address: Address | null): Promise<Restaurants> {
  const base: ListQuery = address ? { delivery_address_id: address.id } : {};
  const [all, closest, quickest] = await Promise.all([
    list({ ...base, limit: LIST_LIMIT }),
    address ? row(address.id, 'DISTANCE_ASC') : Promise.resolve(null),
    address ? row(address.id, 'ETA_ASC') : Promise.resolve(null),
  ]);
  return { all: all.data, hasMore: all.hasMore, closest, quickest };
}

export async function loadHomeFeed(chosen?: string | null): Promise<HomeFeed> {
  const { addresses, address } = await loadAddresses(chosen);
  const restaurants = await loadRestaurants(address);
  return { addresses, address, ...restaurants };
}

/* ------------------------------------------------------------------ cache */

let cache: { feed: HomeFeed; asOf: number } | null = null;

export function cachedFeed(): { feed: HomeFeed; asOf: number } | null {
  return cache;
}

export function rememberFeed(feed: HomeFeed, asOf: number = getNow()): void {
  cache = { feed, asOf };
}

/** Tests only. */
export function resetHomeCache(): void {
  cache = null;
}
