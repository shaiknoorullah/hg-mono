/**
 * The drop-off leg's routes (WP5), declared from this folder by merging into `RedesignRoutes`.
 *
 * `tripDropoff` itself is declared by WP4 (`../trip/assignment.ts`); this WP registers it.
 * `tripException` and `tripReturn` belong to WP6 (Something's wrong, can't deliver, return):
 * declared here so the drop-off can open them, and until WP6 registers them the fallback shows.
 */
import type { Schema } from '@hg/api-client';

export type HandoverMethod = Schema['HandoverMethod'];
export type PodMethod = Schema['PodMethod'];

/** Which leg's "Something's wrong" sheet: the pickup, on the way to the customer, at the door, returning. */
export type TripLeg = 'pickup' | 'dropoff' | 'door' | 'returning';

declare module '../nav/routes' {
  interface RedesignRoutes {
    /** R25: how the bag is handed over, before the proof. */
    tripHandover: { assignmentId: string };
    /**
     * R26–R28: the proof for `required_pod_method`. `leftAtDoor` is WP6's "Leave it at the door
     * with a photo and a statement" from Can't deliver (DL/PodAttestationLeftAtDoor).
     */
    tripProof: { assignmentId: string; handover: HandoverMethod; leftAtDoor?: boolean };
    /** R29: delivered, with the earnings line. `method` is the proof that was recorded. */
    tripDelivered: { assignmentId: string; method: PodMethod; at: string };
    /** R30 (WP6): the leg's "What's wrong?" sheet. */
    tripException: { assignmentId: string; leg: TripLeg };
    /** R31 (WP6): UNDELIVERABLE and RETURNING, the food going back to the restaurant. */
    tripReturn: { assignmentId: string };
  }
}
