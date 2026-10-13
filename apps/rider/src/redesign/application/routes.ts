/**
 * WP7 routes, added to the redesign route table by declaration merging (nav/routes.ts).
 *
 * `application` is a WP0 root (the flow the gate opens); WP7 registers it as the hub. The two
 * step screens are WP7's. The last three are declared here and registered by WP8 (documents,
 * review, fix documents); until WP8 merges they fall back to the legacy onboarding screen.
 *
 * Two routes the hub links to belong to WP9 and are not declared on main yet: `legalDocument`
 * (`{ doc: 'terms' | 'privacy' }`) and `payouts` (`{ context: 'application' }`). The hub looks
 * them up at run time (`optionalRoute` in data.ts) and only links to them once registered.
 */
declare module '../nav/routes' {
  interface RedesignRoutes {
    /** R06 Your details (step 1). */
    applicationDetails: undefined;
    /** R07 How you deliver (step 2). */
    applicationVehicle: undefined;
    /** R08 Documents (step 3), WP8. */
    applicationDocuments: undefined;
    /** R11 Review, WP8. */
    applicationReview: undefined;
    /** R12 Fix documents, WP8. */
    applicationFix: undefined;
  }
}

export {};
