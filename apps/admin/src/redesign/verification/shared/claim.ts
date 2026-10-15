/**
 * Who holds an application right now.
 *
 * The server gives `assigned_admin_id` and `review_lock_expires_at` on the application. A claim is
 * live only while the lock has not passed; the clock here is the browser's, the same one the
 * Countdown uses. Certificate writes are not yet refused by the server after the claim ends (an
 * API gap, see the pull request), so the screens turn saving and deciding off themselves at
 * `review_lock_expires_at`.
 */
import type { Schema } from '@hg/api-client';

export type ClaimView =
  /** You hold it and the lock is live. */
  | { readonly kind: 'mine'; readonly expiresAt: string }
  /** The lock was yours and has passed: it went back to the queue. */
  | { readonly kind: 'ended'; readonly expiresAt: string }
  /** Another reviewer's lock is live. */
  | { readonly kind: 'other'; readonly expiresAt: string }
  /** Nobody holds it. */
  | { readonly kind: 'unclaimed' };

type ClaimFields = Pick<Schema['RestaurantApplicationSummary'], 'assigned_admin_id' | 'review_lock_expires_at'>;

export function claimOf(app: ClaimFields, accountId: string | null | undefined, now: number = Date.now()): ClaimView {
  const holder = app.assigned_admin_id ?? null;
  const until = app.review_lock_expires_at ?? null;
  if (!holder || !until) return { kind: 'unclaimed' };
  const live = Date.parse(until) > now;
  if (holder === accountId) return live ? { kind: 'mine', expiresAt: until } : { kind: 'ended', expiresAt: until };
  return live ? { kind: 'other', expiresAt: until } : { kind: 'unclaimed' };
}

/** Whole minutes left on a claim, rounded up, never below zero. */
export function minutesLeft(expiresAt: string, now: number = Date.now()): number {
  return Math.max(0, Math.ceil((Date.parse(expiresAt) - now) / 60_000));
}

/** "42 min left" / "1 h 5 min left". */
export function formatLeft(expiresAt: string, now: number = Date.now()): string {
  const mins = minutesLeft(expiresAt, now);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h > 0 ? `${h} h ${m} min` : `${m} min`} left`;
}

/**
 * The application states in which a decision can still be made. Every other state is a record:
 * approved onwards, sent back to the restaurant (changes requested), or withdrawn.
 */
export function isDecidable(state: Schema['RestaurantOnboardingState']): boolean {
  return state === 'DOCUMENTS_REVIEW';
}
