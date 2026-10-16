/**
 * Checkout's calls, through the redesign client (so a session or account refusal raises its forced
 * route from here too).
 *
 * What the client may send is exactly what the contract's request bodies allow, and no more:
 * `createQuote` takes the cart, the address, the fulfilment mode and the tip. `createOrder` takes the
 * quote's id, a saved payment method and the delivery notes. Neither has a field for a price, a
 * total, a fee, a tax or a discount, and this file has no parameter that could fill one. The
 * [server prices every order](https://github.com/shaiknoorullah/hg-mono/blob/main/AGENTS.md#3-non-negotiable-invariants):
 * every amount the screen shows is read back from the quote or the order the server returns.
 *
 * Every write that moves money requires an Idempotency-Key. The caller owns the key, so the same
 * attempt, resent after a dropped connection, reuses it and can never place a second order.
 */
import { unwrap } from '@hg/api-client';
import type { Cents, Schema } from '@hg/api-client';

import { api } from '../api/client';
import type { Cart } from '../ordering/cart';

export type Quote = Schema['Quote'];
export type OrderCreated = Schema['OrderCreated'];
export type Order = Schema['OrderCustomerView'];
export type OrderLine = Schema['OrderLine'];
export type OrderPayment = Schema['OrderPayment'];
export type PaymentMethod = Schema['PaymentMethod'];
export type DeliveryInstruction = Schema['DeliveryInstruction'];
export type CancellationReason = Schema['CustomerCancellationReasonCode'];

/**
 * Prices the cart for an address with the customer's tip. The tip is the one monetary value the
 * customer chooses; everything else in the answer is the server's.
 */
export async function createCheckoutQuote(input: {
  cart: Cart;
  addressId: string;
  tip: Cents;
  idempotencyKey: string;
}): Promise<Quote> {
  const body = await unwrap(
    api.POST('/v1/quotes', {
      params: { header: { 'Idempotency-Key': input.idempotencyKey } },
      body: {
        cart_id: input.cart.id,
        fulfilment: 'DELIVERY',
        delivery_address_id: input.addressId,
        tip_cents: input.tip,
      },
    }),
  );
  return body.data as unknown as Quote;
}

/** Places the order from a quote id. There is no amount on this body. */
export async function createCheckoutOrder(input: {
  quoteId: string;
  /** A saved card; omit to pay in Stripe's own sheet (a new card or a wallet). */
  paymentMethodId: string | null;
  instructions: DeliveryInstruction[];
  note: string;
  idempotencyKey: string;
}): Promise<OrderCreated> {
  const note = input.note.trim();
  const body = await unwrap(
    api.POST('/v1/orders', {
      params: { header: { 'Idempotency-Key': input.idempotencyKey } },
      body: {
        quote_id: input.quoteId,
        save_payment_method: false,
        ...(input.paymentMethodId ? { payment_method_id: input.paymentMethodId } : {}),
        ...(input.instructions.length ? { delivery_instructions: input.instructions } : {}),
        ...(note ? { special_instructions: note } : {}),
      },
    }),
  );
  return body.data as unknown as OrderCreated;
}

export async function readOrder(orderId: string): Promise<Order> {
  const body = await unwrap(api.GET('/v1/orders/{orderId}', { params: { path: { orderId } } }));
  return body.data as unknown as Order;
}

/** The order's payment state; re-issues the `client_secret` while the intent still needs an action. */
export async function readPayment(orderId: string): Promise<OrderPayment> {
  const body = await unwrap(api.GET('/v1/orders/{orderId}/payment', { params: { path: { orderId } } }));
  return body.data as unknown as OrderPayment;
}

/** Saved cards: display fields only (brand, last four, expiry). */
export async function listSavedCards(): Promise<PaymentMethod[]> {
  const body = await unwrap(api.GET('/v1/payment-methods'));
  return Array.isArray(body.data) ? (body.data as unknown as PaymentMethod[]) : [];
}

/** Free while the order is unpaid: the authorisation is voided, so there is no refund to fail. */
export async function cancelCheckoutOrder(input: {
  orderId: string;
  reason: CancellationReason;
  note: string | null;
  idempotencyKey: string;
}): Promise<Order> {
  const body = await unwrap(
    api.POST('/v1/orders/{orderId}/cancel', {
      params: { path: { orderId: input.orderId }, header: { 'Idempotency-Key': input.idempotencyKey } },
      body: { reason_code: input.reason, ...(input.note ? { note: input.note } : {}) },
    }),
  );
  return body.data as unknown as Order;
}
