/**
 * Legacy screens the redesign still hosts, one entry per route (MASTER-PLAN §0.3: the
 * redesign router falls back to the legacy screen until a WP replaces it). A WP that lands
 * its screen removes the entry and its route points at the redesigned screen instead.
 */
import { LoginPage } from '../../routes/LoginPage';
import { RegisterPage } from '../../routes/RegisterPage';
import { VerifyEmailPage } from '../../routes/VerifyEmailPage';
import { ResetPasswordPage } from '../../routes/ResetPasswordPage';
import { OnboardingPage } from '../../routes/onboarding/OnboardingPage';
import { OrdersPage } from '../../routes/OrdersPage';
import { HoursPage } from '../../routes/HoursPage';
import { PayoutsPage } from '../../routes/PayoutsPage';
import { SettingsPage } from '../../routes/SettingsPage';

export const LEGACY = {
  Login: LoginPage,
  Register: RegisterPage,
  VerifyEmail: VerifyEmailPage,
  ResetPassword: ResetPasswordPage,
  Onboarding: OnboardingPage,
  Orders: OrdersPage,
  Hours: HoursPage,
  Payouts: PayoutsPage,
  Settings: SettingsPage,
};
