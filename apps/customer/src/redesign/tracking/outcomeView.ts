/**
 * What the order outcome screen says, worked out from the server's order, payment, refunds and
 * timeline. Pure functions, no React: the screen draws what these return.
 *
 * Rules this file holds (each is one the previous system broke):
 * - **Money is a server field.** Nothing here adds, subtracts or compares amounts. Whether a refund
 *   is "part" or "all" of the order comes from the refund's own `scope`, not from arithmetic.
 * - **Voided is not refunded.** An order that ended before the restaurant accepted had its
 *   authorisation voided ([authorise then capture](https://github.com/shaiknoorullah/hg-mono/blob/main/AGENTS.md#3-non-negotiable-invariants)),
 *   so there is no refund to wait for and the screen never tells the customer to expect one.
 * - **A refund request is not a decision.** A refund that is still under review shows no amount and
 *   no promise; a declined one says "Not approved"; a failed one says "Refund in progress", never
 *   "Refunded" and never an error colour.
 * - **No cause the server did not give.** A review opened by our team says so; the screen does not
 *   guess why.
 */
import type { Schema } from '@hg/api-client';

import { formatDate, formatTime } from '../lib/time';
import { refundView } from '../orders/format';

type Order = Schema['OrderCustomerView'];
type Payment = Schema['OrderPayment'];
type Refund = Schema['Refund'];
type Transition = Schema['OrderTransition'];

/** The order states this screen draws. Delivered and completed orders are another screen. */
const OUTCOME_STATES: ReadonlySet<string> = new Set(['CANCELLED', 'REJECTED', 'FAILED', 'DISPUTED', 'RESOLVED']);
export const isOutcomeState = (state: string): boolean => OUTCOME_STATES.has(state);

export type OutcomeAction =
  /** Re-adds each line of the order to the cart; the server prices them again. */
  | 'putBack'
  | 'findRestaurant'
  | 'restaurantMenu'
  | 'checkAddress'
  | 'backToOrders'
  | 'done'
  | 'viewReceipt'
  | 'callUs';

export interface Outcome {
  icon: 'info' | 'clock';
  /** The small "Under review" badge above the heading, or null. */
  badge: string | null;
  title: string;
  /** Paragraphs under the heading, in order. */
  lead: string[];
  /** Whether the money card's refund rows are drawn at all. */
  money: 'card';
  /** The timeline card under the heading (disputed orders only). */
  timeline: boolean;
  /** Buttons, first is the primary. */
  actions: OutcomeAction[];
  /** The line under the primary button ("We'll check each item and its price again."), or null. */
  actionNote: string | null;
}

function clock(order: Order): string {
  return order.state_since ? formatTime(order.state_since) : '';
}

function at(order: Order): string {
  const t = clock(order);
  return t ? ` at ${t}` : '';
}

/* --------------------------------------------------------------------------------- money */

export interface RefundRow {
  /** "Refund", "Refunded on 30 September 2026". */
  label: string;
  /** Null where no amount is shown (under review, not approved, withdrawn). */
  cents: Refund['amount_cents'] | null;
  badge: string | null;
  line: string | null;
}

/** The newest refund that still holds a claim; else the newest of any state. */
export function primaryRefund(refunds: readonly Refund[]): Refund | null {
  const newest = (list: readonly Refund[]) =>
    [...list].sort((a, b) => Date.parse(b.requested_at) - Date.parse(a.requested_at))[0] ?? null;
  const holding = refunds.filter((r) => r.state !== 'DECLINED' && r.state !== 'CANCELLED');
  return newest(holding) ?? newest(refunds);
}

/** One refund as the money card words it. `card` is "Visa •••• 4242" or null. */
export function refundRowOf(refund: Refund, card: string | null): RefundRow {
  const view = refundView(refund, card);
  switch (refund.state) {
    case 'SUCCEEDED':
    case 'SETTLED':
      return {
        label: refund.settled_at ? `Refunded on ${formatDate(refund.settled_at)}` : 'Refunded',
        cents: refund.amount_cents,
        badge: null,
        line: null,
      };
    case 'APPROVED':
    case 'AUTHORISED':
    case 'SUBMITTED':
      return { label: 'Refund', cents: refund.amount_cents, badge: 'On its way to your card', line: "We'll let you know when it reaches your card." };
    case 'FAILED':
      return {
        label: 'Refund',
        cents: refund.amount_cents,
        badge: 'Refund in progress',
        line: "This is taking longer than usual. Our team is on it, and we'll let you know when it reaches your card.",
      };
    case 'DECLINED':
      return { label: 'Refund', cents: null, badge: 'Not approved', line: null };
    case 'CANCELLED':
      return { label: 'Refund', cents: null, badge: 'Withdrawn', line: null };
    default:
      // Requested, pending approval, or a state this build does not know: in progress, no amount.
      return { label: 'Refund', cents: null, badge: view.badge, line: view.line };
  }
}

