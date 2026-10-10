/**
 * WP8 routes, added to the redesign route table by declaration merging (nav/routes.ts).
 * `applicationDocuments`, `applicationReview` and `applicationFix` are declared by WP7
 * (application/routes.ts) and registered here; the rest are WP8's own.
 */
import type { RiderDocType } from './data';

declare module '../nav/routes' {
  interface RedesignRoutes {
    /** R09 Document capture: camera, photo of you, a chosen file. */
    applicationCapture: { docType: RiderDocType; start?: 'file' };
    /** R08 An added document before submit (Docs-DocView), or one missing its date (Docs-AddExpiry). */
    applicationDocument: { docType: RiderDocType };
    /** R10 Notifications ask, after the set is sent. */
    applicationNotify: undefined;
    /** R12 Fix: edit details, then a new photo of `docType` (NAME_MISMATCH, DOB_MISMATCH). */
    applicationFixDetails: { docType: RiderDocType };
    /** R12 Fix: edit the plate, then a new photo of `docType` (PLATE_MISMATCH). */
    applicationFixPlate: { docType: RiderDocType };
  }
}

export {};
