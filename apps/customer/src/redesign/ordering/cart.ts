/**
 * Cart, quote and active-order calls for the redesign (manifest D9, C1), through the redesign API
 * client (`api/client.ts`), so a 403 from any of them raises the forced routes.
 *
 * Every mutation is server-authoritative (C-19): each returns the full recomputed `Cart` and the
 * screens render that, never a local guess. The write DTOs carry ids, quantities and notes only:
 * there is no price field to send (G-3). `addCartLine` and `createQuote` require an
 * Idempotency-Key; the caller owns the key so a retry of the same attempt reuses it.
 */
import { unwrap } from '@hg/api-client';
import type { Schema } from '@hg/api-client';

import { api } from '../api/client';
import { getNow } from '../lib/now';

export type Cart = Schema['Cart'];
export type CartLine = Schema['CartLine'];
export type CartLineInput = Schema['CartLineInput'];
export type Quote = Schema['Quote'];
export type ActiveOrder = Schema['OrderCustomerView'];
export type Address = Schema['Address'];

export async function getCart(): Promise<Cart> {
  const body = await unwrap(api.GET('/v1/cart'));
  return body.data as unknown as Cart;
}

/**
 * `addCartLine`. `replace: true` is "Start a new cart" after `409 DIFFERENT_RESTAURANT`: the server
 * clears the old cart and adds this line in one transaction, so a failed add can never leave the
 * customer with an empty cart (C-20 rule 2). Never clear-then-add.
 */
export async function addCartLine(line: CartLineInput, opts: { idempotencyKey: string; replace?: boolean }): Promise<Cart> {
  const body = await unwrap(
    api.POST('/v1/cart/lines', {
      params: {
        header: { 'Idempotency-Key': opts.idempotencyKey },
        query: opts.replace ? { replace: true } : undefined,
      },
      body: line,
    }),
  );
  return body.data as unknown as Cart;
}

/** `updateCartLine`: quantity 1–20 only. Removal is `removeCartLine`, never quantity 0. */
export async function setLineQuantity(lineId: string, quantity: number): Promise<Cart> {
  const body = await unwrap(api.PATCH('/v1/cart/lines/{lineId}', { params: { path: { lineId } }, body: { quantity } }));
  return body.data as unknown as Cart;
}

export async function removeLine(lineId: string): Promise<Cart> {
  const body = await unwrap(api.DELETE('/v1/cart/lines/{lineId}', { params: { path: { lineId } } }));
  return body.data as unknown as Cart;
}

/** `clearCart` answers 204; the (now empty) cart is re-read so callers get a `Cart` back. */
export async function clearCart(): Promise<Cart> {
  await unwrap(api.DELETE('/v1/cart'));
  return getCart();
}

/**
 * Prices the cart for its delivery address, exactly as checkout will (C-22 AC1). The request
 * carries the cart, the address, the fulfilment mode and no tip (the tip is chosen at checkout):
 * never a price, a promo code or a schedule.
 */
export async function createCartQuote(cart: Cart, addressId: string, idempotencyKey: string): Promise<Quote> {
  const body = await unwrap(
    api.POST('/v1/quotes', {
      params: { header: { 'Idempotency-Key': idempotencyKey } },
      body: { cart_id: cart.id, fulfilment: 'DELIVERY', delivery_address_id: addressId, tip_cents: 0 as Schema['Cents'] },
    }),
  );
  return body.data as unknown as Quote;
}

/**
 * Re-reads a persisted quote. The contract's 200 schema for `getQuote` declares an `OrderSummary`
 * list (a contract defect, filed as a W0 request); the server and the fixtures return the `Quote`.
 */
export async function readQuote(quoteId: string): Promise<Quote> {
  const body = await unwrap(api.GET('/v1/quotes/{quoteId}', { params: { path: { quoteId } } }));
  return (body as unknown as { data: Quote }).data;
}

/** Saved addresses, to name the one the cart is priced for ("Pricing your order for Home…"). */
export async function listAddresses(): Promise<Address[]> {
  const body = await unwrap(api.GET('/v1/addresses'));
  return Array.isArray(body.data) ? (body.data as unknown as Address[]) : [];
}

export async function getActiveOrder(): Promise<ActiveOrder | null> {
  const body = await unwrap(api.GET('/v1/orders/active'));
  return (body.data as unknown as ActiveOrder | null) ?? null;
}

/* ----------------------------------------------------------- session memory */

/**
 * The last cart and quote this session saw, in memory only: the offline cart reads from it
 * ("Showing your cart as of 6:42 pm"), and an unexpired quote for the same cart is re-read with
 * `getQuote` rather than priced again. Nothing here is persisted to disk.
 */
interface Remembered {
  cart: Cart | null;
  cartAsOf: number | null;
  quote: { key: string; quote: Quote } | null;
}

const memory: Remembered = { cart: null, cartAsOf: null, quote: null };

export function rememberCart(cart: Cart, asOf: number = getNow()): void {
  memory.cart = cart;
  memory.cartAsOf = asOf;
}

export function rememberedCart(): { cart: Cart; asOf: number } | null {
  return memory.cart && memory.cartAsOf != null ? { cart: memory.cart, asOf: memory.cartAsOf } : null;
}

/**
 * What a quote is for: the cart, its lines and quantities, and the address. A different key means
 * a different pricing attempt (and a new Idempotency-Key); the same key is a retry.
 */
export function quoteKeyFor(cart: Cart, addressId: string): string {
  const lines = cart.lines.map((l) => `${l.id}x${l.quantity}`).join(',');
  return `${cart.id}|${addressId}|${lines}`;
}

export function rememberQuote(key: string, quote: Quote): void {
  memory.quote = { key, quote };
}

/** The remembered quote for this cart and address, while the server says it has not expired. */
export function rememberedQuote(key: string, now: number = getNow()): Quote | null {
  const q = memory.quote;
  if (!q || q.key !== key) return null;
  const expires = Date.parse(q.quote.expires_at);
  return Number.isFinite(expires) && expires > now ? q.quote : null;
}

/** Tests only. */
export function resetCartMemory(): void {
  memory.cart = null;
  memory.cartAsOf = null;
  memory.quote = null;
}
