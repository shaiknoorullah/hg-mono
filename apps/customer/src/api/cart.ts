/**
 * Cart mutations, in one place, wired to the mock's `/v1/cart*` surface.
 *
 * Every mutation here is server-authoritative (C-19): each call returns the full recomputed
 * `Cart`, and the screens render *that*, never an optimistic guess. `addCartLine`, like every
 * money-mutating write in the contract, requires an `Idempotency-Key`; `idempotencyKey()` mints
 * one per call. The request DTOs carry item identifiers and quantities only — there is no price
 * field to send (G-3), which is the invariant the whole money model rests on.
 *
 * The `as unknown as Cart` at each boundary is the same single-widening the discovery screen
 * does: `openapi-fetch` reconstructs the response as a structural mapped type, which
 * drops the nominal identity of the branded `Cents` fields. The shape is identical; the cast
 * re-brands it once, here, so no screen has to.
 */
import { idempotencyKey, unwrap } from '@hg/api-client';
import type { Schema } from '@hg/api-client';

import { api } from './client';

export type Cart = Schema['Cart'];
/** The add-line DTO: identifiers, quantities and a note. The contract has no price field. */
export type CartLineInput = Schema['CartLineInput'];

export async function getCart(): Promise<Cart> {
  const body = await unwrap(api.GET('/v1/cart'));
  return body.data as unknown as Cart;
}

/**
 * `addCartLine`. `replace: true` is the "Start a new cart" path after `409 DIFFERENT_RESTAURANT`:
 * the server clears the old cart and adds this line in one transaction, so a failed add can
 * never leave the customer with an empty cart (C-20 rule 2). Never clear-then-add.
 *
 * `idempotencyKey` lets a retry of the same intent reuse its key; a new intent mints one.
 */
export async function addCartLine(
  line: CartLineInput,
  opts: { replace?: boolean; idempotencyKey?: string } = {},
): Promise<Cart> {
  const body = await unwrap(
    api.POST('/v1/cart/lines', {
      params: {
        header: { 'Idempotency-Key': opts.idempotencyKey ?? idempotencyKey() },
        query: opts.replace ? { replace: true } : undefined,
      },
      body: line,
    }),
  );
  return body.data as unknown as Cart;
}

/**
 * Adds an item with its chosen variants, one per variant group (`variant_ids`), so a dish with
 * a size and a rice choice keeps both (#628). No variants: the bare item.
 */
export async function addToCart(menuItemId: string, quantity = 1, variantIds: string[] = []): Promise<Cart> {
  return addCartLine({
    menu_item_id: menuItemId,
    quantity,
    ...(variantIds.length ? { variant_ids: variantIds } : {}),
  });
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
