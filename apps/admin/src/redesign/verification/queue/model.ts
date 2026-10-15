/** What the restaurant applications queue shows, derived from the contract's summary rows. */
import type { Schema } from '@hg/api-client';

import { claimOf, formatLeft, type ClaimView } from '../shared/claim';

export type OnboardingState = Schema['RestaurantOnboardingState'];
export type Summary = Schema['RestaurantApplicationSummary'];

/** The board's state words (`RV/Queue-AllStates`). */
export const STATE_LABEL: Readonly<Record<OnboardingState, string>> = {
  REGISTERED: 'Registered',
  EMAIL_VERIFIED: 'Email verified',
  PROFILE_PENDING: 'Profile in progress',
  DOCUMENTS_PENDING: 'Documents not sent',
  DOCUMENTS_REVIEW: 'Documents review',
  DOCUMENTS_APPROVED: 'Documents approved',
  DOCUMENTS_REJECTED: 'Fix documents',
  PAYOUT_PENDING: 'Payout pending',
  MENU_PENDING: 'Menu pending',
  ACTIVE: 'Active',
  WITHDRAWN: 'Withdrawn',
};

export const ALL_STATES = Object.keys(STATE_LABEL) as OnboardingState[];

export type StateFilter = 'REVIEW_AND_FIX' | 'DOCUMENTS_REVIEW' | 'DOCUMENTS_REJECTED' | 'ALL';

export const STATE_FILTER_OPTIONS: ReadonlyArray<{ value: StateFilter; label: string }> = [
  { value: 'REVIEW_AND_FIX', label: 'Documents review and Fix documents' },
  { value: 'DOCUMENTS_REVIEW', label: 'Documents review' },
  { value: 'DOCUMENTS_REJECTED', label: 'Fix documents' },
  // The board says "All 12 states": the twelfth ("Waiting on certifying body") is not in the contract.
  { value: 'ALL', label: `All ${ALL_STATES.length} states` },
];

export const DEFAULT_STATE_FILTER: StateFilter = 'REVIEW_AND_FIX';

/** The `state` query for a filter choice. "All" sends none, so the server's own default applies. */
export function statesFor(filter: StateFilter): OnboardingState[] | undefined {
  switch (filter) {
    case 'REVIEW_AND_FIX':
      return ['DOCUMENTS_REVIEW', 'DOCUMENTS_REJECTED'];
    case 'DOCUMENTS_REVIEW':
      return ['DOCUMENTS_REVIEW'];
    case 'DOCUMENTS_REJECTED':
      return ['DOCUMENTS_REJECTED'];
    case 'ALL':
      return [...ALL_STATES];
  }
}

export function isFiltered(filter: StateFilter, breachedOnly: boolean): boolean {
  return filter !== DEFAULT_STATE_FILTER || breachedOnly;
}

/** The state badge's tone: review is info, "fix documents" is the restaurant's turn (warning). */
export function stateTone(state: OnboardingState): 'info' | 'warning' | 'outline' | 'neutral' {
  if (state === 'DOCUMENTS_REVIEW') return 'info';
  if (state === 'DOCUMENTS_REJECTED') return 'warning';
  if (state === 'DOCUMENTS_APPROVED' || state === 'ACTIVE') return 'outline';
  return 'neutral';
}

const ORDINALS = ['1st', '2nd', '3rd'];

/** "1st", "2nd", "3rd", "4th" from the number of times it was submitted. */
export function attemptLabel(submissionCount: number | undefined): string {
  const n = Math.max(1, submissionCount ?? 1);
  return ORDINALS[n - 1] ?? `${n}th`;
}

export type SlaView =
  | { readonly kind: 'due'; readonly dueAt: string; readonly breached: boolean }
  | { readonly kind: 'waiting-on-restaurant' }
  | { readonly kind: 'not-in-review' };

/** The SLA cell. The clock only runs while a reviewer owes a decision. */
export function slaOf(row: Summary, now: number = Date.now()): SlaView {
  if (row.onboarding_state === 'DOCUMENTS_REVIEW') {
    return { kind: 'due', dueAt: row.sla_due_at, breached: Date.parse(row.sla_due_at) <= now };
  }
  if (row.onboarding_state === 'DOCUMENTS_REJECTED') return { kind: 'waiting-on-restaurant' };
  return { kind: 'not-in-review' };
}

export function claimText(claim: ClaimView, now: number = Date.now()): { primary: string; secondary: string } {
  switch (claim.kind) {
    case 'mine':
      return { primary: 'Claimed by you', secondary: formatLeft(claim.expiresAt, now) };
    case 'other':
      return { primary: 'Another reviewer', secondary: formatLeft(claim.expiresAt, now) };
    default:
      return { primary: 'Unclaimed', secondary: '' };
  }
}

/** The row, if any, that the signed-in reviewer holds right now. */
export function heldBy(rows: readonly Summary[], accountId: string | null | undefined, now: number = Date.now()): Summary | null {
  return rows.find((row) => claimOf(row, accountId, now).kind === 'mine') ?? null;
}
