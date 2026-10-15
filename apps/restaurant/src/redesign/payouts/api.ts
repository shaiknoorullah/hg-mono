/** The three reads the payouts area makes. Every figure comes straight off the wire. */
import { client } from '../data/client';
import { unwrap } from '@hg/api-client';
import { attempt } from '../auth/api';
import type { ConnectStatus, Payout } from './model';

/** `getConnectStatus`; a 404 means "no payout account yet" and is `null`, not an error. */
export async function loadConnect(): Promise<ConnectStatus | null> {
  const res = await attempt(() => client.GET('/v1/connect/status', {}));
  if (res.ok) return res.data as ConnectStatus;
  if (!res.network && res.status === 404) return null;
  throw new Error('connect-status');
}

export interface PayoutPage {
  rows: Payout[];
  nextCursor: string | null;
  hasMore: boolean;
}

export const PAGE_SIZE = 20;

/** `listRestaurantPayouts`, one cursor page (newest first). Throws `HgApiError` on a failure. */
export async function loadPayoutPage(cursor: string | null): Promise<PayoutPage> {
  const envelope = await unwrap(client.GET('/v1/restaurant/payouts', { params: { query: { limit: PAGE_SIZE, ...(cursor ? { cursor } : {}) } } }));
  const meta = (envelope as { meta?: { next_cursor?: string | null; has_more?: boolean } }).meta;
  return { rows: envelope.data as Payout[], nextCursor: meta?.next_cursor ?? null, hasMore: Boolean(meta?.has_more) };
}

export interface StripeOutcome {
  /** The account just created, when this call created one. */
  account?: ConnectStatus;
  problem?: 'create' | 'link' | 'step-na';
}

/**
 * Creates the connected account when there is none (the same idempotency key on every retry, so
 * a retry never makes a second one), then asks for a fresh onboarding link and sends the owner
 * there. A 409 means the server will not open payout setup for this account right now.
 */
export async function openStripe(createFirst: boolean, key: string, go: (url: string) => void): Promise<StripeOutcome> {
  let account: ConnectStatus | undefined;
  if (createFirst) {
    const created = await attempt(() => client.POST('/v1/connect/account', { params: { header: { 'Idempotency-Key': key } } }));
    if (!created.ok) return { problem: !created.network && created.status === 409 ? 'step-na' : 'create' };
    account = created.data as ConnectStatus;
  }
  const link = await attempt(() => client.POST('/v1/connect/onboarding-link', {}));
  if (!link.ok) return { account, problem: !link.network && link.status === 409 ? 'step-na' : 'link' };
  go((link.data as { url: string }).url);
  return { account };
}
