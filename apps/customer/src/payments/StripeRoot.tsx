import * as React from 'react';
import { StripeProvider } from '@stripe/stripe-react-native';

const KEY = process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? '';

/** Provides Stripe to the tree. With no key set the app still runs (fake-gateway dev). */
export function StripeRoot({ children }: { children: React.ReactElement }): React.ReactElement {
  return (
    <StripeProvider publishableKey={KEY} urlScheme="hgcustomer">
      {children}
    </StripeProvider>
  );
}
