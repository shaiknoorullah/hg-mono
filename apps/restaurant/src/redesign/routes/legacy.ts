/**
 * Legacy screens the redesign still hosts, one entry per route (MASTER-PLAN §0.3: the
 * redesign router falls back to the legacy screen until a WP replaces it). A WP that lands
 * its screen removes the entry and its route points at the redesigned screen instead.
 */
import { OnboardingPage } from '../../routes/onboarding/OnboardingPage';
import { OrdersPage } from '../../routes/OrdersPage';
import { MenuPage } from '../../routes/MenuPage';
import { HoursPage } from '../../routes/HoursPage';
import { PayoutsPage } from '../../routes/PayoutsPage';
import { SettingsPage } from '../../routes/SettingsPage';

export const LEGACY = {
  Onboarding: OnboardingPage,
  Orders: OrdersPage,
  Menu: MenuPage,
  Hours: HoursPage,
  Payouts: PayoutsPage,
  Settings: SettingsPage,
};
