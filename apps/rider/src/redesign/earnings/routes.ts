/**
 * WP10 routes (Earnings tab), merged into `RedesignRoutes`. The tab root `earnings` is WP0's.
 *
 * Names carry an `earnings` prefix so the Account tab's own Payouts page (WP9) never collides.
 * `deliveries` is the HW Deliveries list (WP11): declared here so the Earnings History card can
 * open it; until WP11 registers its screen, the shell's fallback shows.
 */
import type { Schema } from '@hg/api-client';

/** Where an Earnings line was opened from: sets the back label (EA/EntryDetail `BACK`). */
export type LineFrom = 'activity' | 'payout' | 'earnings' | 'payouts';

/** Where a Payout was opened from. */
export type PayoutFrom = 'payouts' | 'earnings' | 'line';

declare module '../nav/routes' {
  interface RedesignRoutes {
    earningsActivity: undefined;
    /** Rendered from the row that opened it (there is no GET for one entry). */
    earningsLine: { entry: Schema['EarningEntry']; from: LineFrom };
    earningsPayouts: undefined;
    earningsPayout: { payoutId: string; from: PayoutFrom; backTitle?: string };
    deliveries: undefined;
  }
}
