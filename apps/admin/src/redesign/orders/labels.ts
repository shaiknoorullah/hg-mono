/**
 * The one state-label map for every order surface (`ORD/StateCatalogue`): the label, badge tone and
 * icon for each member of each enum an order can show. The grid, the workspace, the refund rows and
 * the ledger all read from here, so a word never differs between two screens.
 *
 * Every map is typed `Record<Enum, …>` over the generated contract type, so a new enum value is a
 * compile error here, and `__tests__/labels.test.ts` also walks the contract's own enum lists.
 *
 * Halal is the one family that is NOT a plain badge map: a missing halal field renders no badge,
 * EXPIRED is cool slate ("we can't currently vouch"), and nothing halal is ever red. Those words
 * live in the `HalalBadge` component; here is only the plain text for a missing status.
 */
import type { Schema } from '@hg/api-client';

import type { AnyIconName, BadgeProps } from '../ds';

export type OrderState = Schema['OrderState'];
export type PaymentState = Schema['PaymentState'];
export type DispatchState = Schema['DispatchState'];
export type RefundState = Schema['RefundState'];
export type LedgerAccount = Schema['LedgerAccount'];
export type LedgerComponent = Schema['LedgerComponent'];
export type LedgerBatchKind = NonNullable<Schema['LedgerEntry']['batch_kind']>;
export type CancelReason = Schema['OrderCancellationReasonCode'];
export type ChargebackStatus = Schema['ChargebackStatus'];

export interface StateLabel {
  readonly label: string;
  readonly tone: NonNullable<BadgeProps['variant']>;
  readonly icon: AnyIconName;
}

/** FAILED is the only danger tone, and it is a payment or order failure, never a halal ruling. */
export const ORDER_STATE: Readonly<Record<OrderState, StateLabel>> = {
  CREATED: { label: 'Created', tone: 'neutral', icon: 'clock' },
  AUTHORIZED: { label: 'Payment authorised', tone: 'neutral', icon: 'clock' },
  RESTAURANT_PENDING: { label: 'Waiting for restaurant', tone: 'info', icon: 'clock' },
  PREPARING: { label: 'Preparing', tone: 'info', icon: 'orders' },
  READY_FOR_PICKUP: { label: 'Ready for pickup', tone: 'info', icon: 'orders' },
  PICKED_UP: { label: 'Picked up', tone: 'info', icon: 'map' },
  ARRIVED: { label: 'Rider arrived', tone: 'info', icon: 'map' },
  DELIVERED: { label: 'Delivered', tone: 'neutral', icon: 'check' },
  COMPLETED: { label: 'Completed', tone: 'neutral', icon: 'check' },
  CANCELLED: { label: 'Cancelled', tone: 'outline', icon: 'close' },
  REJECTED: { label: 'Rejected by restaurant', tone: 'outline', icon: 'close' },
  FAILED: { label: 'Failed', tone: 'danger', icon: 'error' },
  DISPUTED: { label: 'Disputed', tone: 'warning', icon: 'warning' },
  RESOLVED: { label: 'Resolved', tone: 'neutral', icon: 'check' },
};

export const PAYMENT_STATE: Readonly<Record<PaymentState, StateLabel>> = {
  REQUIRES_PAYMENT_METHOD: { label: 'Needs a payment method', tone: 'neutral', icon: 'clock' },
  REQUIRES_CONFIRMATION: { label: 'Waiting for confirmation', tone: 'neutral', icon: 'clock' },
  REQUIRES_ACTION: { label: 'Customer confirming (3-D Secure)', tone: 'warning', icon: 'clock' },
  PROCESSING: { label: 'Processing', tone: 'info', icon: 'clock' },
  REQUIRES_CAPTURE: { label: 'Authorised, not captured', tone: 'info', icon: 'lock' },
  SUCCEEDED: { label: 'Captured', tone: 'neutral', icon: 'check' },
  CANCELED: { label: 'Authorisation voided', tone: 'outline', icon: 'close' },
  FAILED: { label: 'Payment failed', tone: 'danger', icon: 'error' },
};

export const REFUND_STATE: Readonly<Record<RefundState, StateLabel>> = {
  REQUESTED: { label: 'Requested', tone: 'neutral', icon: 'clock' },
  PENDING_APPROVAL: { label: 'Awaiting approval', tone: 'warning', icon: 'clock' },
  APPROVED: { label: 'Approved', tone: 'info', icon: 'check' },
  AUTHORISED: { label: 'Authorised', tone: 'info', icon: 'check' },
  SUBMITTED: { label: 'Sent to provider', tone: 'info', icon: 'clock' },
  SUCCEEDED: { label: 'Provider confirmed', tone: 'neutral', icon: 'check' },
  SETTLED: { label: 'Settled', tone: 'neutral', icon: 'check' },
  FAILED: { label: 'Failed, no money moved', tone: 'danger', icon: 'error' },
  DECLINED: { label: 'Declined', tone: 'outline', icon: 'close' },
  CANCELLED: { label: 'Cancelled', tone: 'outline', icon: 'close' },
};

/** What dispatch is doing, in a sentence. `null` dispatch reads "No dispatch yet". */
export const DISPATCH_STATE: Readonly<Record<DispatchState, string>> = {
  PENDING: 'Waiting to start the search',
  SEARCHING: 'Searching for a rider',
  OFFERED: 'Offered to a rider, waiting for an answer',
  ASSIGNED: 'Rider assigned, heading to the restaurant',
  AT_RESTAURANT: 'Rider at the restaurant',
  CARRYING: 'Rider has the order, on the way',
  AT_CUSTOMER: 'Rider at the delivery address',
  COMPLETED: 'Delivery completed',
  UNASSIGNED: 'The rider dropped the order. Searching again.',
  NO_RIDER_FOUND: 'No rider found after 3 searches',
};
export const NO_DISPATCH = 'No dispatch yet';

