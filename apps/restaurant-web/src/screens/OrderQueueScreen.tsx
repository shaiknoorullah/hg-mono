/**
 * The one smoke screen: the restaurant's live order queue.
 *
 * On mount it calls the single real GET the mock serves for this surface —
 * `listRestaurantOrders` (`GET /v1/restaurant/orders`, contract §R-23) — and renders the
 * `OrderRestaurantView[]` projection with `@hg/ui-web`'s `DataTable`. The table owns the
 * loading, empty and error states; this screen only wires the fetch to them.
 *
 * The customer phone is a masked projection field. It is declared as a `pii` column but no
 * `onRevealPii` handler is passed, so the value can never be unmasked here — exactly the
 * DataTable contract for a surface with no audited reveal path.
 */
import { useCallback, useEffect, useState } from 'react';
import type { operations } from '@hg/api-client';
import {
  DataTable,
  Price,
  ORDER_STATE_LABELS,
  formatAbsoluteTime,
  type DataTableColumn,
  type DataTableError,
  type PageMeta,
} from '@hg/ui-web';

import { api } from '../lib/api';

/**
 * The row type comes off the `listRestaurantOrders` 200 body. This is the contract shape,
 * with the branded `Cents` fields intact, which is what the columns want to render.
 *
 * `openapi-fetch` re-maps the response through its own generics on the way out of
 * `api.GET`, which prints the `Cents` brand structurally rather than nominally. The two
 * describe the same bytes, so the assignment at the fetch boundary is cast once, with this
 * note, rather than smeared across every cell.
 */
type ListResponse =
  operations['listRestaurantOrders']['responses']['200']['content']['application/json'];
type Order = ListResponse['data'][number];

interface QueueState {
  status: 'loading' | 'ready' | 'error';
  orders: readonly Order[];
  meta: PageMeta | null;
  error: DataTableError | null;
}

const INITIAL: QueueState = { status: 'loading', orders: [], meta: null, error: null };

const columns: readonly DataTableColumn<Order>[] = [
  {
    key: 'code',
    header: 'Order',
    contentClass: 'id',
    width: '9rem',
    cell: (order) => order.code,
    textValue: (order) => order.code,
  },
  {
    key: 'state',
    header: 'State',
    contentClass: 'enum',
    width: '11rem',
    cell: (order) => ORDER_STATE_LABELS[order.state] ?? order.state,
    textValue: (order) => ORDER_STATE_LABELS[order.state] ?? order.state,
  },
  {
    key: 'customer',
    header: 'Customer',
    width: '12rem',
    cell: (order) => order.customer.display_name,
    textValue: (order) => order.customer.display_name,
  },
  {
    key: 'phone',
    header: 'Phone',
    width: '12rem',
    // A masked projection field. No `onRevealPii` is wired, so it stays masked forever.
    pii: { field: 'customer_phone', noun: "the customer's phone number" },
    cell: (order) => order.customer.phone_masked,
    textValue: (order) => order.customer.phone_masked ?? '',
  },
  {
    key: 'items',
    header: 'Items',
    contentClass: 'numeric',
    align: 'end',
    width: '6rem',
    cell: (order) => order.lines.reduce((sum, line) => sum + line.quantity, 0),
    textValue: (order) =>
      String(order.lines.reduce((sum, line) => sum + line.quantity, 0)),
  },
  {
    key: 'area',
    header: 'Deliver to',
    cell: (order) => order.delivery_area ?? '—',
    textValue: (order) => order.delivery_area ?? '',
  },
  {
    key: 'placed',
    header: 'Placed',
    contentClass: 'date',
    width: '8rem',
    cell: (order) => formatAbsoluteTime(order.placed_at) ?? '—',
    textValue: (order) => order.placed_at,
  },
  {
    key: 'total',
    header: 'Total',
    contentClass: 'money',
    align: 'end',
    width: '8rem',
    // `Price` is the only component permitted to render money; `total_cents` is already
    // the branded `Cents` type off the generated client.
    cell: (order) => <Price cents={order.money.total_cents} size="sm" />,
  },
];

export function OrderQueueScreen() {
  const [state, setState] = useState<QueueState>(INITIAL);

  const load = useCallback(async () => {
    setState((prev) => ({ ...prev, status: 'loading', error: null }));
    try {
      const { data, error, response } = await api.GET('/v1/restaurant/orders', {
        params: { query: { limit: 25 } },
      });
      if (error || !data) {
        setState({
          status: 'error',
          orders: [],
          meta: null,
          error: {
            code: error?.error?.code,
            message: error?.error?.message ?? `HTTP ${response.status}`,
            requestId: error?.error?.request_id ?? null,
            onRetry: () => void load(),
          },
        });
        return;
      }
      // Same bytes, structurally-vs-nominally printed `Cents` brand — see the note on `Order`.
      const rows = data.data as unknown as readonly Order[];
      // De-duplicate by id: a keyset page should never carry the same order twice, and one
      // of the mock's queue scenarios deliberately repeats ids to exercise exactly this.
      const distinct = rows.filter(
        (order, index) => rows.findIndex((candidate) => candidate.id === order.id) === index,
      );
      setState({
        status: 'ready',
        orders: distinct,
        meta: data.meta,
        error: null,
      });
    } catch (cause) {
      setState({
        status: 'error',
        orders: [],
        meta: null,
        error: {
          message: cause instanceof Error ? cause.message : 'Network request failed',
          onRetry: () => void load(),
        },
      });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <DataTable
      id="order-queue"
      caption="Incoming orders"
      captionVisible
      density="compact"
      stickyHeader
      columns={columns}
      rows={state.orders}
      getRowId={(order) => order.id}
      getRowLabel={(order) => `order ${order.code}`}
      loading={state.status === 'loading'}
      error={state.error}
      entityPlural="orders"
      drained={{ queueName: 'the order queue' }}
    />
  );
}
