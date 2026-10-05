/**
 * The customer's saved cards, read for the Account screen's "Payment methods" subline
 * (`listPaymentMethods`, display metadata only: brand, last4, expiry).
 */
import { unwrap } from '@hg/api-client';
import type { Schema } from '@hg/api-client';

import { api } from './client';

export type PaymentMethod = Schema['PaymentMethod'];

export async function listPaymentMethods(): Promise<PaymentMethod[]> {
  const body = await unwrap(api.GET('/v1/payment-methods'));
  return body.data as unknown as PaymentMethod[];
}

/** "Visa •••• 4242" for the default card (else the first), or null with none saved. */
export function cardSummary(cards: PaymentMethod[]): string | null {
  const card = cards.find((c) => c.is_default) ?? cards[0];
  if (!card) return null;
  const brand = card.brand.charAt(0).toUpperCase() + card.brand.slice(1);
  return `${brand} •••• ${card.last4}`;
}
