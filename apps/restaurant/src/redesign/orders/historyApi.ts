/**
 * The two reads Past orders makes: one cursor page of `listRestaurantOrders` for a chip, and
 * `getRestaurantOrder` for the panel. Every figure comes straight off the wire.
 */
import { unwrap } from '@hg/api-client';
import { client } from '../data/client';
import { guardHistoryRows, statesFor, type HistoryFilter } from './history';
import type { Order } from './model';

export const HISTORY_PAGE_SIZE = 20;

export interface HistoryPageResult {
  rows: Order[];
  nextCursor: string | null;
  hasMore: boolean;
}

/**
 * `listRestaurantOrders` with the chip's `state` filter (#601: sent AND guarded) and a cursor.
 * Throws `HgApiError` on a failure.
 */
export async function loadHistoryPage(filter: HistoryFilter, cursor: string | null): Promise<HistoryPageResult> {
  const envelope = await unwrap(
    client.GET('/v1/restaurant/orders', {
      params: { query: { state: statesFor(filter), limit: HISTORY_PAGE_SIZE, ...(cursor ? { cursor } : {}) } },
      // The contract declares `style: form, explode: false`: state=DELIVERED,COMPLETED,…
      querySerializer: { array: { style: 'form', explode: false } },
    }),
  );
  const meta = (envelope as { meta?: { next_cursor?: string | null; has_more?: boolean } }).meta;
  return {
    rows: guardHistoryRows(envelope.data as unknown as Order[], filter),
    nextCursor: meta?.next_cursor ?? null,
    hasMore: Boolean(meta?.has_more),
  };
}

/** `getRestaurantOrder` for the panel. */
export async function loadPastOrder(id: string): Promise<Order> {
  const envelope = await unwrap(client.GET('/v1/restaurant/orders/{orderId}', { params: { path: { orderId: id } } }));
  return envelope.data as unknown as Order;
}
