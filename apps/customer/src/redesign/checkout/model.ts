/**
 * Checkout's rules, without UI (boards `CC/Checkout-*`).
 *
 * Nothing here adds, subtracts or multiplies an amount. The one comparison on money is "did the
 * server change this figure between two quotes it sent", which is how the "price changed" boards
 * show was and now. Every figure comes from a quote or an order the server returned.
 */
import { cents, parseAmountToCents } from '@hg/api-client';
import type { Cents } from '@hg/api-client';

import { errorCodeOf } from '../lib/query';
import type { CancellationReason, DeliveryInstruction, Order, OrderLine, OrderPayment, Quote } from './checkoutApi';
import type { CartLineInput } from '../ordering/cart';

/* ------------------------------------------------------------------ tip */

/**
 * The tip presets the customer can tap. They are the customer's own input, sent as `tip_cents`, never
 * a price: the server validates the tip against its limit (`422` on a tip it won't accept).
 */
export const TIP_PRESETS: readonly Cents[] = [cents(0), cents(200), cents(300), cents(500)];

export type TipChoice = { kind: 'preset'; value: Cents } | { kind: 'other'; text: string };

/** The tip to send, or null while "Other" holds text that isn't an amount. */
export function tipOf(choice: TipChoice): Cents | null {
  if (choice.kind === 'preset') return choice.value;
  if (choice.text.trim() === '') return null;
  const parsed = parseAmountToCents(choice.text);
  return parsed !== null && parsed >= 0 ? parsed : null;
}

export const TIP_TOO_HIGH = 'That tip is more than we can accept for this order. Try a smaller amount.';
export const TIP_NOT_AN_AMOUNT = 'Enter an amount like 4.50.';

/* --------------------------------------------------------------- errors */

/** A refusal that changes what the board shows, from the server's error code. */
export type Block =
  | 'belowMinimum'
  | 'restaurantClosed'
  | 'restaurantUnavailable'
  | 'linesUnavailable'
  | 'province'
  | 'outOfRange'
  | 'taxProfile'
  | 'profileIncomplete'
  | 'orderingPaused'
  | 'rateLimited';

const BLOCKS: Readonly<Record<string, Block>> = {
  BELOW_MINIMUM_ORDER: 'belowMinimum',
  RESTAURANT_CLOSED: 'restaurantClosed',
  RESTAURANT_UNAVAILABLE: 'restaurantUnavailable',
  CART_HAS_UNAVAILABLE_ITEMS: 'linesUnavailable',
  PROVINCE_NOT_SERVED: 'province',
  ADDRESS_OUT_OF_RANGE: 'outOfRange',
  TAX_PROFILE_MISSING: 'taxProfile',
  PROFILE_INCOMPLETE: 'profileIncomplete',
  ORDERING_PAUSED: 'orderingPaused',
  RATE_LIMITED: 'rateLimited',
};

export function blockOf(code: string | null): Block | null {
  return code ? (BLOCKS[code] ?? null) : null;
}

/** The fresh quote a `409 QUOTE_STALE` carries in `error.details.quote`, when it carries one. */
export function staleQuoteOf(error: unknown): Quote | null {
  const details = (error as { details?: unknown } | null)?.details;
  const quote = (details as { quote?: unknown } | null | undefined)?.quote;
  return quote && typeof quote === 'object' && typeof (quote as Quote).id === 'string' ? (quote as Quote) : null;
}

/** Whether a 422 names the tip field (the tip is over the limit). */
export function isTipRefusal(error: unknown): boolean {
  if (errorCodeOf(error) !== 'VALIDATION_FAILED') return false;
  const details = (error as { details?: unknown } | null)?.details;
  return Array.isArray(details) && details.some((d) => (d as { field?: string } | null)?.field === 'tip_cents');
}

/* ------------------------------------------------------- price changes */

export interface ChangedRow {
  label: string;
  was: Cents;
  now: Cents;
}

const COMPARED: ReadonlyArray<readonly [keyof Quote, string]> = [
  ['subtotal_cents', 'Items subtotal'],
  ['delivery_fee_cents', 'Delivery fee'],
  ['service_fee_cents', 'Service fee'],
  ['tax_total_cents', 'Tax'],
  ['tip_cents', 'Tip for your rider'],
  ['total_cents', 'Total'],
];

/**
 * The figures the server changed between two quotes, with the old and the new one, for "The price
 * changed" and "Prices updated". Both are server values; nothing is computed.
 */
export function changedRows(was: Quote, now: Quote): ChangedRow[] {
  const rows: ChangedRow[] = [];
  for (const [key, label] of COMPARED) {
    const a = was[key];
    const b = now[key];
    if (typeof a === 'number' && typeof b === 'number' && a !== b) rows.push({ label, was: a as Cents, now: b as Cents });
  }
  return rows;
}

/* ----------------------------------------------------------- payments */

/** Payment states in which the card is authorised (or further): the order is on its way. */
export const AUTHORISED_STATES: ReadonlySet<OrderPayment['state']> = new Set(['REQUIRES_CAPTURE', 'SUCCEEDED']);

/**
 * Fixed customer messages for a failed authorisation, by the server's `failure_code`. Raw provider
 * text is never shown; an unknown code gets the general message.
 */
