/**
 * Native payment sheet (iOS / Android). Web has its own stub in `pay.web.ts`: the Stripe React
 * Native SDK is native-only.
 *
 * The order's `client_secret` is the PaymentIntent secret from `POST /v1/orders` (the contract
 * returns nothing else: no ephemeral key, no customer). The intent is `capture_method: manual`,
 * so confirming it only *authorises* the card; the server captures when the restaurant accepts
 * (docs/spec/01-platform.md, section 5).
 */
import { initPaymentSheet, presentPaymentSheet } from '@stripe/stripe-react-native';

import type { PayResult } from './types';

export async function payWithSheet(clientSecret: string): Promise<PayResult> {
  const init = await initPaymentSheet({
    paymentIntentClientSecret: clientSecret,
    merchantDisplayName: 'HalalGoes',
    returnURL: 'hgcustomer://stripe-redirect',
    allowsDelayedPaymentMethods: false,
  });
  if (init.error) return { status: 'failed', message: init.error.message };

  const { error } = await presentPaymentSheet();
  if (!error) return { status: 'paid' };
  if (error.code === 'Canceled') return { status: 'canceled' };
  return { status: 'failed', message: error.message };
}
