/**
 * Maps what Stripe.js `confirmPayment({ redirect: 'if_required' })` returned to a `PayResult`,
 * or to `retry` when the sheet should stay open (the card form is incomplete or invalid, which
 * Stripe shows inline and the customer fixes in place).
 *
 * The PaymentIntent is manual-capture, so a successful confirmation lands in `requires_capture`:
 * authorised, not charged. `succeeded` and `processing` are accepted too; anything else did not
 * authorise the card.
 */
import type { PaymentIntentResult } from '@stripe/stripe-js';

import type { PayResult } from './types';

export type ConfirmOutcome = PayResult | { status: 'retry'; message: string };

export function confirmOutcome(res: PaymentIntentResult): ConfirmOutcome {
  if (res.error) {
    const message = res.error.message ?? 'Payment failed. Please try again.';
    if (res.error.type === 'validation_error') return { status: 'retry', message };
    // card_error covers declines (4000 0000 0000 0002) and a failed 3-D Secure challenge
    // (payment_intent_authentication_failure); anything else is Stripe or the network.
    return { status: 'failed', message };
  }
  switch (res.paymentIntent.status) {
    case 'requires_capture':
    case 'succeeded':
    case 'processing':
      return { status: 'paid' };
    case 'requires_action':
      return { status: 'failed', message: 'Card authentication was not completed.' };
    default:
      return { status: 'failed', message: 'Your card was not authorised. Please try again.' };
  }
}
