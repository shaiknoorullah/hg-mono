/**
 * WP9 reads and writes, and the pure derivations the screens render from.
 *
 * - `getConnectStatus` answering 404 means "no payout account yet": `null`, never an error
 *   (rider manifest WP9 DONE).
 * - `createConnectAccount` carries an `Idempotency-Key`; the caller keeps the key until the call
 *   succeeds, so a retry after a dropped answer can never create a second account.
 * - Stripe's requirement keys are never shown (contract: surfaced verbatim, never paraphrased;
 *   board: raw keys only on the clipboard for support). Plain-language labels are Needs API
 *   (manifest §5 #45), so screens show the count only.
 * - Nothing here prices or sums money; the rider app never touches an amount on this tab.
 */
import { unwrap, type Schema } from '@hg/api-client';

import { rider } from '../data/client';
import { toRiderError } from '../data/errors';
import { daysUntil } from './copy';

export type ConnectStatus = Schema['ConnectStatus'];
export type KycDocument = Schema['KycDocument'];
export type RiderDashboard = Schema['RiderDashboard'];

export async function fetchConnectStatus(): Promise<ConnectStatus | null> {
  try {
    const body = await unwrap(rider.GET('/v1/connect/status'));
    return (body as { data: ConnectStatus }).data;
  } catch (e) {
    if (toRiderError(e).status === 404) return null;
    throw e;
  }
}

export async function createConnectAccount(key: string): Promise<ConnectStatus> {
  const body = await unwrap(rider.POST('/v1/connect/account', { params: { header: { 'Idempotency-Key': key } } }));
  return (body as { data: ConnectStatus }).data;
}

export async function createOnboardingLink(): Promise<string> {
  const body = await unwrap(rider.POST('/v1/connect/onboarding-link'));
  return (body as { data: Schema['ConnectOnboardingLink'] }).data.url;
}

export async function fetchDocuments(): Promise<KycDocument[]> {
  const body = await unwrap(rider.GET('/v1/riders/me/documents'));
  return (body as { data: KycDocument[] }).data;
}

export async function fetchDashboard(): Promise<RiderDashboard> {
  const body = await unwrap(rider.GET('/v1/riders/me/dashboard'));
  return (body as { data: RiderDashboard }).data;
}

/* ------------------------------------------------------------------------------------------ */
/* Payouts                                                                                     */
/* ------------------------------------------------------------------------------------------ */

export type PayoutView =
  /** No Stripe account yet (404). Application: "Get paid"; Account: "Payouts are not set up". */
  | { kind: 'start' }
  /** An account exists but Stripe onboarding was left before the end. */
  | { kind: 'returned' }
  /** Details sent, payouts not on yet, nothing asked for: Stripe is checking. */
  | { kind: 'checking' }
  /** Stripe asks for something, no deadline passed. */
  | { kind: 'due'; count: number; later: number; deadline: string | null; payoutsOn: boolean; onHold: boolean }
  /** Stripe's deadline passed with something still missing. */
  | { kind: 'pastDue'; count: number; later: number; deadline: string | null }
  /** Stripe closed the account. */
  | { kind: 'rejected' }
  /** Payouts on; `later` things Stripe will ask for eventually. */
  | { kind: 'ready'; later: number };

/** Keys that are not already counted as needed now. */
function onlyLater(r: ConnectStatus['requirements']): number {
  const now = new Set([...r.past_due, ...r.currently_due]);
  return new Set(r.eventually_due.filter((k) => !now.has(k))).size;
}

export function payoutView(status: ConnectStatus | null, now: Date = new Date()): PayoutView {
  if (!status) return { kind: 'start' };
  const r = status.requirements;
  if (r.disabled_reason && r.disabled_reason.startsWith('rejected')) return { kind: 'rejected' };
  const later = onlyLater(r);
  const dueNow = new Set([...r.past_due, ...r.currently_due]).size;
  const deadlinePassed = r.deadline ? new Date(r.deadline).getTime() < now.getTime() : false;
  if (r.past_due.length > 0 || (dueNow > 0 && deadlinePassed)) {
    return { kind: 'pastDue', count: dueNow, later, deadline: deadlinePassed ? r.deadline ?? null : null };
  }
  if (dueNow > 0) {
    return {
      kind: 'due',
      count: dueNow,
      later,
      deadline: r.deadline ?? null,
      payoutsOn: status.payouts_enabled,
      onHold: r.disabled_reason === 'requirements.pending_verification',
    };
  }
  if (status.payouts_enabled) return { kind: 'ready', later };
  if (!status.details_submitted) return { kind: 'returned' };
  return { kind: 'checking' };
}

