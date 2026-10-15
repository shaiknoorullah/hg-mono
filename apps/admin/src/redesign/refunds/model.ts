/**
 * What the refund panel may send, which reasons it offers, and how it reads a refusal. No component
 * code here, so the rules that matter can be tested without a screen.
 *
 * Money rules this file holds (see the platform specification, section on refunds):
 * - The client never sends an amount except a goodwill refund, and sends that as whole cents. Every
 *   other amount is calculated by the server and only ever shown after the server has sent it.
 * - Nothing here subtracts one money figure from another. The only comparison is a typed goodwill
 *   amount against the payment's own captured total, which can say "certainly too much" and never
 *   "this much is left".
 */
import { cents, type Schema } from '@hg/api-client';
import type { HgApiError } from '@hg/api-client';

import type { StaffRole } from '../data/session';
import type { OrderState } from '../orders/labels';
import { asContract, isUuid } from '../orders/model';

type Order = Schema['OrderAdminView'];
export type RefundInput = Schema['AdminRefundInput'];
export type RefundReasonCode = Schema['RefundReasonCode'];
export type { StaffRole };

/** What the person picks. Goodwill is the contract's `PARTIAL_AMOUNT` scope with the `GOODWILL` reason. */
export type ScopeChoice = 'FULL' | 'PARTIAL_ITEMS' | 'GOODWILL';

export const MIN_REASON_TEXT = 10;
export const MAX_REASON_TEXT = 1000;

/* ── Reasons ─────────────────────────────────────────────────────────────────────────────── */

export interface ReasonInfo {
  readonly label: string;
  readonly group: 'Food' | 'Delivery' | 'Payment' | 'Halal' | 'Goodwill' | 'Dispute' | 'Other';
  readonly description: string;
  /** In words, from the server's liability rule. The page never calculates the split. */
  readonly bears: string;
}

const ITEM_NET = 'The restaurant bears the item’s net price; the platform bears the rest.';
const RIDER_NET = 'The rider’s earnings on this order are reversed; the platform bears the rest.';
const PLATFORM = 'The platform bears it.';

/** The reasons the staff form offers, in the order the board lists them. */
export const OFFERED_REASONS = {
  ITEM_MISSING: { label: 'Item missing', group: 'Food', description: 'One line didn’t arrive.', bears: ITEM_NET },
  MISSING_ITEMS: { label: 'Several items missing', group: 'Food', description: 'Two or more lines didn’t arrive.', bears: ITEM_NET },
  WRONG_ITEM: { label: 'Wrong item', group: 'Food', description: 'One line was swapped for something else.', bears: ITEM_NET },
  WRONG_ITEMS: { label: 'Several wrong items', group: 'Food', description: 'Two or more lines were swapped.', bears: ITEM_NET },
  FOOD_QUALITY: { label: 'Food quality', group: 'Food', description: 'Cold, undercooked or not as described.', bears: ITEM_NET },
  FOOD_SAFETY: { label: 'Food safety', group: 'Food', description: 'Unsafe to eat: foreign object, spoiled, allergen.', bears: ITEM_NET },
  DAMAGED_SPILLED: { label: 'Damaged or spilled', group: 'Food', description: 'Arrived crushed or leaking.', bears: PLATFORM },
  NEVER_DELIVERED: { label: 'Never delivered', group: 'Delivery', description: 'Marked delivered with no proof of delivery.', bears: RIDER_NET },
  ORDER_NEVER_ARRIVED: { label: 'Order never arrived', group: 'Delivery', description: 'The rider was at fault and it never reached the customer.', bears: RIDER_NET },
  DUPLICATE_CHARGE: { label: 'Duplicate charge', group: 'Payment', description: 'The card was charged twice for this order.', bears: PLATFORM },
  CHARGED_INCORRECTLY: { label: 'Charged incorrectly', group: 'Payment', description: 'The amount charged differs from the receipt.', bears: PLATFORM },
  PRICING_ERROR: { label: 'Pricing error', group: 'Payment', description: 'A menu price or a fee was wrong.', bears: PLATFORM },
  HALAL_CONCERN: {
    label: 'Halal concern',
    group: 'Halal',
    description: 'The customer has a concern about the halal status of the food, for example it wasn’t what the menu described. Opens a grievance for review.',
    bears: ITEM_NET,
  },
  PLATFORM_ERROR: { label: 'Platform error', group: 'Other', description: 'Our system got it wrong.', bears: PLATFORM },
  OTHER: { label: 'Other', group: 'Other', description: 'Explain in What happened.', bears: PLATFORM },
  GOODWILL: { label: 'Goodwill', group: 'Goodwill', description: 'A typed amount, as a gesture.', bears: PLATFORM },
  CHARGEBACK_PREEMPTIVE: { label: 'Before a chargeback', group: 'Dispute', description: 'Refunding to head off a card chargeback. Admin only.', bears: PLATFORM },
} as const satisfies Partial<Record<RefundReasonCode, ReasonInfo>>;

