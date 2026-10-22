/**
 * What the delivered and completed order page says, worked out from the server's order and
 * refunds. Pure functions, no React: the screen draws what these return.
 *
 * Rules this file holds:
 * - **The handover line is what the customer asked for.** The order carries the requested delivery
 *   instructions, not how the rider actually handed it over (no contract field yet), so the line
 *   always starts "You asked", never "Left at your door".
 * - **No halal badge after delivery.** The restaurant's halal state is its state now, not at order
 *   time, so this page never draws one (silence on the past, never an optimistic claim).
 * - **Money is a server field.** "Charged" is the payment record's `amount_captured_cents`; a refund
 *   row shows whenever the order has one, and nothing is subtracted on the phone.
 * - **No rating action.** Rating an order is a later release.
 */
import type { Schema } from '@hg/api-client';

import { formatTime } from '../lib/time';
import { refundView } from '../orders/format';
import { primaryRefund } from './outcomeView';
import { meetOf } from './trackingView';

type Order = Schema['OrderCustomerView'];
type Refund = Schema['Refund'];

/** The order states this page draws. An order that ended without a delivery is the outcome screen. */
export const isDeliveredState = (state: string): boolean => state === 'DELIVERED' || state === 'COMPLETED';

/** The three lines of the page heading and what a screen reader says for them. */
export interface DeliveredHeading {
  /** The small line above the heading, or null. */
  overline: string | null;
  /** The large line. */
  display: string;
  /** What a screen reader says for the whole heading (the visible lines are hidden from it). */
  spoken: string;
  /** The line under the heading, or null. */
  line: string | null;
}

/** The delivery time the page quotes: the order's own stamp, else the state's own start. */
function deliveredAtOf(order: Order): string | null {
  return order.delivered_at ?? (order.state === 'DELIVERED' ? (order.state_since ?? null) : null);
}

/** What the customer asked for at the door, in words. */
export function handoverLineOf(order: Pick<Order, 'delivery_instructions'>): string {
  const meet = meetOf(order.delivery_instructions);
  if (meet === 'door') return 'You asked to meet at the door.';
  if (meet === 'lobby') return 'You asked to meet in the lobby.';
  return order.delivery_instructions?.includes('DO_NOT_RING_BELL')
    ? 'You asked us to leave it at the door and not ring the bell.'
    : 'You asked us to leave it at the door.';
}

/** The heading for a delivered or completed order. */
export function deliveredHeadingOf(order: Order): DeliveredHeading {
  const at = deliveredAtOf(order);
  const time = at ? formatTime(at) : null;
  if (order.state === 'COMPLETED') {
    return {
      overline: time ? `Delivered at ${time}` : 'Delivered',
      display: 'Order complete',
      spoken: time ? `Order complete, delivered at ${time}` : 'Order complete, delivered',
      line: null,
    };
  }
  return {
    overline: time ? 'Delivered' : null,
    display: time ? `At ${time}` : 'Delivered',
    spoken: time ? `Delivered at ${time}` : 'Delivered',
    line: handoverLineOf(order),
  };
}

/** A refund as the money card words it. */
export interface DeliveredRefundRow {
  /** "Refund", or "Your report" while the request has no decision. */
  label: string;
  badge: string;
  /** Neutral once there is nothing more to wait for; info while the money is still moving. */
  tone: 'info' | 'neutral';
  /** The line under the badge. */
  line: string;
  /** The refund's own amount, or null where none is shown (under review, not approved, withdrawn). */
  cents: Refund['amount_cents'] | null;
}

const REPORT_STATES: ReadonlySet<string> = new Set(['REQUESTED', 'PENDING_APPROVAL', 'DECLINED']);
/** Refund states in which money is still on its way (or late): the info badge. */
const MOVING_STATES: ReadonlySet<string> = new Set(['APPROVED', 'AUTHORISED', 'SUBMITTED', 'FAILED']);

/** One refund as the order page words it (the receipt's refund wording, verbatim). `card` is "Visa •••• 4242" or null. */
export function deliveredRefundRowOf(refund: Refund, card: string | null): DeliveredRefundRow {
  const view = refundView(refund, card);
  return {
    label: REPORT_STATES.has(refund.state) ? 'Your report' : 'Refund',
    badge: view.badge,
    tone: MOVING_STATES.has(refund.state) ? 'info' : 'neutral',
    line: view.line,
    cents: view.showAmount ? refund.amount_cents : null,
  };
}

/** The refund row for the order's refunds, or null with none. */
export function refundRowFor(refunds: readonly Refund[], card: string | null): DeliveredRefundRow | null {
  const refund = primaryRefund(refunds);
  return refund ? deliveredRefundRowOf(refund, card) : null;
}

/** The buttons this page can draw. */
export type DeliveredAction = 'viewReceipt' | 'getHelp';

/** The buttons for an order state, and the line under them. */
export interface DeliveredActions {
  /** Buttons in order; the first is the primary. */
  actions: DeliveredAction[];
  /** The line under the buttons, or null. */
  note: string | null;
}

/**
 * The receipt is written once at COMPLETED, so "View receipt" appears only then. Until it does,
 * Get help is the one action (secondary: nothing here needs doing) and the page says a receipt is coming.
 */
export function deliveredActionsOf(order: Pick<Order, 'state'>): DeliveredActions {
  return order.state === 'COMPLETED'
    ? { actions: ['viewReceipt', 'getHelp'], note: null }
    : { actions: ['getHelp'], note: "We'll add your receipt here when the order is complete, and let you know." };
}
