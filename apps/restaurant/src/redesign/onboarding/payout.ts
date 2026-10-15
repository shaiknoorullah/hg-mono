/**
 * The payout step as a state (canvas ON `Payout-*`), read from `getConnectStatus` alone. Stripe
 * owns the truth: the page reports it in plain words and never decides eligibility itself.
 *
 * The contract cannot tell "never set up" from "restricted later" (an open API gap), so a
 * missing account (404, or no `stripe_account_id`) is the only "not started".
 */
import type { Schema } from '@hg/api-client';

export type ConnectStatus = Schema['ConnectStatus'];

export type PayoutMode =
  | 'not-started'
  | 'due' // Stripe asked for more details
  | 'verifying' // everything sent; Stripe is checking
  | 'disabled' // Stripe turned payouts off (past due or a disabled reason)
  | 'enabled';

export function payoutMode(status: ConnectStatus | null): PayoutMode {
  if (!status || !status.stripe_account_id) return 'not-started';
  if (status.payouts_enabled) return 'enabled';
  const r = status.requirements;
  // Stripe sets `disabled_reason` for any account not yet payable, so only a deadline that has
  // passed or a rejection means "turned off".
  if (r.past_due.length > 0 || /^(rejected|listed)/.test(r.disabled_reason ?? '')) return 'disabled';
  if (status.details_submitted && r.currently_due.length === 0) return 'verifying';
  return 'due';
}

/** Stripe requirement names in plain words; the raw name stays beside it as a secondary chip. */
const REQUIREMENT_WORDS: Record<string, string> = {
  external_account: 'Your bank account for payouts',
  'individual.verification.document': 'A photo of your ID to confirm who you are',
  'individual.id_number': 'Your Social Insurance Number',
};

export const UNKNOWN_REQUIREMENT = 'Stripe needs more details. Continue on Stripe to see what';

export function requirementWords(key: string): string {
  return REQUIREMENT_WORDS[key] ?? UNKNOWN_REQUIREMENT;
}

/** What the page lists: past due first, then due now. Eventually-due items are "Stripe may ask later". */
export function listedRequirements(status: ConnectStatus): string[] {
  const out: string[] = [];
  for (const k of [...status.requirements.past_due, ...status.requirements.currently_due]) if (!out.includes(k)) out.push(k);
  return out;
}