/** What "Copy details for support" puts on the clipboard: the raw keys and the deadline. */
export function supportDetails(status: ConnectStatus | null): string {
  if (!status) return 'stripe_account: none';
  const r = status.requirements;
  return [
    `stripe_account: ${status.stripe_account_id ?? 'none'}`,
    `payouts_enabled: ${status.payouts_enabled}`,
    `details_submitted: ${status.details_submitted}`,
    `past_due: ${r.past_due.join(', ') || 'none'}`,
    `currently_due: ${r.currently_due.join(', ') || 'none'}`,
    `eventually_due: ${r.eventually_due.join(', ') || 'none'}`,
    `disabled_reason: ${r.disabled_reason ?? 'none'}`,
    `deadline: ${r.deadline ?? 'none'}`,
  ].join('\n');
}

/* ------------------------------------------------------------------------------------------ */
/* Documents                                                                                   */
/* ------------------------------------------------------------------------------------------ */

/** A document expiring within this many days reads "Expires soon" (SO/Ref-DocumentStates). */
export const EXPIRES_SOON_DAYS = 30;

const PENDING = new Set(['SUBMITTED', 'IN_REVIEW']);

export function expiresSoon(doc: KycDocument, now: Date = new Date()): boolean {
  if (doc.state !== 'APPROVED' || !doc.valid_until) return false;
  const days = daysUntil(doc.valid_until, now);
  return days !== null && days >= 0 && days <= EXPIRES_SOON_DAYS;
}

/** The badge key for a row: the state, or EXPIRES_SOON for an approved one close to expiry. */
export function badgeKey(doc: KycDocument, now: Date = new Date()): string {
  return expiresSoon(doc, now) ? 'EXPIRES_SOON' : doc.state;
}

/** A replacement waiting for a person, for a type whose earlier document is approved or expired. */
export interface Replacement {
  type: string;
  pending: KycDocument;
  earlier: KycDocument | null;
}

export function replacements(docs: readonly KycDocument[]): Replacement[] {
  const out: Replacement[] = [];
  for (const pending of docs.filter((d) => PENDING.has(d.state))) {
    const type = String(pending.doc_type);
    const earlier =
      docs.find((d) => d !== pending && String(d.doc_type) === type && (d.state === 'EXPIRED' || d.state === 'SUPERSEDED' || d.state === 'APPROVED')) ??
      null;
    if (earlier) out.push({ type, pending, earlier });
  }
  return out;
}

export interface DocumentsSummary {
  expiring: KycDocument[];
  /** Expired, with no replacement in review. */
  expired: KycDocument[];
  replacements: Replacement[];
}

export function summarise(docs: readonly KycDocument[], now: Date = new Date()): DocumentsSummary {
  const reps = replacements(docs);
  const replaced = new Set(reps.map((r) => r.type));
  return {
    expiring: docs.filter((d) => expiresSoon(d, now)),
    expired: docs.filter((d) => d.state === 'EXPIRED' && !replaced.has(String(d.doc_type))),
    replacements: reps,
  };
}

/** Row order on Documents: what needs the rider first, earlier versions last. */
export function sortDocuments(docs: readonly KycDocument[], now: Date = new Date()): KycDocument[] {
  const rank = (d: KycDocument): number => {
    if (d.state === 'SUPERSEDED') return 5;
    if (d.state === 'EXPIRED') return docs.some((o) => o !== d && o.doc_type === d.doc_type && PENDING.has(o.state)) ? 4 : 0;
    if (PENDING.has(d.state) || d.state === 'REJECTED') return 1;
    if (expiresSoon(d, now)) return 1;
    return 2;
  };
  return [...docs].map((d, i) => ({ d, i })).sort((a, b) => rank(a.d) - rank(b.d) || a.i - b.i).map((x) => x.d);
}
