/**
 * The reads Orders (T9) and Receipt (T10) make, through the redesign API client.
 *
 * Ported from #639 (`apps/customer/src/api/orders.ts`: `listOrders`, `getOrderReceipt`,
 * `isReceiptNotReady`), keeping only reads. The `reorder()` helper is deliberately not ported:
 * reorder is a later release (manifest T9, "Excluded"), so nothing here can put a past order back
 * in the cart. Every call here is a GET; none carries money.
 */
import { isApiError, unwrap, type Schema } from '@hg/api-client';

import { api } from '../api/client';

export type OrderSummary = Schema['OrderSummary'];
export type OrderStatusGroup = Schema['OrderStatusGroup'];
export type Receipt = Schema['Receipt'];
export type OrderPayment = Schema['OrderPayment'];
export type OrderTracking = Schema['OrderTracking'];
export type OrderCustomerView = Schema['OrderCustomerView'];
export type Refund = Schema['Refund'];

export const ORDERS_PAGE_SIZE = 20;

export interface OrdersPage {
  orders: OrderSummary[];
  /** Null at the end of the collection. */
  nextCursor: string | null;
}

/** `GET /v1/orders?status_group=…`, keyset-paged by `meta.next_cursor` (never an offset). */
export async function listOrdersPage(group: OrderStatusGroup, cursor?: string | null): Promise<OrdersPage> {
  const body = await unwrap(
    api.GET('/v1/orders', {
      params: {
        query: {
          status_group: group,
          limit: ORDERS_PAGE_SIZE,
          ...(cursor ? { cursor } : {}),
        },
      },
    }),
  );
  const data = (body as { data?: unknown }).data;
  const meta = (body as { meta?: { next_cursor?: string | null; has_more?: boolean } }).meta;
  return {
    orders: Array.isArray(data) ? (data as OrderSummary[]) : [],
    nextCursor: meta?.has_more === false ? null : meta?.next_cursor ?? null,
  };
}

/** The live card's ETA (`eta_at`, `eta_window_minutes`) for an active order. */
export async function getOrderTracking(orderId: string): Promise<OrderTracking> {
  const body = await unwrap(api.GET('/v1/orders/{orderId}/tracking', { params: { path: { orderId } } }));
  return body.data as unknown as OrderTracking;
}

/** The receipt, read from the frozen snapshot written once at COMPLETED. */
export async function getOrderReceipt(orderId: string): Promise<Receipt> {
  const body = await unwrap(api.GET('/v1/orders/{orderId}/receipt', { params: { path: { orderId } } }));
  return body.data as unknown as Receipt;
}

export async function getOrderPayment(orderId: string): Promise<OrderPayment> {
  const body = await unwrap(api.GET('/v1/orders/{orderId}/payment', { params: { path: { orderId } } }));
  return body.data as unknown as OrderPayment;
}

export async function getOrder(orderId: string): Promise<OrderCustomerView> {
  const body = await unwrap(api.GET('/v1/orders/{orderId}', { params: { path: { orderId } } }));
  return body.data as unknown as OrderCustomerView;
}

/** `GET /v1/refunds?order_id=…`: the refunds on one order, newest state from the server. */
export async function listOrderRefunds(orderId: string): Promise<Refund[]> {
  const body = await unwrap(api.GET('/v1/refunds', { params: { query: { order_id: orderId, limit: 50 } } }));
  const data = (body as { data?: unknown }).data;
  if (Array.isArray(data)) return data as Refund[];
  // A single object is not a list; treat it as one refund rather than dropping it.
  return data && typeof data === 'object' ? [data as Refund] : [];
}

/** Typed against the contract's `ErrorCode`, so the build breaks if the contract drops it. */
const RECEIPT_NOT_READY: Schema['ErrorCode'] = 'RECEIPT_NOT_READY';

/**
 * True when the receipt does not exist (`409 RECEIPT_NOT_READY`): the order has not completed, or
 * never will. Any other error, a 404 included, is a real error.
 */
export function isNoReceipt(e: unknown): boolean {
  if (!isApiError(e)) return false;
  if (e.status === 409 && e.code === RECEIPT_NOT_READY) return true;
  return false;
}
