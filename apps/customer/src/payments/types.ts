/**
 * What a payment attempt ended as, on either platform (`pay.ts` native, `pay.web.ts` web).
 *
 * - `paid`: Stripe confirmed the PaymentIntent. It is manual-capture, so the card is only
 *   *authorised*; the server captures when the restaurant accepts.
 * - `canceled`: the customer closed the sheet.
 * - `failed`: declined, 3-D Secure failed, or Stripe errored. `message` is Stripe's customer-safe
 *   text when there is one.
 * - `unconfigured`: this build has no Stripe publishable key, so no card can be taken. The order
 *   exists and waits for payment; nothing crashed and nothing was charged.
 */
export type PayResult =
  | { status: 'paid' }
  | { status: 'canceled' }
  | { status: 'failed'; message?: string }
  | { status: 'unconfigured'; message: string };

export const UNCONFIGURED_MESSAGE =
  'Card payments are not configured in this build (EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY).';

export const UNCONFIGURED: PayResult = { status: 'unconfigured', message: UNCONFIGURED_MESSAGE };

/**
 * The Stripe publishable key baked into this build, or `null` when there is none.
 *
 * Read on each call (Expo inlines `process.env.EXPO_PUBLIC_*` at bundle time; tests set it per
 * case). Anything that is not a publishable key (`pk_test_…` / `pk_live_…`) counts as none: a
 * secret key must never reach a client, and a mistyped one would only fail later and louder.
 */
export function stripePublishableKey(): string | null {
  const key = (process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? '').trim();
  return /^pk_(test|live)_/.test(key) ? key : null;
}

/** A `pk_test_…` key: the sheets show which Stripe test cards to use. */
export function isStripeTestMode(): boolean {
  return stripePublishableKey()?.startsWith('pk_test_') ?? false;
}

/**
 * The local/dev fake payment gateway (HG_ENV=local with no Stripe key) returns
 * `pi_fake_<hex>_secret`. The contract has no "no action needed" flag, so this prefix is the
 * signal to skip the sheet; the server has already advanced the order itself.
 */
export function isFakeClientSecret(secret: string): boolean {
  return secret.startsWith('pi_fake_');
}
