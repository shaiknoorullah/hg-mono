/**
 * WP10 routes (Earnings tab), merged into `RedesignRoutes`. The tab root `earnings` is WP0's.
 *
 * Names carry an `earnings` prefix so the Account tab's own Payouts page (WP9) never collides.
 * `deliveries` is the HW Deliveries list (WP11): declared here so the Earnings History card can
 * open it; until WP11 registers its screen, the shell's fallback shows.
 */
import type { Schema } from '@hg/api-client';

/** Where an Earnings line was opened from: sets the back label (EA/EntryDetail `BACK`). */
/** `delivery`: from "You earned" on that job's Delivery screen (WP11, HW/DeliveryDetail). */
export type LineFrom = 'activity' | 'payout' | 'earnings' | 'payouts' | 'delivery';

/** Where a Payout was opened from. */
export type PayoutFrom = 'payouts' | 'earnings' | 'line';

declare module '../nav/routes' {
  interface RedesignRoutes {
    /** `backTitle` when opened from somewhere other than Earnings (a Payout's "See them in Earnings activity"). */
    earningsActivity: { backTitle?: string } | undefined;
    /** Rendered from the row that opened it (there is no GET for one entry). */
    earningsLine: { entry: Schema['EarningEntry']; from: LineFrom };
    earningsPayouts: undefined;
    earningsPayout: { payoutId: string; from: PayoutFrom; backTitle?: string };
    deliveries: undefined;
  }
}
