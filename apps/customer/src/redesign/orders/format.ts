/**
 * The words Orders (T9) and Receipt (T10) put on screen, as data and pure functions so the tables
 * are tested on their own (WP9 DONE list).
 *
 * - The row badge per OrderState is verbatim from the Track & After canvas note s6.
 * - Money on a row: only REJECTED and FAILED say "Not charged"; CANCELLED and RESOLVED say "See
 *   details for your money", because `OrderSummary` cannot tell a voided cancel from a refunded
 *   one; every other row shows the server's total through `Price`. Never a bare "$0.00" claim.
 * - The refund section reads per RefundState; FAILED is "Refund in progress", never "Refunded".
 * - A receipt that cannot be shown (409 `RECEIPT_NOT_READY`) is chosen from the order and its
 *   payment: never captured, never completed, or not yet completed.
 *
 * No money is added or compared here; the only number read is whether a server amount is zero.
 */
import type { Schema } from '@hg/api-client';

import { formatDate, formatTime } from '../lib/time';

export type OrderState = Schema['OrderState'];
export type OrderSummary = Schema['OrderSummary'];
export type RefundState = Schema['RefundState'];
export type Refund = Schema['Refund'];

/* ------------------------------------------------------------------ Orders rows */

export type RowBadgeVariant = 'info' | 'neutral';

/** Canvas note s6, verbatim. */
export const ORDER_ROW_BADGE: Record<OrderState, string> = {
  CREATED: 'Placing',
  AUTHORIZED: 'Placing',
  RESTAURANT_PENDING: 'Waiting for restaurant',
  PREPARING: 'Being prepared',
  READY_FOR_PICKUP: 'Ready',
  PICKED_UP: 'On the way',
  ARRIVED: 'At your door',
  DELIVERED: 'Delivered',
  COMPLETED: 'Completed',
  DISPUTED: 'Under review',
  RESOLVED: 'Resolved',
  CANCELLED: 'Cancelled',
  REJECTED: 'Not accepted',
  FAILED: 'Payment failed',
};

/** The states that use the info badge: the live ones, DISPUTED excepted. */
const INFO_STATES: ReadonlySet<OrderState> = new Set<OrderState>([
  'CREATED',
  'AUTHORIZED',
  'RESTAURANT_PENDING',
  'PREPARING',
  'READY_FOR_PICKUP',
  'PICKED_UP',
  'ARRIVED',
  'DELIVERED',
]);

export function rowBadge(state: string): { label: string; variant: RowBadgeVariant } | null {
  const label = (ORDER_ROW_BADGE as Record<string, string | undefined>)[state];
  // An unknown future state gets no badge rather than a guess.
  if (!label) return null;
  return { label, variant: INFO_STATES.has(state as OrderState) ? 'info' : 'neutral' };
}

export const NOT_CHARGED = 'Not charged';
export const SEE_DETAILS_FOR_MONEY = 'See details for your money';

/** What a row says about money: a line of text, or the server total through `Price`. */
export type RowMoney = { kind: 'text'; text: string } | { kind: 'total' };

export function rowMoney(state: string): RowMoney {
  if (state === 'REJECTED' || state === 'FAILED') return { kind: 'text', text: NOT_CHARGED };
  if (state === 'CANCELLED' || state === 'RESOLVED') return { kind: 'text', text: SEE_DETAILS_FOR_MONEY };
  return { kind: 'total' };
}

/** "3 items · Chicken Biryani, Beef Nihari" (wraps on screen, never truncated). */
export function itemsLine(order: Pick<OrderSummary, 'item_count' | 'first_item_names'>): string | null {
  const names = (order.first_item_names ?? []).filter((n) => n && n.trim()).join(', ');
  const count = order.item_count;
  if (typeof count !== 'number') return names || null;
  const noun = count === 1 ? 'item' : 'items';
  return names ? `${count} ${noun} · ${names}` : `${count} ${noun}`;
}

