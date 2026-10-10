/**
 * What the exception screens share: the chrome of the leg a "Something's wrong" was opened from,
 * the per-assignment memory that outlives a screen (the automatic RETURNING, the open "Can't
 * deliver" sheet), the ledger lines for a delivery that ended, and the way out of the trip.
 */
import * as React from 'react';

import { useApiQuery } from '../data/query';
import { outbox } from '../data/outbox';
import { fetchDeliveryEntries, forgetDelivery, type EarningEntry } from '../dropoff/proof';
import { SUBTITLE } from '../dropoff/copy';
import type { TripLeg } from '../dropoff/routes';
import { useRiderDashboard } from '../home';
import { useNav } from '../nav/Navigator';
import { useOptionalSession } from '../session/Session';
import { STEP_SUBTITLE, orderSubtitle } from '../trip/copy';
import type { Assignment, AssignmentState } from '../trip/assignment';
import { TITLE } from './copy';

/** UNDELIVERABLE and RETURNING: the food is going back (this WP's `tripReturn`). */
export const RETURN_LEG: ReadonlySet<AssignmentState> = new Set(['UNDELIVERABLE', 'RETURNING']);

/** The AppBar of the step the menu was opened from (the boards draw the sheet over it). */
export function legChrome(leg: TripLeg, a: Assignment, state: AssignmentState | undefined): { title: string; subtitle: string; progress?: number } {
  switch (leg) {
    case 'pickup':
      return state === 'ARRIVED_AT_PICKUP'
        ? { title: TITLE.pickup, subtitle: STEP_SUBTITLE.atRestaurant, progress: 2 }
        : { title: TITLE.pickup, subtitle: STEP_SUBTITLE.goToRestaurant, progress: 1 };
    case 'dropoff':
      return { title: TITLE.dropoff, subtitle: SUBTITLE.goToCustomer, progress: 3 };
    case 'door':
      return { title: TITLE.dropoff, subtitle: SUBTITLE.handOver, progress: 4 };
    default:
      return { title: TITLE.returning, subtitle: orderSubtitle(a.order_code ?? '') };
  }
}

/**
 * Cancelled or moved after the food was in the bag (DL/OrderCancelledAfterPickup,
 * ReassignedAfterPickup). The contract has no "cancelled at" state, so the pickup time decides.
 */
export function afterPickup(a: Assignment): boolean {
  return !!a.picked_up_at;
}

/* ------------------------------------------------------------------ memory per assignment */

const returningClaimed = new Set<string>();
const cantDeliverOpen = new Set<string>();

/**
 * RETURNING has no button: it is posted once, as soon as the return leg opens on UNDELIVERABLE
 * (DL/CantDeliverSending "200 → RETURNING"). `true` the first time per assignment in this run.
 */
export function claimReturning(assignmentId: string): boolean {
  if (returningClaimed.has(assignmentId)) return false;
  returningClaimed.add(assignmentId);
  return true;
}

/**
 * The "Can't deliver" sheet was open when the rider went on to "Leave it at the door": Back
 * from the proof screen lands on it again, not on the menu.
 */
export function rememberCantDeliver(assignmentId: string, open: boolean): void {
  if (open) cantDeliverOpen.add(assignmentId);
  else cantDeliverOpen.delete(assignmentId);
}

export function cantDeliverWasOpen(assignmentId: string): boolean {
  return cantDeliverOpen.has(assignmentId);
}

/** Test seam, and a sign-out. */
export function resetExceptionState(): void {
  returningClaimed.clear();
  cantDeliverOpen.clear();
}

/* ------------------------------------------------------------------ the ledger and the way out */

const ENTRIES_POLL_MS = 15_000;

/**
 * The ledger's lines for a delivery that ended, each as returned (never summed), polled until
 * one exists. While unknown, or when the read fails, nothing is drawn (no loading placeholder).
 */
export function useEndedEntries(assignmentId: string, enabled: boolean): readonly EarningEntry[] {
  const q = useApiQuery(`ended-entries-${assignmentId}`, () => fetchDeliveryEntries(assignmentId), {
    enabled,
    pollMs: (lines) => (lines && lines.length ? null : ENTRIES_POLL_MS),
  });
  return q.data ?? [];
}

/**
 * Leave the trip for Home. `keepSaved` keeps the steps still waiting to send (DL/ReturnedQueued:
 * "The delivery closes once it has sent"); otherwise the delivery is over and nothing saved for
 * it may replay, and the gate and Home re-read where the rider is.
 */
export function useLeaveTrip(assignmentId: string): (options?: { keepSaved?: boolean }) => void {
  const nav = useNav();
  const dash = useRiderDashboard();
  const session = useOptionalSession();
  return React.useCallback(
    ({ keepSaved = false } = {}) => {
      if (!keepSaved) {
        void outbox.clearAssignment(assignmentId);
        forgetDelivery(assignmentId);
        rememberCantDeliver(assignmentId, false);
        // The gate would reopen a trip it still thinks is live: only re-read it once it ended.
        void session?.refresh();
      }
      void dash.refetch();
      nav.closeFlow();
      nav.switchTab('home');
    },
    [assignmentId, dash, nav, session],
  );
}
