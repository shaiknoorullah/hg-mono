/**
 * The cart's rules, without UI (manifest C1; ported from #639 `ordering/lines.ts` and the
 * `CartScreen` logic, adapted to multi-variant lines from #644/#649 and to the `CC/Cart-*` boards).
 *
 * - `lineOptions` writes what tells two lines of the same dish apart: every variant as
 *   "group: variant" and every add-on with its count, joined with " · ". It reads `variants[]`,
 *   never the deprecated `variant` (null for a multi-variant line).
 * - `safeCents` brands a server amount only when it is a safe integer; a field the server left out
 *   is shown as no amount, never a crash and never a guess.
 * - `cartState` decides which board the cart is on. Every decision reads a server field
 *   (`blocking_reasons`, `availability`, `halal.display_state`, line `availability`): below the
 *   minimum comes only from `BELOW_MINIMUM_ORDER`, never from comparing amounts on the phone.
 */
import type { Cents, Schema } from '@hg/api-client';

import type { ActiveOrder, Cart, CartLine } from './cart';

type AvailabilityReason = NonNullable<Schema['CartLineAvailability']['reason']>;

export const MAX_LINE_QUANTITY = 20;

export function safeCents(value: unknown): Cents | null {
  return typeof value === 'number' && Number.isSafeInteger(value) ? (value as Cents) : null;
}

/** "Platter size: For two · Rice: No rice · Mint raita × 1", or null for a plain line. */
export function lineOptions(line: CartLine): string | null {
  const parts: string[] = [];
  for (const v of line.variants ?? []) {
    if (v?.variant_name) parts.push(v.group_name ? `${v.group_name}: ${v.variant_name}` : v.variant_name);
  }
  for (const a of line.addons ?? []) {
    if (a?.name) parts.push(`${a.name} × ${a.quantity ?? 1}`);
  }
  return parts.length > 0 ? parts.join(' · ') : null;
}

/** A special request as the boards print it: quoted, or null when there is none. */
export function requestText(request: string | null | undefined): string | null {
  const trimmed = request?.trim();
  return trimmed ? `“${trimmed}”` : null;
}

/** "3 items", "1 item". */
export function itemsText(n: number): string {
  return `${n} ${n === 1 ? 'item' : 'items'}`;
}

/* -------------------------------------------------------------- per line */

export interface LineFlag {
  reason: AvailabilityReason;
  /** The neutral badge on the line (never red, never green). */
  badge: string | null;
  /** The line can't be ordered as it is: the stepper gives way to Remove. */
  blocked: boolean;
  /** Edit is offered (a choice ran out); not for a dish that can't be re-added. */
  editable: boolean;
}

/** The line's availability as the boards draw it (`CC/Cart-unavailable-line` and its siblings). */
export function lineFlag(line: CartLine): LineFlag | null {
  const a = line.availability;
  const reason = a?.reason ?? null;
  if (!reason) return a?.is_available === false ? { reason: 'OUT_OF_STOCK', badge: 'Not available right now', blocked: true, editable: false } : null;
  switch (reason) {
    case 'OUT_OF_STOCK':
      return { reason, badge: 'Out of stock', blocked: true, editable: false };
    case 'ITEM_DELETED':
      return { reason, badge: 'No longer on the menu', blocked: true, editable: false };
    case 'CATEGORY_INACTIVE':
      return { reason, badge: 'Not available right now', blocked: true, editable: false };
    case 'RESTAURANT_UNAVAILABLE':
      return { reason, badge: 'Not available right now', blocked: true, editable: false };
    case 'VARIANT_UNAVAILABLE':
      return { reason, badge: 'Size sold out', blocked: true, editable: true };
    case 'ADDON_UNAVAILABLE':
      return { reason, badge: 'Extra ran out', blocked: true, editable: true };
    case 'PRICE_CHANGED':
      // Was/now is drawn from two server values; the line stays orderable unless the server says not.
      return { reason, badge: null, blocked: a?.is_available === false, editable: true };
    case 'RESTAURANT_CLOSED':
      // The restaurant banner says it once; the lines stay as they are.
      return { reason, badge: null, blocked: false, editable: true };
    default:
      return { reason, badge: 'Not available right now', blocked: a?.is_available === false, editable: false };
  }
}

/**
 * Was/now for a repriced line (`CC/Cart-price-changed`): the unit price when it was added and the
 * current one, both server values. Null unless the server sent both.
 */
export function priceChange(line: CartLine): { was: Cents; now: Cents; up: boolean } | null {
  if (line.availability?.reason !== 'PRICE_CHANGED') return null;
  const was = safeCents(line.unit_price_cents);
  const now = safeCents(line.availability.current_price_cents);
  if (was === null || now === null || was === now) return null;
  // Comparing two server values for the was/now wording is the one comparison allowed.
  return { was, now, up: now > was };
}

/* -------------------------------------------------------------- the cart */

export type CartHalal = 'ok' | 'lapsed' | 'unavailable';

/**
 * The cart's restaurant, judged on halal and listing (boards `CC/Cart-cert-lapsed`,
 * `-restaurant-unavailable`; G16 fallback):
 *  - `lapsed`: the server says `EXPIRED` (cool slate, never red);
 *  - `unavailable`: no restaurant, no halal record, `UNVERIFIED`, or `RESTAURANT_UNAVAILABLE` with
 *    no lapsed certificate behind it. No cause is given and no badge is drawn;
 *  - `ok`: anything else (a partial record shows the neutral line, not a badge).
 */
