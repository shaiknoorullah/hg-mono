/** What the rider applications queue shows, derived from the contract's summary rows. */
import type { Schema } from '@hg/api-client';

import { claimOf, formatLeft, type ClaimView } from '../../verification/shared/claim';
import { formatTime } from '../../data/format';

export type OnboardingState = Schema['RiderOnboardingState'];
export type Summary = Schema['RiderApplicationSummary'];
export type VehicleType = Schema['VehicleType'];

/** The board's state words (`rider-onboarding/Main`, the "Onboarding state" list). */
export const STATE_LABEL: Readonly<Record<OnboardingState, string>> = {
  REGISTERED: 'Registered',
  PHONE_VERIFIED: 'Phone verified',
  PROFILE_PENDING: 'Profile pending',
  VEHICLE_PENDING: 'Vehicle pending',
  DOCUMENTS_PENDING: 'Documents pending',
  DOCUMENTS_REVIEW: 'Documents review',
  DOCUMENTS_APPROVED: 'Documents approved',
  DOCUMENTS_REJECTED: 'Documents rejected',
  PAYOUT_PENDING: 'Payout pending',
  ACTIVE: 'Active',
};

export const ALL_STATES = Object.keys(STATE_LABEL) as OnboardingState[];

export const DEFAULT_STATES: readonly OnboardingState[] = ['DOCUMENTS_REVIEW'];

export const VEHICLE_LABEL: Readonly<Record<VehicleType, string>> = {
  CAR: 'Car',
  SCOOTER: 'Scooter',
  MOTORCYCLE: 'Motorcycle',
  BICYCLE: 'Bicycle',
  ON_FOOT: 'On foot',
};

export function vehicleLabel(type: VehicleType | null | undefined): string {
  return type ? VEHICLE_LABEL[type] : '—';
}

/** Every status word carries an icon as well (the boards' accessibility rule). */
export function stateIcon(state: OnboardingState): 'clock' | 'check' | 'warning' | 'info' {
  switch (state) {
    case 'DOCUMENTS_REVIEW':
    case 'PAYOUT_PENDING':
      return 'clock';
    case 'DOCUMENTS_APPROVED':
    case 'ACTIVE':
      return 'check';
    case 'DOCUMENTS_REJECTED':
      return 'warning';
    default:
      return 'info';
  }
}

/** Review is info, the rider's turn is warning, decided and not-yet-submitted states are quiet. */
export function stateTone(state: OnboardingState): 'info' | 'warning' | 'outline' | 'neutral' {
  if (state === 'DOCUMENTS_REVIEW') return 'info';
  if (state === 'DOCUMENTS_REJECTED') return 'warning';
  if (state === 'DOCUMENTS_APPROVED' || state === 'PAYOUT_PENDING' || state === 'ACTIVE') return 'neutral';
  return 'outline';
}

/** The states before documents are in review: the board reads "Not submitted yet" for these. */
const BEFORE_REVIEW: ReadonlySet<OnboardingState> = new Set<OnboardingState>([
  'REGISTERED',
  'PHONE_VERIFIED',
  'PROFILE_PENDING',
  'VEHICLE_PENDING',
  'DOCUMENTS_PENDING',
]);

export function isSubmitted(state: OnboardingState): boolean {
  return !BEFORE_REVIEW.has(state);
}

/** Only an application in Documents review can be decided; every other state is a record. */
export function isDecidable(state: OnboardingState): boolean {
  return state === 'DOCUMENTS_REVIEW';
}

export type ReviewTarget =
  | { readonly kind: 'due'; readonly dueAt: string }
  | { readonly kind: 'missed'; readonly dueAt: string; readonly overMs: number }
  | { readonly kind: 'decided' }
  | { readonly kind: 'not-in-review' };

/** The review-target cell. The target only runs while a reviewer owes a decision. */
export function reviewTargetOf(row: Pick<Summary, 'onboarding_state' | 'sla_due_at'>, now: number = Date.now()): ReviewTarget {
  if (row.onboarding_state === 'DOCUMENTS_REVIEW') {
    const due = Date.parse(row.sla_due_at);
    return due <= now ? { kind: 'missed', dueAt: row.sla_due_at, overMs: now - due } : { kind: 'due', dueAt: row.sla_due_at };
  }
  return BEFORE_REVIEW.has(row.onboarding_state) ? { kind: 'not-in-review' } : { kind: 'decided' };
}

/** "22 h 30 min over", "45 min over". */
export function formatOver(ms: number): string {
  const mins = Math.max(1, Math.round(ms / 60_000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h > 0 ? `${h} h ${m > 0 ? `${m} min ` : ''}` : `${m} min `}over`.replace(/\s+/g, ' ');
}

/** "in 1 day 19 h", "in 45 min": the wall-clock time left to a target, never a live timer. */
export function formatUntil(iso: string, now: number = Date.now()): string {
  const mins = Math.max(0, Math.floor((Date.parse(iso) - now) / 60_000));
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  if (d > 0) return `in ${d} ${d === 1 ? 'day' : 'days'}${h > 0 ? ` ${h} h` : ''}`;
  if (h > 0) return `in ${h} h${m > 0 ? ` ${m} min` : ''}`;
  return `in ${m} min`;
}

export function claimText(row: Summary, claim: ClaimView, now: number = Date.now()): { primary: string; secondary: string } {
  switch (claim.kind) {
    case 'mine':
      return { primary: 'Claimed by you', secondary: `${formatLeft(claim.expiresAt, now)} · until ${formatTime(claim.expiresAt)}` };
    case 'other':
      return { primary: 'Claimed by another reviewer', secondary: `until ${formatTime(claim.expiresAt)}` };
    case 'ended':
      return { primary: 'Unclaimed', secondary: `your claim ended ${formatTime(claim.expiresAt)}` };
    default:
      // A lock that has passed on someone else's claim: nobody holds it now.
      return row.assigned_admin_id && row.review_lock_expires_at
        ? { primary: 'Unclaimed', secondary: `previous claim ended ${formatTime(row.review_lock_expires_at)}` }
        : { primary: 'Unclaimed', secondary: '' };
  }
}

/** The row, if any, that the signed-in reviewer holds right now. */
export function heldBy(rows: readonly Summary[], accountId: string | null | undefined, now: number = Date.now()): Summary | null {
  return rows.find((row) => claimOf(row, accountId, now).kind === 'mine') ?? null;
}

/** The earliest end among other reviewers' live claims (for "try again at …"). */
export function firstClaimEnd(rows: readonly Summary[], now: number = Date.now()): string | null {
  const ends = rows
    .filter((r) => r.review_lock_expires_at && Date.parse(r.review_lock_expires_at) > now)
    .map((r) => r.review_lock_expires_at as string)
    .sort();
  return ends[0] ?? null;
}

export function sameStates(a: readonly OnboardingState[], b: readonly OnboardingState[]): boolean {
  return a.length === b.length && a.every((s) => b.includes(s));
}

export function isFiltered(states: readonly OnboardingState[]): boolean {
  return !sameStates(states, DEFAULT_STATES);
}

/** The filter's summary text and the caption: "Documents review", "All 10 states", "3 states". */
export function filterText(states: readonly OnboardingState[]): string {
  if (states.length === ALL_STATES.length) return `All ${ALL_STATES.length} states`;
  if (states.length === 0) return 'No state chosen';
  const ordered = ALL_STATES.filter((s) => states.includes(s)).map((s) => STATE_LABEL[s]);
  return ordered.length <= 3 ? ordered.join(', ') : `${ordered.length} states`;
}
