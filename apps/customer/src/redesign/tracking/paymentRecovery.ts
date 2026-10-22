/**
 * Payment recovery for an order the customer has not finished paying for: what state the unpaid
 * order is in, and the words for it (the `Track-3DS*`, `Track-PaymentFailed` and
 * `Payment-ChooseCard*` boards, issue #921 under the redesign tracker #656). Pure functions, no React.
 *
 * Only what the contract supports today. An unpaid order is `CREATED` under its 15-minute deadline
 * and the payment record says why it is stuck:
 * - `REQUIRES_ACTION`: the bank wants a 3-D Secure check; `client_secret` is re-issued for it.
 * - `REQUIRES_PAYMENT_METHOD` or `FAILED` with a `failure_code` or `decline_code`: the bank declined.
 *
 * The contract has no operation to retry a payment on the same order with another card
 * (`createOrder` takes `payment_method_id` only at creation, and a second one answers
 * `409 ACTIVE_ORDER_EXISTS`), so "Choose another card" is cancel-then-reorder: the order is cancelled
 * with a reason the customer picks, the items go back in the cart and the server prices them again.
 * The decline words never include the bank's own text, only a fixed map of codes.
 */
import type { Schema } from '@hg/api-client';

type Order = Schema['OrderCustomerView'];
type Payment = Schema['OrderPayment'];

/** What an unpaid order needs from the customer. */
export type Recovery =
  /** The bank wants to check it is the customer (3-D Secure). */
  | { kind: 'bank'; secret: string | null }
  /** The bank declined the card; `code` is the server's fixed code. */
  | { kind: 'declined'; code: string | null };

/** The recovery an unpaid order needs, or null when it needs none (or the payment is not known). */
export function recoveryOf(order: Pick<Order, 'state'>, payment: Payment | null): Recovery | null {
  if (order.state !== 'CREATED' || !payment) return null;
  switch (payment.state) {
    case 'REQUIRES_ACTION':
      return { kind: 'bank', secret: payment.client_secret ?? null };
    case 'FAILED':
      return { kind: 'declined', code: declineCodeOf(payment) };
    case 'REQUIRES_PAYMENT_METHOD': {
      // A fresh order with no card tried yet has no code: that is checkout's own step, not a decline.
      const code = declineCodeOf(payment);
      return code ? { kind: 'declined', code } : null;
    }
    default:
      return null;
  }
}

/** The most specific code the server gave: the bank's `decline_code`, else the `failure_code`. */
export function declineCodeOf(payment: Pick<Payment, 'decline_code' | 'failure_code'>): string | null {
  return payment.decline_code ?? payment.failure_code ?? null;
}

/**
 * The headline of the notice, from the fixed map of codes. `card` is "Visa •••• 4242" or null.
 * An unknown code gets the general words; raw bank text is never shown.
 */
export function declineTitleOf(code: string | null, card: string | null): string {
  const c = card ?? 'your card';
  switch (code) {
    case 'insufficient_funds':
      return `${c} doesn't have enough available`;
    case 'expired_card':
      return `${c} has expired`;
    case 'incorrect_cvc':
      return `The security code for ${c} didn't match`;
    case 'authentication_failed':
      return `Your bank didn't confirm the payment on ${c}`;
    case 'processing_error':
      return `The payment on ${c} didn't go through`;
    case 'card_declined':
      return `Your bank declined ${c}`;
    default:
      return `The payment on ${c} didn't go through`;
  }
}

/** The fixed words on the payment recovery page. */
export const RECOVERY_COPY = {
  bankTitle: 'Confirm with your bank',
  bankContinue: 'Continue to your bank',
  bankClosed: "You closed your bank's check. Nothing was charged. You can continue whenever you're ready.",
  bankUnavailable: "This build can't open your bank's check. Nothing was charged.",
  bankFailed: "Your bank didn't confirm the payment, so we can't place the hold. Nothing was charged.",
  failedTitle: "Your payment didn't go through",
  failedBody:
    "Nothing was charged. If you choose another card, we'll cancel this order so you can order again with another card.",
  chooseAnother: 'Choose another card',
  cancelLeave: 'Cancel order and leave',
  cancelOrder: 'Cancel order',
  confirming: "Your bank has confirmed it's you. Placing the hold on your card now.",
  freeToCancel: 'Free to cancel until the restaurant accepts.',
  puttingBack: 'Putting your items back in your cart',
} as const;
