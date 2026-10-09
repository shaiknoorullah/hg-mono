/**
 * Small, pure helpers the cart, checkout, tracking and orders screens share.
 *
 * - `lineOptions` writes what tells two lines of the same dish apart: the variant and each
 *   add-on with its count ("Family (serves 4) · Garlic naan × 4"). Two "Special Mango Lassi"
 *   lines with different add-ons must never look identical (owner report, Oct 2026).
 * - `safeCents` brands a server amount only when it is a safe integer. `cents()` throws on
 *   anything else, and a throw during render takes the whole screen down; a field the server
 *   left out is shown as no amount, never as a crash and never as a guess.
 * - `checkoutProblem` maps every error `createQuote` and `createOrder` can answer to the copy
 *   and the one next step the approved Checkout boards draw for it.
 */
import type { Cents, Schema } from '@hg/api-client';

type CartLine = Schema['CartLine'];
type QuoteLine = Schema['QuoteLine'];
type OrderLine = Schema['OrderLine'];
type AvailabilityState = Schema['RestaurantAvailabilityInfo']['state'];

export function safeCents(value: unknown): Cents | null {
  return typeof value === 'number' && Number.isSafeInteger(value) ? (value as Cents) : null;
}

function addonText(name: string, quantity: number | null | undefined): string {
  return quantity && quantity > 1 ? `${name} × ${quantity}` : name;
}

/** "Family (serves 4) · Garlic naan × 4 · Garlic toum × 2", or null for a plain line. */
export function lineOptions(line: CartLine): string | null {
  const parts: string[] = [];
  if (line.variant?.name) parts.push(line.variant.name);
  for (const a of line.addons ?? []) {
    if (a?.name) parts.push(addonText(a.name, a.quantity));
  }
  return parts.length > 0 ? parts.join(' · ') : null;
}

/** The same summary for a priced quote line (checkout) or an order line (tracking). */
export function pricedLineOptions(line: QuoteLine | OrderLine): string | null {
  const parts: string[] = [];
  const variant = 'variant_name' in line ? line.variant_name : null;
  if (variant) parts.push(variant);
  for (const a of line.addons ?? []) {
    if (a?.addon_name) parts.push(addonText(a.addon_name, a.addon_quantity));
  }
  return parts.length > 0 ? parts.join(' · ') : null;
}

/**
 * "7:42 pm", the 12-hour form every customer screen uses (redesign constitution, "Times are
 * 12-hour"), from the shared `formatAbsoluteTime`, whose en-CA output is "7:42 p.m.". Empty for
 * an unparseable time, so a bad timestamp prints nothing rather than "Invalid Date".
 */
export function clockTime(
  iso: string | null | undefined,
  format: (iso: string) => string,
): string {
  if (!iso) return '';
  return format(iso).replace(/\s*([ap])\.?\s?m\.?$/i, (_m, p: string) => ` ${p.toLowerCase()}m`);
}

/** A special request as the canvases print it: quoted, or null when there is none. */
export function requestText(request: string | null | undefined): string | null {
  const trimmed = request?.trim();
  return trimmed ? `“${trimmed}”` : null;
}

/** What the screen offers after a refused quote or order. */
export type ProblemAction =
  | 'retry'
  | 'address'
  | 'cart'
  | 'browse'
  | 'requote'
  | 'profile'
  | 'orders';

export interface CheckoutProblem {
  title: string;
  body: string;
  action: ProblemAction;
}

/**
 * Copy for each refusal, from the approved Checkout boards (blocked, cannot-deliver,
 * unavailable, quote-stale, error). Every one says nothing was charged; none of them is red.
 * An unknown code is the generic "couldn't price" problem, never a throw. `availabilityState` is
 * the cart's restaurant card: a PAUSED restaurant (paused, switch off or order screen offline)
 * is "temporarily not accepting orders", never "just closed" (owner decision 2026-10-09).
 */
export function checkoutProblem(
  code: string | null,
  restaurantName: string | null = null,
  stage: 'quote' | 'place' = 'quote',
  availabilityState: AvailabilityState | null = null,
): CheckoutProblem {
  const name = restaurantName ?? 'The restaurant';
  switch (code) {
    case 'ADDRESS_OUT_OF_RANGE':
      return {
        title: `${name} doesn't deliver there`,
        body: 'That address is outside its delivery area. Choose another address to see a price.',
        action: 'address',
      };
    case 'PROVINCE_NOT_SERVED':
      return {
        title: 'We deliver in Ontario only for now',
        body: 'Choose an Ontario address to place this order.',
        action: 'address',
      };
    case 'RESTAURANT_CLOSED':
      if (availabilityState === 'PAUSED') {
        return {
          title: `${name} is temporarily not accepting orders`,
          body: 'Please try again later. Your cart is saved and nothing was charged.',
          action: 'cart',
        };
      }
      return {
        title: `${name} just closed`,
        body: 'Your cart is saved and nothing was charged.',
        action: 'cart',
      };
    case 'RESTAURANT_UNAVAILABLE':
      return {
        title: `${name} can't take orders right now`,
        body: 'Your cart is saved and nothing was charged.',
        action: 'browse',
      };
    case 'CART_HAS_UNAVAILABLE_ITEMS':
      return {
        title: 'Something in your cart ran out',
        body: 'Remove it or change it in your cart to continue. Nothing was charged.',
        action: 'cart',
      };
    case 'BELOW_MINIMUM_ORDER':
      return {
        title: 'Below the minimum order',
        body: 'Add more items to check out. Nothing was charged.',
        action: 'cart',
      };
    case 'QUOTE_EXPIRED':
    case 'QUOTE_STALE':
      return {
        title: code === 'QUOTE_STALE' ? 'The price changed' : 'Your price hold ran out',
        body: "We've priced the order again. Check the new total, then place it. Nothing was charged.",
        action: 'requote',
      };
    case 'ACTIVE_ORDER_EXISTS':
      return {
        title: 'You already have an order on the way',
        body: 'One order at a time. Follow it from Orders; your cart is saved.',
        action: 'orders',
      };
    case 'PROFILE_INCOMPLETE':
      return {
        title: 'Finish your profile to order',
        body: 'Add your name and email to place your first order.',
        action: 'profile',
      };
    case 'RATE_LIMITED':
      return {
        title: 'Too many tries',
        body: 'Wait a moment, then try again. Nothing was charged.',
        action: 'retry',
      };
    case 'TAX_PROFILE_MISSING':
      return {
        title: "We can't price this order right now",
        body: 'This is on our side and nothing was charged. Your cart is saved.',
        action: 'retry',
      };
    default:
      return {
        title: stage === 'place' ? "We couldn't place your order" : "We couldn't price this order",
        body: 'Nothing has been charged and your cart is saved. Try again, or go back to your cart.',
        action: 'retry',
      };
  }
}
