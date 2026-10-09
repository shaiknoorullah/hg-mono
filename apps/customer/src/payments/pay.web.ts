/**
 * Web card payment: Stripe.js Payment Element in a sheet. Same contract as the native
 * `pay.ts`: `payWithSheet(clientSecret): Promise<PayResult>`, never throws.
 *
 * How it works:
 *   1. Mount `<PaymentSheetHost />` once, inside the ThemeProvider (App.tsx does). On native it
 *      renders nothing; on web (PaymentSheetHost.web.tsx) it renders the `Sheet` from
 *      @hg/ui-native with Stripe Elements when a payment is requested.
 *   2. Call `payWithSheet(order.client_secret)`. It opens the sheet (sheetController.ts) and
 *      resolves when the customer is done:
 *        - card authorised (4242 4242 4242 4242, or 4000 0025 0000 3155 after the 3-D Secure
 *          challenge Stripe.js shows in place)      → { status: 'paid' }
 *        - declined (4000 0000 0000 0002), 3-D Secure failed or Stripe error
 *                                                   → { status: 'failed', message }
 *        - sheet closed                             → { status: 'canceled' }
 *        - no EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY    → { status: 'unconfigured', message }
 *   3. On 'paid', read GET /v1/orders/{id}/payment (payForOrder.ts does): the server asks Stripe
 *      and moves the order on even when no webhook can reach it.
 *
 * Confirmation uses `redirect: 'if_required'`, so a card never leaves the page; `return_url` is
 * passed only for a redirect-based method Stripe might offer. The card never touches our servers.
 */
import { requestPayment } from './sheetController';
import { stripePublishableKey, UNCONFIGURED, type PayResult } from './types';

export async function payWithSheet(clientSecret: string): Promise<PayResult> {
  if (!stripePublishableKey()) return UNCONFIGURED;
  try {
    return await requestPayment(clientSecret);
  } catch (e) {
    return { status: 'failed', message: e instanceof Error ? e.message : undefined };
  }
}
