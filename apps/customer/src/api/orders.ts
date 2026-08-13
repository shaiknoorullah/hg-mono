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
 * Note on the mock: `createOrder` has no registered fixture in `tools/mock-server`, so against
 * the mock the POST resolves to `INTERNAL_ERROR`. The checkout screen treats that specific case
 * as the known mock gap and recovers the order to track from `getActiveOrder`, which *is* served
 * from a real fixture — so the flow stays demoable end-to-end against real data while still
 * issuing the real `POST /v1/orders`.
 */
import { idempotencyKey, unwrap } from '@hg/api-client';
import type { Schema } from '@hg/api-client';

import { api } from './client';

export type Quote = Schema['Quote'];
export type Fulfilment = Schema['Fulfilment'];
export type OrderCreated = Schema['OrderCreated'];
export type OrderCustomerView = Schema['OrderCustomerView'];

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