/** Tax postings stay labelled pending while HST registration is open. */
export const LEDGER_ACCOUNT: Readonly<Record<LedgerAccount, string>> = {
  CUSTOMER_CHARGES: 'Customer charges',
  PSP_CLEARING: 'Provider clearing',
  PSP_FEES: 'Provider fees',
  RESTAURANT_PAYABLE: 'Restaurant payable',
  RIDER_PAYABLE: 'Rider payable',
  PLATFORM_REVENUE: 'Platform revenue',
  TAX_PAYABLE: 'Tax payable (pending HST decision)',
  PROMO_EXPENSE: 'Promotion expense',
  REFUNDS: 'Refunds',
  PLATFORM_ABSORBED: 'Platform absorbed',
};

export const LEDGER_COMPONENT: Readonly<Record<LedgerComponent, string>> = {
  SUBTOTAL: 'Subtotal',
  COMMISSION: 'Commission',
  DELIVERY_FEE: 'Delivery fee',
  SERVICE_FEE: 'Service fee',
  TAX: 'Tax (pending HST decision)',
  TIP: 'Tip',
  DISCOUNT: 'Discount',
  PSP_FEE: 'Provider fee',
  REFUND: 'Refund',
};

export const LEDGER_BATCH_KIND: Readonly<Record<LedgerBatchKind, string>> = {
  CAPTURE: 'Capture',
  SETTLE: 'Settlement',
  REFUND: 'Refund',
  PAYOUT: 'Payout',
  ADJUSTMENT: 'Adjustment',
  PSP_FEE: 'Provider fee',
};

/** Plain text where a restaurant has no halal status on file: no badge, never an optimistic one. */
export const NO_HALAL_IN_GRID = 'No status on file';
export const NO_HALAL_IN_DETAIL = 'No halal status on file';

/**
 * Who or what cancelled. The five the system sets itself are never offered to staff; the labels are
 * here so a system cancel can name the rule that fired.
 */
export const CANCEL_REASON: Readonly<Record<CancelReason, string>> = {
  CUSTOMER_CANCELLED: 'Customer asked to cancel',
  RESTAURANT_TIMEOUT: 'Restaurant didn’t answer',
  RESTAURANT_CLOSED: 'Restaurant closed',
  ITEM_UNAVAILABLE: 'Item unavailable',
  CAPTURE_FAILED: 'Capture failed',
  PAYMENT_EXPIRED: 'Payment expired',
  PREP_OVERDUE: 'Preparation overdue',
  NO_RIDER_FOUND: 'No rider found',
  SUPPORT_CANCELLED: 'Cancelled by support',
  FRAUD_SUSPECTED: 'Fraud suspected',
  PLATFORM_ERROR: 'Platform error',
};

/** The reasons staff may pick, in the order the board lists them. No rider found only when dispatch says so. */
export const STAFF_CANCEL_REASONS: readonly CancelReason[] = [
  'CUSTOMER_CANCELLED',
  'RESTAURANT_CLOSED',
  'ITEM_UNAVAILABLE',
  'SUPPORT_CANCELLED',
  'FRAUD_SUSPECTED',
  'PLATFORM_ERROR',
];

export const CHARGEBACK_STATUS: Readonly<Record<ChargebackStatus, string>> = {
  WARNING_NEEDS_RESPONSE: 'Early warning, needs a response',
  WARNING_UNDER_REVIEW: 'Early warning, under review',
  WARNING_CLOSED: 'Early warning, closed',
  NEEDS_RESPONSE: 'Needs a response',
  UNDER_REVIEW: 'Under review',
  WON: 'Won',
  LOST: 'Lost',
  PREVENTED: 'Prevented',
  CHARGE_REFUNDED: 'Charge refunded',
};

export type MoneyEventKind = Schema['MoneyEventKind'];
export type OrderActorKind = Schema['OrderActorKind'];

export const MONEY_EVENT: Readonly<Record<MoneyEventKind, string>> = {
  PAYMENT_AUTHORISED: 'Payment authorised',
  PAYMENT_CAPTURED: 'Payment captured',
  PAYMENT_VOIDED: 'Authorisation voided',
  REFUND_REQUESTED: 'Refund requested',
  REFUND_ESCALATED: 'Refund sent for approval',
  REFUND_APPROVED: 'Refund approved',
  REFUND_DECLINED: 'Refund declined',
  REFUND_SUBMITTED: 'Refund sent to provider',
  REFUND_SUCCEEDED: 'Refund confirmed by provider',
  REFUND_FAILED: 'Refund failed',
  REFUND_SET_ASIDE: 'Refund set aside',
  CHARGEBACK_OPENED: 'Card chargeback opened',
  CHARGEBACK_UPDATED: 'Card chargeback updated',
  CHARGEBACK_EVIDENCE_NOTE: 'Chargeback evidence note added',
  CHARGEBACK_CLOSED: 'Card chargeback closed',
};

export const ACTOR: Readonly<Record<OrderActorKind, string>> = {
  CUSTOMER: 'Customer',
  RESTAURANT: 'Restaurant',
  RIDER: 'Rider',
  SUPPORT: 'Support',
  ADMIN: 'Admin',
  SYSTEM: 'System',
};
