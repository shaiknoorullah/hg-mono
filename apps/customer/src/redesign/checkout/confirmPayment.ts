/**
 * Confirms an order's payment and reports what the SERVER says happened.
 *
 * The card is only authorised here (the intent is manual-capture): the server captures when the
 * restaurant accepts, and a rejection or timeout voids the authorisation. So there is no success
 * until the server's payment state says the card is authorised. The Stripe sheet closing without an
 * error is a hint, never the answer: the payment is read back, and a state that has not moved yet is
 * `processing`, not "placed". A decline is an ordinary outcome of this call, not an exception.
 *
 * Never throws.
 */
import { payWithSheet } from '../../payments/pay';
import { isFakeClientSecret } from '../../payments/types';
import { readPayment, type OrderPayment } from './checkoutApi';
import { AUTHORISED_STATES } from './model';

export type PaymentOutcome =
  /** The server says the card is authorised: the restaurant has the order. */
  | { kind: 'authorised' }
  /** The bank is still working on it; read the payment again shortly. */
  | { kind: 'processing' }
  /** The bank wants the customer to confirm. `secret` is the intent's current client secret. */
  | { kind: 'needsAction'; secret: string }
  /** Declined or failed. `failureCode` is the server's fixed code, or null when it didn't say. */
  | { kind: 'declined'; failureCode: string | null; secret: string }
  /** The customer closed the payment sheet. Nothing was charged. */
  | { kind: 'closed'; secret: string }
  /** This build can't take cards (no Stripe key). The order waits; nothing was charged. */
  | { kind: 'unavailable'; message: string; secret: string };

/** What a payment read means for the screen, with no sheet involved. */
export function outcomeOfPayment(payment: OrderPayment, secret: string): PaymentOutcome | null {
  if (AUTHORISED_STATES.has(payment.state)) return { kind: 'authorised' };
  const next = payment.client_secret ?? secret;
  switch (payment.state) {
    case 'PROCESSING':
      return { kind: 'processing' };
    case 'REQUIRES_ACTION':
      return { kind: 'needsAction', secret: next };
    case 'FAILED':
    case 'REQUIRES_PAYMENT_METHOD':
      return { kind: 'declined', failureCode: payment.failure_code ?? null, secret: next };
    default:
      return null;
  }
}

async function safeRead(orderId: string): Promise<OrderPayment | null> {
  try {
    return await readPayment(orderId);
  } catch {
    return null;
  }
}

export async function confirmPayment(orderId: string, secret: string): Promise<PaymentOutcome> {
  // The local fake gateway has no card sheet: the server already moved the order on.
  if (isFakeClientSecret(secret)) {
    const payment = await safeRead(orderId);
    return (payment && outcomeOfPayment(payment, secret)) ?? { kind: 'authorised' };
  }

  const sheet = await payWithSheet(secret);
  const payment = await safeRead(orderId);
  const read = payment ? outcomeOfPayment(payment, secret) : null;
  const next = payment?.client_secret ?? secret;

  if (sheet.status === 'unconfigured') return { kind: 'unavailable', message: sheet.message, secret: next };
  // The server's word comes first: another route may have authorised the card already.
  if (read?.kind === 'authorised') return read;
  if (sheet.status === 'canceled') return { kind: 'closed', secret: next };
  if (sheet.status === 'failed') {
    if (read?.kind === 'needsAction') return read;
    return { kind: 'declined', failureCode: read?.kind === 'declined' ? read.failureCode : null, secret: next };
  }
  // The sheet reported success: wait for the server to say so. A state that has not moved yet is
  // processing, never "placed".
  return read ?? { kind: 'processing' };
}