/** "Today, 6:42 pm" for an order placed today (Toronto time), otherwise "25 September 2026". */
export function placedLine(placedAt: string, now: number): string {
  const at = Date.parse(placedAt);
  if (Number.isNaN(at)) return '';
  if (formatDate(at) === formatDate(now)) return `Today, ${formatTime(at)}`;
  return formatDate(at);
}

/** "29 September, 7:20 pm": a review's answer-by time (DISPUTED rows). */
export function dayAndTime(value: string): string {
  const at = Date.parse(value);
  if (Number.isNaN(at)) return '';
  return `${formatDate(at).replace(/\s\d{4}$/, '')}, ${formatTime(at)}`;
}

/** Whether an Orders row belongs under Active: listed by `status_group=ACTIVE`, DISPUTED included. */
export function isLiveState(state: string): boolean {
  return INFO_STATES.has(state as OrderState) && state !== 'DELIVERED';
}

/** The row menu's View receipt shows only when a receipt exists: a completed order. */
export function hasReceipt(state: string): boolean {
  return state === 'COMPLETED';
}

/* ------------------------------------------------------------------ Payment card */

const BRANDS: Record<string, string> = {
  visa: 'Visa',
  mastercard: 'Mastercard',
  amex: 'American Express',
  american_express: 'American Express',
  discover: 'Discover',
  interac: 'Interac',
  jcb: 'JCB',
  unionpay: 'UnionPay',
  diners: 'Diners Club',
};

const WALLETS: Record<string, string> = {
  apple_pay: 'Apple Pay',
  google_pay: 'Google Pay',
  link: 'Link',
};

/** "Visa •••• 4242", "Apple Pay", or null when the server named no card. */
export function cardName(p: { card_brand?: string | null; card_last4?: string | null; wallet?: string | null }): string | null {
  const wallet = p.wallet ? WALLETS[p.wallet.toLowerCase()] ?? null : null;
  const brandKey = p.card_brand?.toLowerCase() ?? '';
  const brand = brandKey ? BRANDS[brandKey] ?? brandKey.charAt(0).toUpperCase() + brandKey.slice(1) : null;
  const last4 = p.card_last4 && /^\d{4}$/.test(p.card_last4) ? p.card_last4 : null;
  if (brand && last4) return `${brand} •••• ${last4}`;
  if (wallet) return wallet;
  if (brand) return brand;
  return null;
}

/* ------------------------------------------------------------------ Refund section */

export interface RefundView {
  badge: string;
  /** The body line; `card` is filled in by the screen. */
  line: string;
  /** Whether the amount shows (never while under review: review may change it). */
  showAmount: boolean;
}

/** Receipt-RefundStates, verbatim. `card` is "Visa •••• 4242" or null. */
export function refundView(refund: Pick<Refund, 'state' | 'requested_at' | 'settled_at'>, card: string | null): RefundView {
  const toCard = card ? ` to ${card}` : '';
  switch (refund.state) {
    case 'REQUESTED':
    case 'PENDING_APPROVAL':
      return {
        badge: 'Under review',
        line: `Requested on ${formatDate(refund.requested_at)}. We'll set the amount when we decide.`,
        showAmount: false,
      };
    case 'APPROVED':
    case 'AUTHORISED':
    case 'SUBMITTED':
      return { badge: 'On its way', line: `On its way${toCard}`, showAmount: true };
    case 'FAILED':
      // Never "Refunded", never an error colour (RefundState contract note).
      return { badge: 'Refund in progress', line: 'Taking longer than usual. Our team is on it.', showAmount: true };
    case 'SUCCEEDED':
    case 'SETTLED':
      return {
        badge: 'Refunded',
        line: refund.settled_at ? `Refunded${toCard} on ${formatDate(refund.settled_at)}` : `Refunded${toCard}`,
        showAmount: true,
      };
    case 'DECLINED':
      return { badge: 'Not approved', line: "We reviewed your request and didn't issue a refund.", showAmount: false };
    case 'CANCELLED':
      return { badge: 'Withdrawn', line: 'This request was withdrawn.', showAmount: false };
    default:
      // An unknown future state is treated as still in progress, never as refunded.
      return { badge: 'Refund in progress', line: 'Taking longer than usual. Our team is on it.', showAmount: false };
  }
}