export type OfferedReason = keyof typeof OFFERED_REASONS;

/**
 * Every reason the contract has, and why the staff form does or does not offer it. Typed over the
 * contract's enum, so a new reason code fails the build until someone decides which it is.
 */
export const REASON_STATUS: Readonly<Record<RefundReasonCode, 'offered' | string>> = {
  ITEM_MISSING: 'offered',
  MISSING_ITEMS: 'offered',
  WRONG_ITEM: 'offered',
  WRONG_ITEMS: 'offered',
  FOOD_QUALITY: 'offered',
  FOOD_SAFETY: 'offered',
  DAMAGED_SPILLED: 'offered',
  NEVER_DELIVERED: 'offered',
  ORDER_NEVER_ARRIVED: 'offered',
  DUPLICATE_CHARGE: 'offered',
  CHARGED_INCORRECTLY: 'offered',
  PRICING_ERROR: 'offered',
  HALAL_CONCERN: 'offered',
  PLATFORM_ERROR: 'offered',
  OTHER: 'offered',
  GOODWILL: 'offered',
  CHARGEBACK_PREEMPTIVE: 'offered',
  HALAL_INTEGRITY: 'Packaging tamper is not offered: without the package seal nobody can tell who opened it.',
  DISPUTE_RESOLUTION: 'Resolving a dispute is a separate step, not drawn here; choosing it would record a settled dispute.',
  LATE_DELIVERY: 'Only offered for the fees-only scope, which the staff route does not have yet.',
  WRONG_ADDRESS: 'Not drawn on the board.',
  RESTAURANT_REJECTED: 'Set by the system when a restaurant rejects; a rejected order is never charged.',
  RESTAURANT_CANCELLED: 'Set by the system when a restaurant cancels.',
  NO_RIDER_FOUND: 'Set by the system when no rider is found.',
  PLATFORM_INITIATED_CANCELLATION: 'Set by the system when it cancels an order.',
  CUSTOMER_CHANGED_MIND: 'A customer reason, not offered to staff.',
};

const WHOLE: readonly OfferedReason[] = [
  'MISSING_ITEMS', 'WRONG_ITEMS', 'FOOD_QUALITY', 'FOOD_SAFETY', 'DAMAGED_SPILLED', 'NEVER_DELIVERED', 'ORDER_NEVER_ARRIVED',
  'DUPLICATE_CHARGE', 'CHARGED_INCORRECTLY', 'PRICING_ERROR', 'HALAL_CONCERN', 'PLATFORM_ERROR', 'OTHER',
];
const ITEMS: readonly OfferedReason[] = ['ITEM_MISSING', 'WRONG_ITEM', 'FOOD_QUALITY', 'FOOD_SAFETY', 'DAMAGED_SPILLED', 'HALAL_CONCERN', 'OTHER'];

/**
 * The reasons for a scope. "Before a chargeback" is offered only on a disputed order and only to
 * an admin. That second rule is the console's own: the server accepts the reason from every staff
 * role (it changes nothing about who bears the refund), so it is a display rule, not a protection.
 */
export function reasonsFor(scope: ScopeChoice, opts: { role: StaffRole | null; orderState: OrderState }): OfferedReason[] {
  if (scope === 'GOODWILL') return ['GOODWILL'];
  const base = [...(scope === 'FULL' ? WHOLE : ITEMS)];
  const admin = opts.role === 'ADMIN' || opts.role === 'SUPER_ADMIN';
  if (opts.orderState === 'DISPUTED' && admin) base.push('CHARGEBACK_PREEMPTIVE');
  return base;
}