/** Whether the card was ever authorised: a voided hold may read zero afterwards, `authorized_at` stays. */
export function wasAuthorised(payment: Payment): boolean {
  return Boolean(payment.authorized_at) || payment.amount_authorized_cents > 0;
}

export type MoneyRows =
  | { kind: 'unread' }
  | {
      kind: 'read';
      /** "Hold on Visa •••• 4242, released" with the held amount, or null. */
      hold: { label: string; cents: Payment['amount_authorized_cents'] } | null;
      charged: { label: string; cents: Payment['amount_captured_cents'] };
      refund: RefundRow | null;
      /** The line about the bank's statement, only with a released hold. */
      bankNote: string | null;
      /** Said when money was taken and no refund exists yet. */
      noRefundYet: boolean;
    };

/**
 * The "Your money" card from the server's payment record. With no payment read the card says so
 * and offers a retry; it never guesses an amount from the order.
 */
export function moneyOf(
  payment: Payment | null,
  refunds: readonly Refund[],
  card: string | null,
  /** The order's own total, the amount that was held when the payment record no longer carries one. */
  orderTotal: Payment['amount_authorized_cents'],
): MoneyRows {
  if (!payment) return { kind: 'unread' };
  const captured = payment.amount_captured_cents;
  const took = captured > 0;
  const voided = payment.state === 'CANCELED';
  const held = wasAuthorised(payment) && !took;
  const refund = primaryRefund(refunds);
  return {
    kind: 'read',
    hold: held
      ? { label: `Hold on ${card ?? 'your card'}${voided ? ', released' : ''}`, cents: payment.amount_authorized_cents > 0 ? payment.amount_authorized_cents : orderTotal }
      : null,
    charged: { label: took ? `Charged to ${card ?? 'your card'}` : 'Charged', cents: captured },
    refund: refund ? refundRowOf(refund, card) : null,
    bankNote: held && voided ? 'Your bank may take a few days to remove the hold from your statement.' : null,
    noRefundYet: took && !refund,
  };
}

/* --------------------------------------------------------------------------------- copy */

const REJECTED_LEAD: Record<string, string> = {
  ITEM_UNAVAILABLE: 'Something you ordered has run out.',
  ADDRESS_OUT_OF_RANGE: 'Your address is too far for them.',
  KITCHEN_AT_CAPACITY: 'Their kitchen is too busy right now.',
  CLOSING_SOON: "They're about to close.",
  EQUIPMENT_FAILURE: "Their equipment isn't working right now.",
};

const FAILED_LEAD: Record<string, string> = {
  card_declined: 'Your bank declined this card, so the order didn\'t go ahead.',
  insufficient_funds: "This card didn't have enough available, so the order didn't go ahead.",
  expired_card: 'This card has expired, so the order didn\'t go ahead.',
  incorrect_cvc: "The security code didn't match, so the order didn't go ahead.",
  authentication_failed: "Your bank didn't confirm the payment, so the order didn't go ahead.",
};
const FAILED_DEFAULT = "Your bank refused the payment, so the order didn't go ahead.";