/**
 * The reason line under a refund (Receipt-Refund annotation): a fixed table, never `Refund.note`
 * (that is the requester's own text). Codes outside the table show no reason line.
 */
export const REFUND_REASON_LINE: Partial<Record<Schema['RefundReasonCode'], string>> = {
  DISPUTE_RESOLUTION: 'After a review by our team',
  MISSING_ITEMS: 'For missing items',
  ITEM_MISSING: 'For missing items',
  HALAL_CONCERN: 'After your halal concern was reviewed',
  NO_RIDER_FOUND: 'No rider could collect your order',
};

export const REFUND_APPENDED_NOTE = 'Added below the original receipt, which never changes.';

/** "After a review by our team. Added below the original receipt, which never changes." */
export function refundNote(reason: string): string {
  const line = (REFUND_REASON_LINE as Record<string, string | undefined>)[reason];
  return line ? `${line}. ${REFUND_APPENDED_NOTE}` : REFUND_APPENDED_NOTE;
}

/* ------------------------------------------------------------------ No receipt */

export type NoReceipt =
  /** DELIVERED (or earlier): the snapshot is written at COMPLETED. */
  | { kind: 'notReady' }
  /** DISPUTED/RESOLVED (or ended after capture) without `completed_at`: never issued. */
  | { kind: 'neverCompleted' }
  /** Never captured: nothing was charged. The second sentence depends on the hold. */
  | { kind: 'noCharge'; second: string };

export const NO_RECEIPT_COPY = {
  notReady: {
    title: "Your receipt isn't ready yet",
    description: "We issue it once your order is complete. We'll let you know when it's ready.",
  },
  neverCompleted: {
    title: "There's no receipt for this order",
    description:
      'It was reviewed before it was complete, so no receipt was issued. What you were charged and refunded is on the order page.',
  },
  noCharge: {
    title: 'No receipt for this order',
    first: "You weren't charged, so there is nothing to show.",
  },
} as const;

export const HOLD_RELEASED = "The hold on your card was released when the order didn't go ahead.";
export const PAYMENT_DIDNT_GO_THROUGH = "Your payment didn't go through, so nothing was charged.";
export const NOTHING_CHARGED = 'Nothing was charged.';

/**
 * Receipt-NoCharge annotation: the second sentence is chosen by `amount_authorized_cents`. Above 0
 * a hold existed and was released; 0 means no hold: a failed payment (FAILED, PAYMENT_EXPIRED)
 * says the payment didn't go through, a cancel before payment says nothing was charged.
 */
export function noChargeSecondSentence(
  amountAuthorizedCents: number,
  order: { state?: string | null; cancel_reason?: string | null } | null,
): string {
  if (amountAuthorizedCents > 0) return HOLD_RELEASED;
  if (order?.state === 'FAILED' || order?.cancel_reason === 'PAYMENT_EXPIRED' || order?.cancel_reason === 'CAPTURE_FAILED') {
    return PAYMENT_DIDNT_GO_THROUGH;
  }
  return NOTHING_CHARGED;
}

/**
 * Which "no receipt" page a 409 means. `payment` and `order` are whatever loaded (null when that
 * read failed); null back means the screen cannot tell and shows its error instead.
 */
export function chooseNoReceipt(
  order: { state: string; completed_at?: string | null; cancel_reason?: string | null } | null,
  payment: { amount_authorized_cents: number; amount_captured_cents: number } | null,
): NoReceipt | null {
  if (payment && payment.amount_captured_cents === 0) {
    return { kind: 'noCharge', second: noChargeSecondSentence(payment.amount_authorized_cents, order) };
  }
  if (!order) return null;
  if (order.completed_at) return { kind: 'notReady' };
  switch (order.state) {
    case 'DISPUTED':
    case 'RESOLVED':
      return { kind: 'neverCompleted' };
    case 'CANCELLED':
    case 'REJECTED':
    case 'FAILED':
      // Ended without completing. Whether money moved needs the payment; without it, say nothing.
      return payment ? { kind: 'neverCompleted' } : null;
    default:
      return { kind: 'notReady' };
  }
}
