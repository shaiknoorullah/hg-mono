/**
 * WP9 routes, added to the redesign route table by declaration merging (nav/routes.ts).
 *
 * `account` and `suspended` are WP0 roots; these are the screens pushed from them. `payouts` is
 * shared: Account › Payouts pushes it with `context: 'account'`, and the application flow's
 * step 5 (owned by WP7/WP8, route `application`) pushes it with `context: 'application'`. The
 * Earnings tab's payout-account link (R40) pushes it too.
 */
export type PayoutsContext = 'account' | 'application';
export type LegalDoc = 'terms' | 'privacy';

declare module '../nav/routes' {
  interface RedesignRoutes {
    accountDetails: undefined;
    accountVehicle: undefined;
    accountDocuments: undefined;
    accountTerms: undefined;
    legalDocument: { doc: LegalDoc };
    deleteAccount: undefined;
    payouts: { context: PayoutsContext };
  }
}