export function cartHalal(cart: Cart): CartHalal {
  const r = cart.restaurant;
  if (!r || !r.halal) return 'unavailable';
  const state = r.halal.display_state;
  if (state === 'EXPIRED') return 'lapsed';
  if (state === 'UNVERIFIED') return 'unavailable';
  if ((cart.blocking_reasons ?? []).includes('RESTAURANT_UNAVAILABLE')) return 'unavailable';
  if (cart.lines.length > 0 && cart.lines.every((l) => l.availability?.reason === 'RESTAURANT_UNAVAILABLE')) return 'unavailable';
  return 'ok';
}

export type CartState =
  | { kind: 'certLapsed' }
  | { kind: 'restaurantUnavailable' }
  | { kind: 'activeOrder'; order: ActiveOrder }
  | { kind: 'restaurantClosed'; paused: boolean }
  | { kind: 'orderingPaused' }
  | { kind: 'linesBlocked'; lines: CartLine[]; focus: 'remove' | 'variant' | 'addon' }
  | { kind: 'belowMinimum' }
  | { kind: 'noAddress' }
  | { kind: 'ready' };

/**
 * Which board the cart is on, from server fields only, most serious first. `activeOrder` is the
 * result of `getActiveOrder` (null: none, or not known yet).
 */
export function cartState(cart: Cart, activeOrder: ActiveOrder | null): CartState {
  const halal = cartHalal(cart);
  if (halal === 'lapsed') return { kind: 'certLapsed' };
  if (halal === 'unavailable') return { kind: 'restaurantUnavailable' };
  if (activeOrder) return { kind: 'activeOrder', order: activeOrder };
  const reasons = cart.blocking_reasons ?? [];
  const availability = cart.restaurant?.availability?.state;
  if (availability === 'PAUSED') return { kind: 'restaurantClosed', paused: true };
  if (availability === 'CLOSED_HOURS' || reasons.includes('RESTAURANT_CLOSED')) return { kind: 'restaurantClosed', paused: false };
  if (reasons.includes('ORDERING_PAUSED')) return { kind: 'orderingPaused' };
  const blocked = cart.lines.filter((l) => lineFlag(l)?.blocked);
  if (blocked.length > 0) {
    const removeOnly = blocked.filter((l) => !lineFlag(l)!.editable);
    if (removeOnly.length > 0) return { kind: 'linesBlocked', lines: removeOnly, focus: 'remove' };
    const variant = blocked.filter((l) => lineFlag(l)!.reason === 'VARIANT_UNAVAILABLE');
    if (variant.length > 0) return { kind: 'linesBlocked', lines: variant, focus: 'variant' };
    return { kind: 'linesBlocked', lines: blocked, focus: 'addon' };
  }
  if (reasons.includes('BELOW_MINIMUM_ORDER')) return { kind: 'belowMinimum' };
  if (!cart.delivery_address_id) return { kind: 'noAddress' };
  return { kind: 'ready' };
}

/**
 * Whether the cart may ask for a binding quote: it has an address and the server says it is
 * quotable. A cart blocked for any other reason shows the estimate ("Items (estimate)").
 */
export function canQuote(cart: Cart, state: CartState): boolean {
  // An order on the way does not stop pricing (the board shows the totals); it stops checkout.
  return (state.kind === 'ready' || state.kind === 'activeOrder') && cart.is_quotable && Boolean(cart.delivery_address_id) && cart.lines.length > 0;
}

/** "1 item is out of stock" / "2 items can't be ordered right now" (`CC/Cart-unavailable-line`, `-item-deleted`). */
export function blockedLinesNotice(lines: readonly CartLine[]): { title: string; description: string; footer: string; action: string } {
  const allOutOfStock = lines.every((l) => l.availability?.reason === 'OUT_OF_STOCK');
  const n = lines.length;
  const names = lines.map((l) => l.name);
  const joined = names.length <= 2 ? names.join(' and ') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  const pronoun = n === 1 ? 'it' : 'them';
  const title = allOutOfStock
    ? `${itemsText(n)} ${n === 1 ? 'is' : 'are'} out of stock`
    : `${itemsText(n)} can't be ordered right now`;
  const footer =
    allOutOfStock && n === 1
      ? `${joined} is out of stock. Remove it to check out.`
      : `${joined} can't be ordered. Remove ${pronoun} to check out.`;
  return {
    title,
    description: `Remove ${pronoun} to continue — we don't change your cart without asking.`,
    footer,
    action: n === 1 ? `Remove ${names[0]}` : `Remove ${itemsText(n)}`,
  };
}

/**
 * "It's closed until tomorrow at 11:00 am." from the restaurant page's "opens tomorrow at 11:00 am"
 * (`CC/Cart-restaurant-closed`); null when the server gave no opening time.
 */
export function closedUntil(opens: string | null): string | null {
  if (!opens) return null;
  const rest = opens.replace(/^opens /, '').replace(/^at /, '');
  return `It's closed until ${rest}.`;
}

/** "Order HG-8F3K2Q from Zaytoun Grill is being prepared." (`CC/Cart-active-order`). */
export function activeOrderSentence(order: ActiveOrder): string {
  const where = order.restaurant?.name ? ` from ${order.restaurant.name}` : '';
  const what: string = (() => {
    switch (order.state) {
      case 'CREATED':
      case 'AUTHORIZED':
      case 'RESTAURANT_PENDING':
        return 'is waiting for the restaurant';
      case 'PREPARING':
      case 'READY_FOR_PICKUP':
        return 'is being prepared';
      default:
        return 'is on the way';
    }
  })();
  return `Order ${order.code}${where} ${what}. You can place another once it's delivered.`;
}
