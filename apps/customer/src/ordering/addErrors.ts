/**
 * What a failed `addCartLine` means to the customer. The screen branches on the error `code`
 * (never on `message`), and every refusal leaves the cart unchanged — the server does nothing
 * on a 409 or 422 — so every copy line can say so.
 *
 * `DIFFERENT_RESTAURANT` is not an error to the customer; it is a decision ("Start a new
 * cart?"), answered with `addCartLine?replace=true`.
 */
import { isApiError } from '@hg/api-client';

export type AddFailure =
  | { kind: 'differentRestaurant'; restaurantName: string | null; itemCount: number | null }
  | { kind: 'restaurantClosed' }
  | { kind: 'restaurantUnavailable' }
  | { kind: 'itemUnavailable' }
  | { kind: 'variantUnavailable'; variantId: string | null }
  | { kind: 'addonUnavailable'; addonId: string | null }
  | { kind: 'invalid' }
  | { kind: 'orderingPaused' }
  | { kind: 'other' };

function detail(e: { details?: unknown }, key: string): unknown {
  const d = e.details as unknown;
  if (d && typeof d === 'object' && !Array.isArray(d)) return (d as Record<string, unknown>)[key];
  return undefined;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

export function classifyAddError(e: unknown): AddFailure {
  if (!isApiError(e)) return { kind: 'other' };
  switch (e.code) {
    case 'DIFFERENT_RESTAURANT': {
      // "Your cart has 3 items from …" counts items (the sum of quantities); a server that
      // predates current_item_count sends only the line count.
      const items = detail(e, 'current_item_count');
      const lines = detail(e, 'current_line_count');
      const count = typeof items === 'number' ? items : lines;
      return {
        kind: 'differentRestaurant',
        restaurantName: str(detail(e, 'current_restaurant_name')),
        itemCount: typeof count === 'number' ? count : null,
      };
    }
    case 'RESTAURANT_CLOSED':
      return { kind: 'restaurantClosed' };
    case 'RESTAURANT_UNAVAILABLE':
      return { kind: 'restaurantUnavailable' };
    case 'ITEM_UNAVAILABLE':
      return { kind: 'itemUnavailable' };
    case 'VARIANT_UNAVAILABLE':
      return { kind: 'variantUnavailable', variantId: str(detail(e, 'variant_id')) };
    case 'ADDON_UNAVAILABLE':
      return { kind: 'addonUnavailable', addonId: str(detail(e, 'addon_id')) };
    case 'VALIDATION_FAILED':
    case 'INVALID_ADDON':
    case 'UNKNOWN_FIELD':
      return { kind: 'invalid' };
    case 'ORDERING_PAUSED':
      return { kind: 'orderingPaused' };
    default:
      return e.status === 422 ? { kind: 'invalid' } : { kind: 'other' };
  }
}

export interface FailureCopy {
  title: string;
  body: string;
  icon: 'warning' | 'clock' | 'error' | 'info';
}

/** The inline alert for every failure except the different-restaurant decision. */
export function failureCopy(
  f: Exclude<AddFailure, { kind: 'differentRestaurant' }>,
  ctx: { itemName: string; restaurantName: string; variantName?: string | null; addonName?: string | null },
): FailureCopy {
  const unchanged = "Nothing was added and your cart hasn't changed.";
  switch (f.kind) {
    case 'restaurantClosed':
      return {
        icon: 'clock',
        title: `${ctx.restaurantName} just closed`,
        body: `${unchanged} You can still read the menu.`,
      };
    case 'restaurantUnavailable':
      return {
        icon: 'info',
        title: `${ctx.restaurantName} can't take orders right now`,
        body: `${unchanged} We can't currently confirm this restaurant's halal certificate or listing, so ordering is paused.`,
      };
    case 'itemUnavailable':
      return { icon: 'warning', title: `${ctx.itemName} just sold out`, body: `${unchanged} Choose another dish.` };
    case 'variantUnavailable':
      return {
        icon: 'warning',
        title: ctx.variantName ? `"${ctx.variantName}" just sold out` : 'That choice just sold out',
        body: `${unchanged} Choose another option.`,
      };
    case 'addonUnavailable':
      return {
        icon: 'warning',
        title: ctx.addonName ? `${ctx.addonName} just ran out` : 'One of your extras just ran out',
        body: `${unchanged} Untick it or choose another extra.`,
      };
    case 'invalid':
      return {
        icon: 'warning',
        title: "Some of your choices weren't accepted",
        body: `${unchanged} Check the options and try again.`,
      };
    case 'orderingPaused':
      return {
        icon: 'info',
        title: 'Ordering is paused right now',
        body: `${unchanged} Please try again a little later.`,
      };
    case 'other':
      return {
        icon: 'error',
        title: "We couldn't add this to your cart",
        body: 'Check your connection and try again. Your cart is unchanged.',
      };
  }
}