/* ── Can this order be refunded at all? ──────────────────────────────────────────────────── */

export type Refundability =
  | { readonly kind: 'ok' }
  /** The authorisation was voided (rejected or cancelled before acceptance): never charged. */
  | { readonly kind: 'voided'; readonly why: 'rejected' | 'cancelled' | 'other' }
  | { readonly kind: 'payment-failed' }
  /** Authorised but not yet captured. A refund cannot exist: cancel instead. */
  | { readonly kind: 'nothing-captured' }
  | { readonly kind: 'fully-refunded' };

/**
 * Read from the payment the server sent. Capture happens when the restaurant accepts, so an
 * uncaptured order has nothing to refund. Fully refunded compares the payment's own two totals;
 * it does not work out what is left.
 */
export function refundability(order: Pick<Order, 'state' | 'payment'>): Refundability {
  const p = order.payment;
  if (p.state === 'CANCELED') {
    return { kind: 'voided', why: order.state === 'REJECTED' ? 'rejected' : order.state === 'CANCELLED' ? 'cancelled' : 'other' };
  }
  if (p.state === 'FAILED') return { kind: 'payment-failed' };
  if (p.amount_captured_cents <= 0) return { kind: 'nothing-captured' };
  if (p.amount_refunded_cents >= p.amount_captured_cents) return { kind: 'fully-refunded' };
  return { kind: 'ok' };
}

/** The key into the "nothing to refund" copy for an order that cannot be refunded. */
export function nothingKey(can: Exclude<Refundability, { kind: 'ok' }>): 'rejected' | 'cancelled' | 'voided' | 'payment-failed' | 'nothing-captured' | 'fully-refunded' {
  if (can.kind === 'voided') return can.why === 'rejected' ? 'rejected' : can.why === 'cancelled' ? 'cancelled' : 'voided';
  return can.kind;
}

/** Order states from which "Issue refund" is a visible button rather than a menu item. */
export const REFUND_BUTTON_STATES: readonly OrderState[] = ['DELIVERED', 'COMPLETED', 'DISPUTED', 'RESOLVED'];

/* ── The draft and what it sends ─────────────────────────────────────────────────────────── */

export interface RefundDraft {
  readonly scope: ScopeChoice;
  readonly reason: OfferedReason | '';
  readonly text: string;
  readonly caseId: string;
  /** Quantity to refund per order line number; absent or 0 means not selected. */
  readonly lines: Readonly<Record<number, number>>;
  /** Goodwill only: whole cents, or null when empty or unreadable. */
  readonly goodwillCents: number | null;
}

export const EMPTY_DRAFT: RefundDraft = { scope: 'FULL', reason: '', text: '', caseId: '', lines: {}, goodwillCents: null };

export function selectedLines(draft: Pick<RefundDraft, 'lines'>): Array<{ order_line_no: number; quantity: number }> {
  return Object.entries(draft.lines)
    .map(([no, quantity]) => ({ order_line_no: Number(no), quantity }))
    .filter((l) => Number.isInteger(l.quantity) && l.quantity > 0)
    .sort((a, b) => a.order_line_no - b.order_line_no);
}

/**
 * The request body. `amount_cents` appears only for goodwill; for every other scope the key is
 * absent, because the contract answers an amount there with an unknown-field error.
 */
export function buildRefundInput(orderId: string, d: RefundDraft): RefundInput {
  const base = {
    order_id: orderId,
    reason_code: d.scope === 'GOODWILL' ? 'GOODWILL' : (d.reason as RefundReasonCode),
    reason_text: d.text.trim(),
    ...(isUuid(d.caseId) ? { case_id: d.caseId.trim() } : {}),
  } as const;
  if (d.scope === 'GOODWILL') {
    if (d.goodwillCents === null) throw new Error('A goodwill refund needs an amount in whole cents.');
    return { ...base, scope: 'PARTIAL_AMOUNT', amount_cents: cents(d.goodwillCents) };
  }
  if (d.scope === 'PARTIAL_ITEMS') return { ...base, scope: 'PARTIAL_ITEMS', line_items: selectedLines(d) };
  return { ...base, scope: 'FULL' };
}

