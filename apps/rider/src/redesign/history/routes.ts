/**
 * WP11 routes, merged into `RedesignRoutes` (nav/routes.ts). `deliveries` (R41) is declared by
 * WP10 (earnings/routes.ts), which links to it from the Earnings History card; it is registered
 * here with the rest.
 */
import type { Schema } from '@hg/api-client';

import type { RiderDocType } from '../documents/data';

/**
 * Where one delivery was opened from: sets the back label (HW/DeliveryDetail `BACK`) and what
 * "See how it was worked out" does (open the line, or go back to it).
 */
export type DeliveryFrom = 'deliveries' | 'entry' | 'tip';

declare module '../nav/routes' {
  interface RedesignRoutes {
    /**
     * R42 One delivery. `entry` is the DELIVERY earning line for this assignment when the
     * opener knows it (a Deliveries row, an Earnings line): the earnings card is drawn only
     * from a real entry, never from the assignment's offer estimate.
     */
    delivery: { assignmentId: string; from: DeliveryFrom; entry?: Schema['EarningEntry'] };
    /** R49 One account document (PA/Account-DocView*). `docType` titles the AppBar while it loads. */
    accountDocument: { documentId: string; docType?: RiderDocType };
    /** R49 Replacing an approved document (PA/Account-Replace-*), after the confirm. */
    accountReplace: { docType: RiderDocType };
    /** R43 What's new, reopened from Account (HW/WhatsNew-page). */
    whatsNew: undefined;
  }
}

export {};
