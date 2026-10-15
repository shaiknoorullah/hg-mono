/**
 * Legacy screens the redesign still hosts, one entry per route (MASTER-PLAN §0.3: the
 * redesign router falls back to the legacy screen until a WP replaces it). A WP that lands
 * its screen removes the entry and its route points at the redesigned screen instead.
 */
import { PayoutsPage } from '../../routes/PayoutsPage';

export const LEGACY = {
  Payouts: PayoutsPage,
};
