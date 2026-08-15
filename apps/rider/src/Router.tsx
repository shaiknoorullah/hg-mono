/**
 * The rider app's screen switch — the render half of the minimal stack in `nav.tsx`.
 *
 * It reads the top of the stack and renders exactly one screen. Adding a route is: a key in
 * `RiderRoutes`, a case here, and a `nav.push`. This is deliberately the whole router; the four
 * V0 screens form one short linear loop, so a full navigation library would be more machinery
 * than the flow needs.
 */
import * as React from 'react';

import { useNav } from './nav';
import { RiderHome } from './RiderHome';
import { AvailabilityScreen } from './screens/AvailabilityScreen';
import { OfferScreen } from './screens/OfferScreen';
import { AssignmentScreen } from './screens/AssignmentScreen';
import { OnboardingScreen } from './screens/OnboardingScreen';
import { EarningsScreen } from './screens/EarningsScreen';
import { PayoutDetailScreen } from './screens/PayoutDetailScreen';
import { ProfileScreen } from './screens/ProfileScreen';
import { DeliveryHistoryScreen } from './screens/DeliveryHistoryScreen';

export function Router(): React.ReactElement {
  const { current } = useNav();
  switch (current.name) {
    case 'home':
      return <RiderHome />;
    case 'availability':
      return <AvailabilityScreen />;
    case 'offer':
      return <OfferScreen />;
    case 'assignment':
      return (
        <AssignmentScreen
          assignmentId={current.params.assignmentId}
          scenario={current.params.scenario}
        />
      );
    case 'onboarding':
      return <OnboardingScreen />;
    case 'earnings':
      return <EarningsScreen initialTab={current.params.tab} />;
    case 'payoutDetail':
      return <PayoutDetailScreen payoutId={current.params.payoutId} />;
    case 'profile':
      return <ProfileScreen />;
    case 'deliveries':
      return <DeliveryHistoryScreen />;
    default:
      return <RiderHome />;
  }
}