export function declineCopy(failureCode: string | null | undefined): { title: string; body: string } {
  const nothing = 'Nothing was charged.';
  switch (failureCode) {
    case 'card_declined':
      return { title: 'Your bank declined this card', body: `${nothing} Use another way to pay, or try this card again.` };
    case 'insufficient_funds':
      return { title: "This card doesn't have enough available", body: `${nothing} Use another way to pay, or try again.` };
    case 'expired_card':
      return { title: 'This card has expired', body: `${nothing} Use another way to pay.` };
    case 'incorrect_cvc':
      return { title: "The security code didn't match", body: `${nothing} Check it and try again, or use another way to pay.` };
    case 'authentication_failed':
      return { title: "Your bank didn't confirm the payment", body: `${nothing} Try again, or use another way to pay.` };
    case 'processing_error':
      return { title: "The payment didn't go through", body: `${nothing} Try again, or use another way to pay.` };
    default:
      return { title: "The payment didn't go through", body: `${nothing} Try again, or use another way to pay.` };
  }
}

/** The saved card as the "Pay with" row names it: "Visa •••• 4242". */
export function cardName(card: { brand: string; last4: string }): string {
  const brand = card.brand ? card.brand.charAt(0).toUpperCase() + card.brand.slice(1) : 'Card';
  return `${brand} •••• ${card.last4}`;
}

/** "Expires 08/28" from the card's display fields. */
export function cardExpiry(card: { exp_month: number; exp_year: number }): string {
  return `${String(card.exp_month).padStart(2, '0')}/${String(card.exp_year % 100).padStart(2, '0')}`;
}

/**
 * Whether a saved card's expiry has passed, by the app clock. Compares calendar months, not money.
 * A card is good through the last day of its expiry month.
 */
export function cardExpired(card: { exp_month: number; exp_year: number }, now: number): boolean {
  const at = new Date(now);
  const year = at.getUTCFullYear();
  const month = at.getUTCMonth() + 1;
  return card.exp_year < year || (card.exp_year === year && card.exp_month < month);
}

/* ------------------------------------------------------------ handover */

export interface HandoverChoice {
  value: Extract<DeliveryInstruction, 'LEAVE_AT_DOOR' | 'MEET_AT_DOOR' | 'MEET_IN_LOBBY'>;
  label: string;
  description: string;
}

export const HANDOVERS: readonly HandoverChoice[] = [
  { value: 'LEAVE_AT_DOOR', label: 'Leave at the door', description: 'The rider takes a photo as proof of delivery.' },
  { value: 'MEET_AT_DOOR', label: 'Meet at the door', description: "You'll give the rider a code at handover." },
  { value: 'MEET_IN_LOBBY', label: 'Meet in the lobby', description: "You'll give the rider a code at handover." },
];

/** `MEET_AT_DOOR` is the client default for an order (an address carries no delivery preference). */
export const DEFAULT_HANDOVER: HandoverChoice['value'] = 'MEET_AT_DOOR';
export const NOTE_LIMIT = 200;

export interface Handover {
  choice: HandoverChoice['value'];
  noRing: boolean;
  noCall: boolean;
  note: string;
}

/** The `delivery_instructions` to send: the handover, then the two optional flags. */
export function instructionsOf(h: Handover): DeliveryInstruction[] {
  const out: DeliveryInstruction[] = [h.choice];
  if (h.noRing) out.push('DO_NOT_RING_BELL');
  if (h.noCall) out.push('DO_NOT_CALL');
  return out;
}

export function handoverLabel(h: Handover): string {
  return HANDOVERS.find((x) => x.value === h.choice)?.label ?? 'Meet at the door';
}

/* -------------------------------------------------------- cancellation */

export const CANCEL_REASONS: ReadonlyArray<{ value: CancellationReason; label: string }> = [
  { value: 'ORDERED_BY_MISTAKE', label: 'I ordered by mistake' },
  { value: 'TOO_LONG_WAIT', label: "It's taking too long" },
  { value: 'WRONG_ADDRESS', label: 'Wrong delivery address' },
  { value: 'CHANGED_MIND', label: 'I changed my mind' },
  { value: 'DUPLICATE_ORDER', label: 'I placed this order twice' },
  { value: 'OTHER', label: 'Something else' },
];

export const NOTE_MIN = 5;

/** The reason is required; "Something else" also needs a note of 5 to 200 characters. */
export function cancelReady(reason: CancellationReason | null, note: string): boolean {
  if (!reason) return false;
  return reason !== 'OTHER' || (note.trim().length >= NOTE_MIN && note.trim().length <= NOTE_LIMIT);
}

/* ---------------------------------------------------- putting items back */

/** An order line as the cart's add request: ids and a quantity, never a price. */
export function lineToInput(line: OrderLine): CartLineInput {
  const variantIds = (line.variants ?? []).map((v) => v.variant_id);
  const addons = (line.addons ?? []).map((a) => ({ addon_id: a.addon_id, quantity: a.addon_quantity }));
  const note = line.special_request?.trim();
  return {
    menu_item_id: line.menu_item_id,
    quantity: line.quantity,
    ...(variantIds.length ? { variant_ids: variantIds } : {}),
    ...(addons.length ? { addons } : {}),
    ...(note ? { special_request: note } : {}),
  };
}

/** Whether the server has finished with an unpaid order (cancelled, expired, failed). */
export function orderEnded(order: Pick<Order, 'state'>): boolean {
  return order.state === 'CANCELLED' || order.state === 'FAILED' || order.state === 'REJECTED';
}

/** The option line under a dish: "Platter size: For two · Extra garlic sauce × 1". */
export function quoteLineOptions(line: Quote['lines'][number]): string | null {
  const parts = [
    ...(line.variants ?? []).map((v) => `${v.group_name}: ${v.variant_name}`),
    ...(line.addons ?? []).map((a) => (a.addon_quantity > 1 ? `${a.addon_name} × ${a.addon_quantity}` : a.addon_name)),
  ];
  return parts.length ? parts.join(' · ') : null;
}