function sentence(parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

function rejected(order: Order, noCharge: boolean): Outcome {
  const name = order.restaurant.name;
  const reason = order.reject_reason ?? null;
  const why = reason ? REJECTED_LEAD[reason] : null;
  const lead = sentence([why, noCharge && "You weren't charged."]);
  const itemGone = reason === 'ITEM_UNAVAILABLE';
  return {
    icon: 'info',
    badge: null,
    title: `${name} couldn't take your order`,
    lead: lead ? [lead] : [],
    money: 'card',
    timeline: false,
    actions: itemGone
      ? ['putBack', 'restaurantMenu', 'backToOrders']
      : reason === 'ADDRESS_OUT_OF_RANGE'
        ? ['checkAddress', 'backToOrders']
        : ['findRestaurant', 'backToOrders'],
    actionNote: itemGone ? 'The item that ran out shows as unavailable in your cart.' : null,
  };
}

function cancelled(order: Order, payment: Payment | null, noCharge: boolean): Outcome {
  const name = order.restaurant.name;
  const reason = order.cancel_reason ?? null;
  const base = { icon: 'info' as const, badge: null, money: 'card' as const, timeline: false };
  const nothing = noCharge && "You weren't charged.";
  switch (reason) {
    case 'CUSTOMER_CANCELLED': {
      const unpaid = payment !== null && !wasAuthorised(payment);
      const when = order.accepted_at ? '' : `, before ${name} accepted it`;
      return {
        ...base,
        title: 'Order cancelled',
        lead: [unpaid ? `You cancelled this order${at(order)}, before any payment was taken.` : `You cancelled this order${at(order)}${when}.`],
        actions: ['findRestaurant', 'putBack', 'backToOrders'],
        actionNote: null,
      };
    }
    case 'RESTAURANT_TIMEOUT':
      return {
        ...base,
        icon: 'clock',
        title: `${name} didn't respond in time`,
        lead: [`They didn't accept in time, so we cancelled your order${at(order)}.`],
        actions: ['findRestaurant', 'backToOrders'],
        actionNote: null,
      };
    case 'RESTAURANT_CLOSED':
      return {
        ...base,
        title: `${name} stopped taking orders`,
        lead: [sentence([`They closed just before your order reached them, so we cancelled it${at(order)}.`, nothing])],
        actions: ['findRestaurant', 'backToOrders'],
        actionNote: null,
      };
    case 'ITEM_UNAVAILABLE':
      return {
        ...base,
        title: `${name} couldn't take your order`,
        lead: [sentence(['Something you ordered has run out.', nothing])],
        actions: ['putBack', 'restaurantMenu', 'backToOrders'],
        actionNote: 'The item that ran out shows as unavailable in your cart.',
      };
    case 'CAPTURE_FAILED':
      return {
        ...base,
        title: "We couldn't take payment",
        lead: [`${name} accepted, but your bank refused the charge, so we cancelled the order${at(order)} before it was cooked.`],
        actions: ['putBack', 'backToOrders'],
        actionNote: "We'll check each item and its price again.",
      };
    case 'PAYMENT_EXPIRED':
      return {
        ...base,
        icon: 'clock',
        title: "The bank check wasn't finished",
        lead: [
          sentence([
            order.state_since
              ? `The check with your bank wasn't finished by ${clock(order)}, so this order was closed.`
              : "The check with your bank wasn't finished in time, so this order was closed.",
            noCharge && 'Nothing was charged.',
          ]),
        ],
        actions: ['putBack', 'backToOrders'],
        actionNote: "We'll check each item and its price again.",
      };
    case 'NO_RIDER_FOUND':
      return {
        ...base,
        title: "We couldn't find a rider",
        lead: [`Your food was ready, but no rider could collect it. We cancelled the order${at(order)}. We're sorry.`],
        actions: ['findRestaurant', 'backToOrders'],
        actionNote: null,
      };
    case 'PREP_OVERDUE':
      return {
        ...base,
        title: 'Your order was cancelled',
        lead: [`${name} couldn't finish your order in time, so we cancelled it${at(order)}. We're sorry.`],
        actions: ['findRestaurant', 'backToOrders'],
        actionNote: null,
      };
    case 'SUPPORT_CANCELLED':
      return {
        ...base,
        title: 'Your order was cancelled',
        lead: [`Our support team cancelled this order${at(order)}. We're sorry.`],
        actions: ['findRestaurant', 'backToOrders'],
        actionNote: null,
      };
    case 'FRAUD_SUSPECTED':
      // Never an accusation.
      return {
        ...base,
        title: 'Your order was cancelled',
        lead: [`We had to cancel this order${at(order)}.`],
        actions: ['findRestaurant', 'backToOrders'],
        actionNote: null,
      };
    default:
      return { ...base, title: 'Order cancelled', lead: [], actions: ['findRestaurant', 'backToOrders'], actionNote: null };
  }
}

/** The review's start: the last transition into DISPUTED, with the state it came from. */
export function disputeOf(timeline: readonly Transition[] | null | undefined): Transition | null {
  const into = (timeline ?? []).filter((t) => t.to_state === 'DISPUTED');
  return into.length ? into[into.length - 1]! : null;
}

function disputed(order: Order, timeline: readonly Transition[] | null | undefined): Outcome {
  const name = order.restaurant.name;
  const opened = disputeOf(timeline);
  const from = opened?.from_state ?? null;
  const by = order.deadline_at ? `${formatDate(order.deadline_at)}, ${formatTime(order.deadline_at)}` : null;
  const base = { icon: 'info' as const, badge: 'Under review', money: 'card' as const, timeline: true };

  if (from === 'PREPARING' || from === 'READY_FOR_PICKUP') {
    return {
      ...base,
      title: `${name} can't finish your order`,
      lead: ["This order won't be delivered. We're sorry.", by ? `Our team will tell you what happens by ${by}.` : 'Our team will tell you what happens.'],
      actions: ['backToOrders', 'findRestaurant', 'callUs'],
      actionNote: null,
    };
  }
  if (from === 'PICKED_UP' || from === 'ARRIVED') {
    return {
      ...base,
      title: "We're looking into your delivery",
      lead: [
        by ? `Your order may not reach you. We'll tell you what happens by ${by}.` : 'Your order may not reach you.',
        'Something went wrong while your order was on its way, and our team has stepped in.',
      ],
      actions: ['callUs', 'backToOrders'],
      actionNote: null,
    };
  }
  const who = opened?.actor_kind;
  const t = opened ? ` at ${formatTime(opened.at)}` : '';
  const opening =
    who === 'SUPPORT' || who === 'ADMIN'
      ? `Our team opened a review of this order${t}. A person is checking the order's records.`
      : who === 'RESTAURANT'
        ? `${name} asked us to review this order${t}.`
        : `A review of this order was opened${t}.`;
  return {
    ...base,
    title: "We're looking into this",
    lead: [opening, ...(by ? [`We'll get back to you by ${by}.`] : []), 'If you still have the packaging, please keep it until then.'],
    actions: ['backToOrders'],
    actionNote: "We'll let you know as soon as there's news.",
  };
}

function resolved(order: Order, refunds: readonly Refund[]): Outcome {
  const refund = primaryRefund(refunds);
  let said = 'Our team has finished its review.';
  if (refund) {
    if (refund.state === 'DECLINED') said = "Our team has finished its review and didn't issue a refund.";
    else if (refund.state !== 'CANCELLED') {
      const whole = (refund.scope ?? refund.kind) === 'FULL';
      said = whole
        ? 'Our team has finished its review and refunded your order.'
        : 'Our team has finished its review and refunded part of your order.';
    }
  }
  const declined = refund?.state === 'DECLINED';
  return {
    icon: 'info',
    badge: null,
    title: "We've finished reviewing this order",
    lead: [said],
    money: 'card',
    timeline: false,
    actions: declined ? ['done', 'callUs'] : order.completed_at ? ['done', 'viewReceipt'] : ['done'],
    actionNote: null,
  };
}

export interface OutcomeInput {
  order: Order;
  payment: Payment | null;
  refunds: readonly Refund[];
  timeline: readonly Transition[] | null | undefined;
}

/**
 * The outcome for an ended order. "You weren't charged" is said only when the payment record agrees
 * (or has not been read, where the order's own state, a void before capture, is the answer).
 */
export function outcomeOf({ order, payment, refunds, timeline }: OutcomeInput): Outcome {
  const noCharge = payment ? payment.amount_captured_cents === 0 : true;
  switch (order.state) {
    case 'REJECTED':
      return rejected(order, noCharge);
    case 'CANCELLED':
      return cancelled(order, payment, noCharge);
    case 'FAILED': {
      const code = payment?.failure_code ?? null;
      return {
        icon: 'info',
        badge: null,
        title: "Your payment didn't go through",
        lead: [sentence([(code && FAILED_LEAD[code]) || FAILED_DEFAULT, noCharge && 'Nothing was charged.'])],
        money: 'card',
        timeline: false,
        actions: ['putBack', 'backToOrders'],
        actionNote: "We'll put your items back in your cart and check the price again.",
      };
    }
    case 'DISPUTED':
      return disputed(order, timeline);
    default:
      return resolved(order, refunds);
  }
}
