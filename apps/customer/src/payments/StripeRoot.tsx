import * as React from 'react';
import { StripeProvider } from '@stripe/stripe-react-native';

import { stripePublishableKey } from './types';

/**
 * Provides Stripe to the tree on iOS and Android. With no publishable key in the build
 * (EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY unset) the provider is not mounted at all: the native SDK
 * initialised with an empty key is what crashed checkout. The app then runs normally and
 * `payWithSheet` answers `unconfigured` (pay.ts). Web: StripeRoot.web.tsx.
 */
export function StripeRoot({ children }: { children: React.ReactElement }): React.ReactElement {
  const key = stripePublishableKey();
  if (!key) return children;
  return (
    <StripeProvider publishableKey={key} urlScheme="hgcustomer">
      {children}
    </StripeProvider>
  );
}
