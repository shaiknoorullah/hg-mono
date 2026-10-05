export type PayResult =
  | { status: 'paid' }
  | { status: 'canceled' }
  | { status: 'failed'; message?: string }
  | { status: 'unsupported' };

/**
 * The local/dev fake payment gateway (HG_ENV=local with no Stripe key) returns
 * `pi_fake_<hex>_secret`. The contract has no "no action needed" flag, so this prefix is the
 * signal to skip the sheet; the server has already advanced the order itself.
 */
export function isFakeClientSecret(secret: string): boolean {
  return secret.startsWith('pi_fake_');
}
