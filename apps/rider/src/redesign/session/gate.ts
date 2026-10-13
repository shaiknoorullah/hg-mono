/**
 * `next_route` → where the rider lands. The server decides the screen; this is the table from
 * the `SO/Ref-OnboardingStates` board, and nothing else. `onboarding_state` is never used to
 * route (only for progress labels), and an unknown `next_route` is "Update the app", never a
 * crash (contract: NextRoute is a closed enum the client maps; unknown → update).
 */
import type { Schema } from '@hg/api-client';

export type RiderMe = Schema['RiderMe'];

export type ApplicationStep = 'profile' | 'vehicle' | 'documents' | 'review' | 'rejected' | 'payout';

export type TerminalKind =
  /** APP_UPDATE_REQUIRED, or a `next_route` this build does not know. */
  | 'update'
  /** A known route that belongs to another app (PROFILE_CAPTURE, ONBOARDING_MENU, ORDER_TRACKING). */
  | 'wrong-role'
  /** DEACTIVATED with no delivery in hand, or 403 ACCOUNT_NOT_ACTIVE. */
  | 'closed';

export type GateDecision =
  | { mode: 'tabs' }
  | { mode: 'trip'; assignmentId: string | null }
  | { mode: 'application'; step: ApplicationStep }
  | { mode: 'suspended' }
  | { mode: 'terminal'; kind: TerminalKind };

const APPLICATION: Record<string, ApplicationStep> = {
  ONBOARDING_PROFILE: 'profile',
  ONBOARDING_VEHICLE: 'vehicle',
  ONBOARDING_DOCUMENTS: 'documents',
  ONBOARDING_AWAITING_REVIEW: 'review',
  ONBOARDING_REJECTED: 'rejected',
  ONBOARDING_PAYOUT: 'payout',
};

const WRONG_ROLE = new Set(['PROFILE_CAPTURE', 'ONBOARDING_MENU', 'ORDER_TRACKING']);

export function decide(me: RiderMe): GateDecision {
  // Closed mid-delivery: the delivery comes first; the closed screen follows when it ends
  // (PA Suspended-Closed-OnDelivery).
  if (me.account_status === 'DEACTIVATED') {
    return me.active_assignment_id
      ? { mode: 'trip', assignmentId: me.active_assignment_id }
      : { mode: 'terminal', kind: 'closed' };
  }
  const route: string = me.next_route;
  if (route === 'HOME') return { mode: 'tabs' };
  if (route === 'ACTIVE_DELIVERY') return { mode: 'trip', assignmentId: me.active_assignment_id ?? null };
  if (route === 'SUSPENDED') return { mode: 'suspended' };
  if (route in APPLICATION) return { mode: 'application', step: APPLICATION[route]! };
  if (WRONG_ROLE.has(route)) return { mode: 'terminal', kind: 'wrong-role' };
  return { mode: 'terminal', kind: 'update' };
}

const CLOSED_CODES = new Set(['ACCOUNT_NOT_ACTIVE', 'ACCOUNT_DEACTIVATED', 'ACCOUNT_BANNED']);

/**
 * A `getRiderMe` failure that is itself a routing answer (403 closed), or null for a real error
 * (the splash's "We couldn't open your account"). Takes the classified error (`toRiderError`).
 */
export function decideFromError(error: { status: number | null; code: string | null } | null): GateDecision | null {
  if (error && error.status === 403 && CLOSED_CODES.has(String(error.code))) {
    return { mode: 'terminal', kind: 'closed' };
  }
  return null;
}
