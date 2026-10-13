/**
 * The checkout's pay path, kept out of the screen so any checkout design can call it.
 *
 *   const outcome = await payForOrder(order.id, client_secret);
 *   outcome.kind === 'placed' → go to tracking
 *   outcome.kind === 'unpaid' → show `outcome.message`; "Retry payment" calls payForOrder again
 *                               with `outcome.secret` for the SAME order (never a new one)
 *
 * It never throws. The steps:
 *   1. A `pi_fake_*` secret (the local fake gateway) needs no card: the server already advanced
 *      the order.
 *   2. Otherwise the platform sheet confirms the PaymentIntent (pay.ts native, pay.web.ts web).
 *   3. Paid: read the order's payment once. The server asks Stripe and moves the order to the
 *      restaurant as the webhook would, so this works on a laptop with no webhook; a failed read
 *      changes nothing, the webhook still arrives in production.
 *   4. Not paid: re-read the payment so a retry uses the server's current secret, and if the
 *      payment has in fact moved on (authorised elsewhere), track the order.
 */
import { getOrderPayment } from '../api/orders';
import { payWithSheet } from './pay';
import { isFakeClientSecret, type PayResult } from './types';

export type PayOutcome =
  | { kind: 'placed' }
  | { kind: 'unpaid'; secret: string; message: string };

/** Payment states in which the card is already authorised (or further): nothing left to pay. */
const PAID_STATES = ['PROCESSING', 'REQUIRES_CAPTURE', 'SUCCEEDED'];

export function unpaidMessage(result: PayResult): string {
  switch (result.status) {
    case 'canceled':
      return 'Payment was cancelled. Your order is not placed until you pay.';
    case 'unconfigured':
      return result.message;
    case 'failed':
      return result.message ?? 'Payment failed. Please try again.';
    case 'paid':
      return '';
  }
}

export async function payForOrder(orderId: string, secret: string): Promise<PayOutcome> {
  if (isFakeClientSecret(secret)) return { kind: 'placed' };

  let result: PayResult;
  try {
    result = await payWithSheet(secret);
  } catch (e) {
    result = { status: 'failed', message: e instanceof Error ? e.message : undefined };
  }

  if (result.status === 'paid') {
    try {
      await getOrderPayment(orderId);
    } catch {
      /* the webhook moves the order; tracking shows it either way */
    }
    return { kind: 'placed' };
  }

  let next = secret;
  try {
    const payment = await getOrderPayment(orderId);
    if (payment.client_secret) next = payment.client_secret;
    else if (PAID_STATES.includes(payment.state)) return { kind: 'placed' };
  } catch {
    /* keep the secret we have */
  }
  return { kind: 'unpaid', secret: next, message: unpaidMessage(result) };
}
