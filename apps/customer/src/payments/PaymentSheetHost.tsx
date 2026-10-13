/**
 * Native: the Stripe React Native SDK presents its own payment sheet (pay.ts), so there is
 * nothing to host. Web: PaymentSheetHost.web.tsx renders the Stripe.js card sheet.
 */
export function PaymentSheetHost(): null {
  return null;
}
