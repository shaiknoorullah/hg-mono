/**
 * Quote and order writes, plus the two order reads tracking depends on.
 *
 * Checkout is two calls, in order (P-09):
 *   POST /v1/quotes  → the server prices the cart; the client displays exactly this quote and
 *                      never computes a total itself (G-1/G-3).
 *   POST /v1/orders  → placed with the `quote_id` **only**; there is no amount on the DTO. The
 *                      server re-prices and compares, so a stale quote is rejected, not charged.
 *
 * Both writes are idempotent and require an `Idempotency-Key`.
 *
 * The response carries the Stripe PaymentIntent `client_secret`; the checkout screen confirms it
 * with the payment sheet (src/payments). The intent is manual-capture: confirming authorises,
 * the server captures when the restaurant accepts.
 */
import { idempotencyKey, isApiError, unwrap } from '@hg/api-client';
import type { Schema } from '@hg/api-client';

import { api } from './client';
import { addToCart } from './cart';

export type Quote = Schema['Quote'];
export type Fulfilment = Schema['Fulfilment'];
export type OrderCreated = Schema['OrderCreated'];
export type OrderCustomerView = Schema['OrderCustomerView'];
export type OrderSummary = Schema['OrderSummary'];
export type OrderStatusGroup = Schema['OrderStatusGroup'];
export type PageMeta = Schema['PageMeta'];
export type Receipt = Schema['Receipt'];

export async function createQuote(input: {
  cartId: string;
  fulfilment: Fulfilment;
  deliveryAddressId?: string | null;
}): Promise<Quote> {
  const body = await unwrap(
    api.POST('/v1/quotes', {
      params: { header: { 'Idempotency-Key': idempotencyKey() } },
      body: {
        cart_id: input.cartId,
        fulfilment: input.fulfilment,
        delivery_address_id: input.deliveryAddressId ?? null,
      },
    }),
  );
  return body.data as unknown as Quote;
}

export async function placeOrder(quoteId: string): Promise<OrderCreated> {
  const body = await unwrap(
    api.POST('/v1/orders', {
      params: { header: { 'Idempotency-Key': idempotencyKey() } },
      body: { quote_id: quoteId, save_payment_method: false },
    }),
  );
  return body.data as unknown as OrderCreated;
}

/**
 * The order's payment state. `client_secret` is re-issued here only while the intent still needs
 * an action, which is how a customer retries payment for an order that already exists.
 */
export async function getOrderPayment(
  orderId: string,
): Promise<Schema['OrderPayment']> {
  const body = await unwrap(
    api.GET('/v1/orders/{orderId}/payment', { params: { path: { orderId } } }),
  );
  return body.data as unknown as Schema['OrderPayment'];
}

export async function getActiveOrder(): Promise<OrderCustomerView | null> {
  const body = await unwrap(api.GET('/v1/orders/active'));
  // The active-order endpoint returns `{ data: null }` when there is none.
  return (body.data as unknown as OrderCustomerView | null) ?? null;
}

export async function getOrder(orderId: string): Promise<OrderCustomerView> {
  const body = await unwrap(
    api.GET('/v1/orders/{orderId}', { params: { path: { orderId } } }),
  );
  return body.data as unknown as OrderCustomerView;
}

/**
 * The order's receipt (P-10 / C-27), read from the snapshot the server writes once at
 * `COMPLETED`. Until then the server answers `409 RECEIPT_NOT_READY`, which `isReceiptNotReady`
 * recognises.
 */
export async function getOrderReceipt(orderId: string): Promise<Receipt> {
  const body = await unwrap(
    api.GET('/v1/orders/{orderId}/receipt', { params: { path: { orderId } } }),
  );
  return body.data as unknown as Receipt;
}

/** Typed against the contract's `ErrorCode`, so the build breaks if the contract drops it. */
const RECEIPT_NOT_READY: Schema['ErrorCode'] = 'RECEIPT_NOT_READY';

/**
 * True for the receipt's `409 RECEIPT_NOT_READY`: the order has not reached `COMPLETED`, so it
 * has no receipt yet. Any other 409 is a real error, not "not ready".
 */
export function isReceiptNotReady(e: unknown): boolean {
  return isApiError(e) && e.status === 409 && e.code === RECEIPT_NOT_READY;
}

export type OrderCancellationInput = Schema['OrderCancellationInput'];
export type CustomerCancellationReasonCode = Schema['CustomerCancellationReasonCode'];

/**
 * Free cancellation before the restaurant accepts (customer cancellation, docs/spec/02-customer.md
 * "C-29 — Order cancellation by the customer"): the server voids the card authorisation, so
 * nothing was charged. The caller owns the `Idempotency-Key` so a retry after a dropped response
 * replays the same request rather than starting a new one. A restaurant that accepted first
 * answers `409 CANCELLATION_WINDOW_CLOSED`.
 */
export async function cancelOrder(
  orderId: string,
  input: OrderCancellationInput,
  key: string,
): Promise<OrderCustomerView> {
  const body = await unwrap(
    api.POST('/v1/orders/{orderId}/cancel', {
      params: { path: { orderId }, header: { 'Idempotency-Key': key } },
      body: input,
    }),
  );
  return body.data as unknown as OrderCustomerView;
}

/**
 * The customer's order history (C-26 adjacent). `status_group` narrows to `ACTIVE` or `PAST`;
 * omitted, the mock's default fixture serves a mixed page. Keyset-paged via `meta.next_cursor` —
 * never an offset — per `Cursor` in the contract.
 */
export async function listOrders(input?: {
  statusGroup?: OrderStatusGroup;
  cursor?: string | null;
}): Promise<{ orders: OrderSummary[]; meta: PageMeta }> {
  const body = await unwrap(
    api.GET('/v1/orders', {
      params: {
        query: {
          limit: 20,
          ...(input?.cursor ? { cursor: input.cursor } : {}),
          ...(input?.statusGroup ? { status_group: input.statusGroup } : {}),
        },
      },
    }),
  );
  return {
    orders: body.data as unknown as OrderSummary[],
    meta: body.meta as unknown as PageMeta,
  };
}

/**
 * One-tap reorder (no dedicated endpoint in the contract): re-adds every line of a past order
 * to the cart via the same `POST /v1/cart/lines` the restaurant screen uses, one call per line
 * so a since-removed item fails independently rather than aborting the whole reorder. Each line
 * replays its chosen variants (one per group, `variant_ids`) and add-ons by id, since the server
 * refuses a line that misses a required choice; special requests are not replayed. No price is
 * sent: the server prices the re-added lines from today's menu.
 */
export async function reorder(orderId: string): Promise<{ failedLines: string[] }> {
  const order = await getOrder(orderId);
  const failedLines: string[] = [];
  for (const line of order.lines) {
    try {
      await addToCart({
        menu_item_id: line.menu_item_id,
        quantity: line.quantity,
        variant_ids: (line.variants ?? []).map((v) => v.variant_id),
        addons: (line.addons ?? []).map((a) => ({ addon_id: a.addon_id, quantity: a.addon_quantity })),
      });
    } catch {
      failedLines.push(line.name);
    }
  }
  return { failedLines };
}

export type OrderTracking = Schema['OrderTracking'];

/** `GET /v1/orders/{orderId}/tracking` — the REST twin of the socket's tracking projection. */
export async function getOrderTracking(orderId: string): Promise<OrderTracking> {
  const body = await unwrap(
    api.GET('/v1/orders/{orderId}/tracking', { params: { path: { orderId } } }),
  );
  return body.data as unknown as OrderTracking;
}
