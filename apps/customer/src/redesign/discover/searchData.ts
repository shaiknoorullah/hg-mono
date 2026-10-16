/**
 * Search's data: `search` for the typed words, the two result groups each on their own cursor, and
 * the recent searches kept on this phone.
 *
 * - The contract takes `q` of 1-128 characters; the client starts at 2 (fewer is noise) and says
 *   so, rather than showing a result list for one letter.
 * - `search` has no `delivery_address_id`: distance and ETA come from the chosen address's
 *   latitude and longitude, so they can differ from `listRestaurants` for the same address
 *   (a contract gap, https://github.com/shaiknoorullah/hg-mono/issues/931). With no address nothing is sent and rows carry no distance.
 * - Recent searches are in memory for the session: the app has no storage dependency yet, so they
 *   are gone at the next launch (a gap, https://github.com/shaiknoorullah/hg-mono/issues/932) and dropped at sign-out.
 */
import { unwrap, type Schema } from '@hg/api-client';

import { isAuthed, subscribe as subscribeToken } from '../../api/token';
import { api } from '../api/client';
import type { Address, RestaurantCard } from './format';

export type DishResult = Schema['DishResult'];

export const MIN_QUERY_LENGTH = 2;
export const MAX_QUERY_LENGTH = 128;
export const SEARCH_LIMIT = 10;

/** The trimmed query, or null when it is too short to search. */
export function searchableQuery(raw: string): string | null {
  const q = raw.trim().replace(/\s+/g, ' ').slice(0, MAX_QUERY_LENGTH);
  return q.length >= MIN_QUERY_LENGTH ? q : null;
}

export interface Group<T> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
}

export async function runSearch(args: {
  q: string;
  address: Address | null;
  restaurantsCursor?: string | null;
  dishesCursor?: string | null;
}): Promise<{ restaurants: Group<RestaurantCard>; dishes: Group<DishResult> }> {
  const { q, address, restaurantsCursor, dishesCursor } = args;
  const body = await unwrap(
    api.GET('/v1/search', {
      params: {
        query: {
          q,
          limit: SEARCH_LIMIT,
          ...(address ? { latitude: address.latitude, longitude: address.longitude } : {}),
          ...(restaurantsCursor ? { restaurants_cursor: restaurantsCursor } : {}),
          ...(dishesCursor ? { dishes_cursor: dishesCursor } : {}),
        },
      },
    }),
  );
  return {
    restaurants: {
      items: (body.data?.restaurants ?? []) as RestaurantCard[],
      nextCursor: body.meta?.restaurants?.next_cursor ?? null,
      hasMore: Boolean(body.meta?.restaurants?.has_more),
    },
    dishes: {
      items: (body.data?.dishes ?? []) as DishResult[],
      nextCursor: body.meta?.dishes?.next_cursor ?? null,
      hasMore: Boolean(body.meta?.dishes?.has_more),
    },
  };
}

/* ------------------------------------------------------------ recent searches */

const MAX_RECENT = 8;
let recent: string[] = [];
const listeners = new Set<() => void>();

function emit(next: string[]): void {
  recent = next;
  for (const fn of listeners) fn();
}

export function getRecent(): readonly string[] {
  return recent;
}

/** Newest first, no duplicates (case-insensitive), at most eight. */
export function rememberSearch(q: string): void {
  const key = q.toLowerCase();
  emit([q, ...recent.filter((r) => r.toLowerCase() !== key)].slice(0, MAX_RECENT));
}

export function clearRecent(): void {
  if (recent.length) emit([]);
}

export function subscribeRecent(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

subscribeToken(() => {
  if (!isAuthed()) clearRecent();
});