export interface DraftErrors {
  reason?: string;
  text?: string;
  items?: string;
  amount?: string;
  caseId?: string;
}

/** Checked before anything is sent, so a refusal here means nothing was sent. */
export function checkDraft(d: RefundDraft, order: Pick<Order, 'payment'>, opts: { amountUnreadable?: boolean } = {}): DraftErrors {
  const errors: DraftErrors = {};
  if (d.scope !== 'GOODWILL' && d.reason === '') errors.reason = 'Choose what went wrong.';
  if (d.text.trim().length < MIN_REASON_TEXT) errors.text = `Write at least ${MIN_REASON_TEXT} characters about what happened.`;
  if (d.scope === 'PARTIAL_ITEMS' && selectedLines(d).length === 0) errors.items = 'Choose at least one item to refund.';
  if (d.scope === 'GOODWILL') {
    if (opts.amountUnreadable) errors.amount = 'Enter dollars and cents, like 12.35. Amounts go in whole cents.';
    else if (d.goodwillCents === null) errors.amount = 'Enter the amount to refund.';
    else if (d.goodwillCents <= 0) errors.amount = 'The amount must be more than zero.';
    else if (d.goodwillCents > order.payment.amount_captured_cents) errors.amount = 'That is more than was captured on this order.';
  }
  if (d.caseId.trim() !== '' && !isUuid(d.caseId)) errors.caseId = 'A case id looks like 0192a4c1-5e7b-7a10-b3c2-9d4e8f117d20.';
  return errors;
}

export const hasErrors = (e: DraftErrors) => Object.keys(e).length > 0;

/* ── Reading a refusal ───────────────────────────────────────────────────────────────────── */

export type Refusal =
  | { readonly kind: 'mfa-required' }
  | { readonly kind: 'forbidden'; readonly message: string }
  | { readonly kind: 'exceeds-captured' }
  | { readonly kind: 'already-requested'; readonly lineNos: number[]; readonly fees: boolean }
  | { readonly kind: 'not-refundable' }
  | { readonly kind: 'daily-cap' }
  | { readonly kind: 'self-approval' }
  | { readonly kind: 'key-reused' }
  | { readonly kind: 'invalid'; readonly message: string }
  | { readonly kind: 'rate-limited'; readonly retryAfterSeconds: number | null }
  | { readonly kind: 'other'; readonly status: number; readonly message: string };

/** Branches on the error code, never on its message. */
export function classifyRefusal(err: HgApiError): Refusal {
  const details = asContract<{ order_line_nos?: unknown; fees?: unknown; retry_after_seconds?: unknown } | undefined>(err.details);
  switch (err.code) {
    case 'MFA_REQUIRED':
      return { kind: 'mfa-required' };
    case 'REFUND_EXCEEDS_CAPTURED':
      return { kind: 'exceeds-captured' };
    case 'REFUND_ALREADY_REQUESTED':
      return {
        kind: 'already-requested',
        lineNos: Array.isArray(details?.order_line_nos) ? details.order_line_nos.filter((n): n is number => typeof n === 'number') : [],
        fees: details?.fees === true,
      };
    case 'PAYMENT_NOT_REFUNDABLE':
      return { kind: 'not-refundable' };
    case 'DAILY_CAP_EXCEEDED':
      return { kind: 'daily-cap' };
    case 'SELF_APPROVAL_FORBIDDEN':
      return { kind: 'self-approval' };
    case 'IDEMPOTENCY_KEY_REUSE':
      return { kind: 'key-reused' };
    default:
  }
  if (err.status === 403) return { kind: 'forbidden', message: err.message };
  if (err.status === 422) return { kind: 'invalid', message: err.message };
  if (err.status === 429) {
    const s = details?.retry_after_seconds;
    return { kind: 'rate-limited', retryAfterSeconds: typeof s === 'number' ? s : null };
  }
  return { kind: 'other', status: err.status, message: err.message };
}
