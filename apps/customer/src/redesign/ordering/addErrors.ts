/**
 * What a failed `addCartLine` means to the customer (manifest D9; ported from #634/#649
 * `ordering/addErrors.ts`, copy re-checked against the `DO/Item-*` boards). The sheet branches on
 * the error `code`, never on `message`, and every refusal leaves the cart unchanged (the server
 * does nothing on a 409 or 422), so the copy says so.
 *
 * - `DIFFERENT_RESTAURANT` is not an error to the customer: it is a decision ("Start a new
 *   cart?"), answered with `addCartLine?replace=true`.
 * - `ITEM_DELETED`, `NO_LIVE_MENU_ITEM` and `ITEM_BLOCKED_BY_ADMIN` are the "gone" state
 *   (`DO/Item-gone`): the dish is no longer on the menu. A compliance block is never named.
 * - `RESTAURANT_UNAVAILABLE` gives no cause: no halal wording (the restaurant may be delisted,
 *   suspended or lapsed, and the app does not say which).
 */
import { isApiError } from '@hg/api-client';

export type AddFailure =
  | { kind: 'differentRestaurant'; restaurantName: string | null; itemCount: number | null }
  | { kind: 'gone' }
  | { kind: 'restaurantClosed' }
  | { kind: 'restaurantUnavailable' }
  | { kind: 'itemUnavailable' }
  | { kind: 'variantUnavailable'; variantId: string | null }
  | { kind: 'addonUnavailable'; addonId: string | null }
  | { kind: 'invalid' }
  | { kind: 'orderingPaused' }
  /** A transport failure: nothing reached the server; a retry reuses the same key. */
  | { kind: 'offline' }
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
  if (!isApiError(e)) return { kind: 'offline' };
  switch (e.code) {
    case 'DIFFERENT_RESTAURANT': {
      // "Your cart has 2 items from …" counts items (the sum of quantities); a server that
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
    case 'ITEM_DELETED':
    case 'NO_LIVE_MENU_ITEM':
    case 'ITEM_BLOCKED_BY_ADMIN':
      return { kind: 'gone' };
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
      if (e.status === 404) return { kind: 'gone' };
      return e.status === 422 ? { kind: 'invalid' } : { kind: 'other' };
  }
}

export type AlertIcon = 'warning' | 'clock' | 'error' | 'info';

export interface FailureCopy {
  title: string;
  body: string;
  icon: AlertIcon;
}

export const UNCHANGED = "Nothing was added and your cart hasn't changed.";

/** The inline alert for every failure except the different-restaurant decision and "gone". */
export function failureCopy(
  f: Exclude<AddFailure, { kind: 'differentRestaurant' } | { kind: 'gone' }>,
  ctx: {
    itemName: string;
    restaurantName: string;
    /** "Size" when a variant ran out, to say "Choose another size." */
    groupName?: string | null;
    variantName?: string | null;
    addonName?: string | null;
    /** "It opens tomorrow at 11:00 am." when the restaurant just closed and says when it opens. */
    opensSentence?: string | null;
  },
): FailureCopy {
  switch (f.kind) {
    case 'restaurantClosed':
      return {
        icon: 'clock',
        title: `${ctx.restaurantName} just closed`,
        body: ctx.opensSentence ? `${UNCHANGED} ${ctx.opensSentence}` : UNCHANGED,
      };
    case 'restaurantUnavailable':
      return { icon: 'info', title: `${ctx.restaurantName} can't take orders right now`, body: UNCHANGED };
    case 'itemUnavailable':
      return { icon: 'warning', title: `${ctx.itemName} just sold out`, body: `${UNCHANGED} Choose another dish.` };
    case 'variantUnavailable': {
      const group = ctx.groupName?.trim().toLowerCase() || 'option';
      return {
        icon: 'warning',
        title: ctx.variantName ? `"${ctx.variantName}" just sold out` : 'That choice just sold out',
        body: `${UNCHANGED} Choose another ${group}.`,
      };
    }
    case 'addonUnavailable':
      return {
        icon: 'warning',
        title: ctx.addonName ? `${ctx.addonName} just ran out` : 'One of your extras just ran out',
        body: `${UNCHANGED} Untick it or choose another extra.`,
      };
    case 'invalid':
      return { icon: 'warning', title: "Some of your choices weren't accepted", body: `${UNCHANGED} Check the options and try again.` };
    case 'orderingPaused':
      return { icon: 'info', title: 'Ordering is paused right now', body: `${UNCHANGED} Please try again a little later.` };
    case 'offline':
    case 'other':
      return {
        icon: 'error',
        title: "We couldn't add this to your cart",
        body: 'Check your connection and try again. Your cart is unchanged.',
      };
  }
}

/** "Your cart has 2 items from Karahi House. A cart holds one restaurant at a time, …" */
export function differentRestaurantCopy(d: { name: string | null; count: number | null } | null): string {
  const what = d?.count != null ? `${d.count} ${d.count === 1 ? 'item' : 'items'}` : 'items';
  const from = d?.name ? ` from ${d.name}` : ' from another restaurant';
  return `Your cart has ${what}${from}. A cart holds one restaurant at a time, so starting a new cart removes them.`;
}

/** "Your Karahi House cart is unchanged (2 items). Try again, or keep that cart." */
export function replaceFailedCopy(old: { name: string | null; count: number | null } | null): string {
  const which = old?.name ? `${old.name} cart` : 'cart';
  const count = old?.count != null ? ` (${old.count} ${old.count === 1 ? 'item' : 'items'})` : '';
  return `Your ${which} is unchanged${count}. Try again, or keep that cart.`;
}
