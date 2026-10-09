/**
 * The Earnings tab's reads. Every call is a GET except the Stripe link the Fix button mints;
 * nothing here sends or derives an amount.
 *
 * Ops: getRiderEarningsSummary, listRiderEarningEntries, listRiderPayouts, getRiderPayout,
 * getConnectStatus (and createConnectOnboardingLink for "Fix in Stripe").
 */
import * as React from 'react';
import { unwrap, type Schema } from '@hg/api-client';

import { rider } from '../data/client';
import { toRiderError, type RiderError } from '../data/errors';
import { useApiQuery, type QueryResult } from '../data/query';
import type { EarningsPeriod } from './format';

export type EarningsSummary = Schema['EarningsSummary'];
export type EarningsBucket = Schema['EarningsBucket'];
export type EarningEntry = Schema['EarningEntry'];
export type Payout = Schema['Payout'];
export type PayoutDetail = Schema['PayoutDetail'];
export type ConnectStatus = Schema['ConnectStatus'];
export type PageMeta = Schema['PageMeta'];

export interface Page<T> {
  data: T[];
  meta: PageMeta;
}

export async function fetchSummary(period: EarningsPeriod, from?: string): Promise<EarningsSummary> {
  const res = await unwrap(
    rider.GET('/v1/riders/me/earnings/summary', { params: { query: from ? { period, from } : { period } } }),
  );
  return (res as { data: EarningsSummary }).data;
}

export async function fetchEntries(
  query: { cursor?: string; limit?: number; type?: EarningEntry['type'][] } = {},
): Promise<Page<EarningEntry>> {
  const res = await unwrap(rider.GET('/v1/riders/me/earnings/entries', { params: { query } }));
  return res as Page<EarningEntry>;
}

export async function fetchPayouts(query: { cursor?: string; limit?: number } = {}): Promise<Page<Payout>> {
  const res = await unwrap(rider.GET('/v1/riders/me/payouts', { params: { query } }));
  return res as Page<Payout>;
}

export async function fetchPayout(payoutId: string): Promise<PayoutDetail> {
  const res = await unwrap(rider.GET('/v1/riders/me/payouts/{payoutId}', { params: { path: { payoutId } } }));
  return (res as { data: PayoutDetail }).data;
}

/** 404 = payouts never set up: not an error and not a pause, so no banner and no Fix. */
export async function fetchConnectStatus(): Promise<ConnectStatus | null> {
  try {
    const res = await unwrap(rider.GET('/v1/connect/status'));
    return (res as { data: ConnectStatus }).data;
  } catch (e) {
    if (toRiderError(e).status === 404) return null;
    throw e;
  }
}

export async function fetchPayoutLink(): Promise<string> {
  const res = await unwrap(rider.POST('/v1/connect/onboarding-link'));
  return (res as { data: Schema['ConnectOnboardingLink'] }).data.url;
}

/**
 * "Fix" shows only when Stripe still needs something: payouts disabled, or a non-empty
 * `currently_due` / `past_due` (EA notes: keyed on GET /connect/status, never on a cause code).
 */
export function needsFix(c: ConnectStatus | null | undefined): boolean {
  if (!c) return false;
  return !c.payouts_enabled || c.requirements.currently_due.length > 0 || c.requirements.past_due.length > 0;
}

/** The requirement ids, verbatim from Stripe (never paraphrased). */
export function stripeDetails(c: ConnectStatus): string {
  return [...c.requirements.past_due, ...c.requirements.currently_due].join(', ');
}

export function useConnectStatus(enabled = true): QueryResult<ConnectStatus | null> {
  return useApiQuery('earnings-connect-status', fetchConnectStatus, { enabled });
}

/** 403 ACCOUNT_NOT_ACTIVE: the account is paused, so money screens show the paused state. */
export function isPaused(e: RiderError | null | undefined): boolean {
  return e?.code === 'ACCOUNT_NOT_ACTIVE' || e?.code === 'ACCOUNT_SUSPENDED' || e?.code === 'ACCOUNT_DEACTIVATED';
}

export function isRateLimited(e: RiderError | null | undefined): boolean {
  return e?.code === 'RATE_LIMITED';
}

/**
 * A cursor-paged list: the first page through `useApiQuery` (poll, foreground refetch, saved
 * copy), older pages on an explicit "Show older …" tap, appended in order. A failed older page
 * keeps every loaded row (EA Activity-paging-error).
 */
export interface PagedList<T> {
  first: QueryResult<Page<T>>;
  rows: T[];
  hasMore: boolean;
  loadingMore: boolean;
  moreError: RiderError | null;
  loadMore: () => Promise<void>;
}

export function usePagedList<T>(key: string, fetchPage: (cursor?: string) => Promise<Page<T>>): PagedList<T> {
  const first = useApiQuery(key, () => fetchPage());
  const [older, setOlder] = React.useState<{ rows: T[]; cursor: string | null; hasMore: boolean } | null>(null);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [moreError, setMoreError] = React.useState<RiderError | null>(null);

  // A fresh first page starts the paging over (the newest rows may have shifted).
  React.useEffect(() => {
    setOlder(null);
    setMoreError(null);
  }, [first.updatedAt]);

  const cursor = older ? older.cursor : (first.data?.meta.next_cursor ?? null);
  const hasMore = older ? older.hasMore : !!(first.data?.meta.has_more && first.data.meta.next_cursor);

  const loadMore = React.useCallback(async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    setMoreError(null);
    try {
      const page = await fetchPage(cursor);
      setOlder((o) => ({
        rows: [...(o?.rows ?? []), ...page.data],
        cursor: page.meta.next_cursor,
        hasMore: !!(page.meta.has_more && page.meta.next_cursor),
      }));
    } catch (e) {
      setMoreError(toRiderError(e));
    } finally {
      setLoadingMore(false);
    }
  }, [cursor, fetchPage, loadingMore]);

  const rows = React.useMemo(() => [...(first.data?.data ?? []), ...(older?.rows ?? [])], [first.data, older]);
  return { first, rows, hasMore, loadingMore, moreError, loadMore };
}

/**
 * 429: "You can try again in 30 seconds." The client does not expose Retry-After yet, so the
 * wait is the boards' 30 s; Try again stays disabled until it passes.
 */
export const RATE_LIMIT_WAIT_MS = 30_000;

export function useCooldown(active: boolean): boolean {
  const [waiting, setWaiting] = React.useState(active);
  React.useEffect(() => {
    if (!active) {
      setWaiting(false);
      return;
    }
    setWaiting(true);
    const id = setTimeout(() => setWaiting(false), RATE_LIMIT_WAIT_MS);
    return () => clearTimeout(id);
  }, [active]);
  return waiting;
}
