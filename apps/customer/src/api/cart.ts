/**
 * Cart mutations, in one place, wired to the mock's `/v1/cart*` surface.
 *
 * Every mutation here is server-authoritative (C-19): each call returns the full recomputed
 * `Cart`, and the screens render *that*, never an optimistic guess. `addCartLine`, like every
 * money-mutating write in the contract, requires an `Idempotency-Key`; `idempotencyKey()` mints
 * one per call. The request DTOs carry item identifiers and quantities only — there is no price
 * field to send (G-3), which is the invariant the whole money model rests on.
 *
 * The `as unknown as Cart` at each boundary is the same single-widening the discovery screen and
 * the galleries do: `openapi-fetch` reconstructs the response as a structural mapped type, which
 * drops the nominal identity of the branded `Cents` fields. The shape is identical; the cast
 * re-brands it once, here, so no screen has to.
 */
import { idempotencyKey, unwrap } from '@hg/api-client';
import type { Schema } from '@hg/api-client';

import { api } from './client';

export type Cart = Schema['Cart'];

export async function getCart(): Promise<Cart> {
  const body = await unwrap(api.GET('/v1/cart'));
  return body.data as unknown as Cart;
}

export async function addToCart(menuItemId: string, quantity = 1): Promise<Cart> {
  const body = await unwrap(
    api.POST('/v1/cart/lines', {
      params: { header: { 'Idempotency-Key': idempotencyKey() } },
      body: { menu_item_id: menuItemId, quantity },
    }),
  );
  return body.data as unknown as Cart;
}

export async function setLineQuantity(lineId: string, quantity: number): Promise<Cart> {
  const body = await unwrap(
    api.PATCH('/v1/cart/lines/{lineId}', {
      params: { path: { lineId } },
      body: { quantity },
    }),
  );
  return body.data as unknown as Cart;
}

export async function removeLine(lineId: string): Promise<Cart> {
  const body = await unwrap(
    api.DELETE('/v1/cart/lines/{lineId}', { params: { path: { lineId } } }),
  );
  return body.data as unknown as Cart;
}

/**
 * `DELETE /v1/cart` answers `204` with no body, so there is nothing to render from the response
 * itself — we re-read the (now empty) cart so callers get a consistent `Cart` back.
 */
export async function clearCart(): Promise<Cart> {
  await unwrap(api.DELETE('/v1/cart'));
  return getCart();
}
