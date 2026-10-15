/**
 * The steps of onboarding this build has not redrawn yet (profile, payout, first menu and
 * hours, done) still render the legacy step inside the redesigned frame, the same fallback the
 * rest of the redesign uses (MASTER-PLAN 0.3). Each redrawn step removes its share of this.
 */
import { LEGACY } from '../routes/legacy';

export function LegacyStep() {
  const { Onboarding } = LEGACY;
  return (
    <div data-legacy-screen="">
      <Onboarding />
    </div>
  );
}
