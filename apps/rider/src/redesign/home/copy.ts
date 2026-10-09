/**
 * Home's words, verbatim from the approved Shift & offers boards (SH canvas, rider manifest
 * Appendix A). Screen-specific copy lives here, not in `data/errors.ts`.
 *
 * Blocking reasons are keyed on the contract code (`RiderAvailability.blocking_reasons[]`,
 * `RiderDashboard.blocking_reasons[]`, or the 403 code itself), never on `error.message`
 * (SH/BlockingReasonsCopy).
 */
import type { Schema } from '@hg/api-client';

export type BlockingReason = Schema['RiderAvailability']['blocking_reasons'][number];

/** What a fix button does. Resolved to an action by the screen. */
export type FixKind = 'application' | 'account' | 'payouts' | 'documents' | 'retry' | 'settings' | null;

export interface ReasonCopy {
  title: string;
  body: string;
  /** The button label; null when there is nothing the rider can tap (the 12-hour rest). */
  fix: string | null;
  kind: FixKind;
}

/** SH/BlockingReasonsCopy: all nine codes, one row each, with their fix. */
export const BLOCKING_REASON_COPY: Record<BlockingReason, ReasonCopy> = {
  ONBOARDING_INCOMPLETE: {
    title: 'Finish getting set up',
    body: 'Some sign-up steps aren’t done yet. See what’s left.',
    // The board's fix opens the step `GET /riders/me` names; its label is the body's own words.
    fix: 'See what’s left',
    kind: 'application',
  },
  ACCOUNT_NOT_ACTIVE: {
    title: 'Your account is not active',
    body: 'You can’t take deliveries right now. Your account page says why.',
    fix: 'See account status',
    kind: 'account',
  },
  PAYOUT_ACCOUNT_INCOMPLETE: {
    title: 'Finish your payout account',
    body: 'Stripe needs a few more details before we can pay you.',
    fix: 'Finish payout setup',
    kind: 'payouts',
  },
  DOCUMENT_EXPIRED: {
    title: 'A document has expired',
    body: 'Upload a current one. We check it before you can go online.',
    fix: 'Upload a new document',
    kind: 'documents',
  },
  STALE_LOCATION_FIX: {
    title: 'We can’t get your location',
    body: 'Step outside or away from tall buildings, then try again.',
    fix: 'Try again',
    kind: 'retry',
  },
  FOREGROUND_LOCATION_PERMISSION: {
    title: 'Location is off for HalalGoes',
    body: 'We need your location to send you offers near you.',
    fix: 'Allow location',
    kind: 'settings',
  },
  BACKGROUND_LOCATION_PERMISSION: {
    title: 'Location is set to “While using”',
    body: 'Set it to “Always” so offers reach you when the screen is off.',
    fix: 'Open location settings',
    kind: 'settings',
  },
  NOTIFICATION_PERMISSION: {
    title: 'Notifications are off',
    body: 'Offers arrive as a notification with sound. Without it you will miss them.',
    fix: 'Allow notifications',
    kind: 'settings',
  },
  CONTINUOUS_ONLINE_CAP: {
    title: 'You’ve been online 12 hours',
    body: 'Take an 8-hour rest, then you can go online again.',
    fix: null,
    kind: null,
  },
};

const KNOWN = new Set(Object.keys(BLOCKING_REASON_COPY));

/** Keeps the codes this build knows, in the server's order, without duplicates. */
export function knownReasons(codes: readonly string[] | null | undefined): BlockingReason[] {
  const out: BlockingReason[] = [];
  for (const c of codes ?? []) if (KNOWN.has(c) && !out.includes(c as BlockingReason)) out.push(c as BlockingReason);
  return out;
}

/** "Fix 3 things to go online" / "Fix 1 thing to go online" (SH/HomeBlocked). */
export function blockedHeading(n: number): string {
  return `Fix ${n} ${n === 1 ? 'thing' : 'things'} to go online`;
}

export const WAITING_BODY =
  'You can lock your phone. When an offer arrives, it fills the screen and plays a sound. You have 30 seconds to answer.';

/** Today's figures as the dashboard returns them, never summed on the phone. */
export function tripsLabel(trips: number): string {
  return `${trips} ${trips === 1 ? 'trip' : 'trips'}`;
}

export function onlineLabel(seconds: number): string {
  const minutes = Math.floor(Math.max(0, seconds) / 60);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h} h ${m} min online` : `${m} min online`;
}

/** The last known shift status, in words ("online", never about the network). */
export function modeWord(mode: Schema['RiderAvailabilityState']): string {
  switch (mode) {
    case 'OFFLINE':
      return 'offline';
    case 'ON_DELIVERY':
      return 'on a delivery';
    default:
      return 'online';
  }
}
