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
import { idempotencyKey, unwrap } from '@hg/api-client';
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
 * so a since-removed item fails independently rather than aborting the whole reorder. Add-ons
 * and special requests are not replayed — the contract's `addCartLine` takes a bare
 * `menu_item_id` + `quantity`, so a reorder restores the base items only.
 */
export async function reorder(orderId: string): Promise<{ failedLines: string[] }> {
  const order = await getOrder(orderId);
  const failedLines: string[] = [];
  for (const line of order.lines) {
    try {
      await addToCart(line.menu_item_id, line.quantity);
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
