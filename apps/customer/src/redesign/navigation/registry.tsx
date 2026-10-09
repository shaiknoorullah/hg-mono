/**
 * Which screen renders each route: the redesigned one when it has merged, else the legacy one
 * through `LegacyBridge` (MASTER-PLAN §0.3).
 *
 * Each WP adds its routes to `REDESIGNED` and nothing else here changes. Reverting a WP removes its
 * entries and the route falls back to legacy again.
 */
import * as React from 'react';

import { DiscoveryScreen } from '../../screens/DiscoveryScreen';
import { RestaurantScreen } from '../../screens/RestaurantScreen';
import { CartScreen } from '../../screens/CartScreen';
import { CheckoutScreen } from '../../screens/CheckoutScreen';
import { TrackingScreen } from '../../screens/TrackingScreen';
import { OrdersScreen } from '../../screens/OrdersScreen';
import { ProfileScreen } from '../../screens/ProfileScreen';
import { AddressesScreen } from '../../screens/AddressesScreen';
import { AddressFormScreen } from '../../screens/AddressFormScreen';
import { AddressStepScreen } from '../signin/AddressStepScreen';
import { SignInScreen } from '../signin/SignInScreen';
import { TermsScreen } from '../signin/TermsScreen';
import { YourDetailsScreen } from '../signin/YourDetailsScreen';
import { toLegacy } from './LegacyBridge';
import type { Route, RouteName } from './routes';

type ScreenFor<N extends RouteName> = (route: Extract<Route, { name: N }>) => React.ReactElement;
type Registry = { [N in RouteName]?: ScreenFor<N> };

/** Redesigned screens, by route. Each WP registers its own. */
export const REDESIGNED: Registry = {
  // WP1: sign-in, first run, forced routes. `signIn` owns the signed-out stack (code, terms,
  // signed out); `signedOut` and `terms` also render on their own when opened from a tab.
  signIn: () => <SignInScreen />,
  signedOut: () => <SignInScreen />,
  yourDetails: (r) => <YourDetailsScreen fromCart={r.fromCart} />,
  addressStep: () => <AddressStepScreen />,
  terms: (r) => <TermsScreen signedOut={r.signedOut} />,
};

export function redesignedScreen(route: Route): React.ReactElement | null {
  const render = REDESIGNED[route.name] as ((r: Route) => React.ReactElement) | undefined;
  return render ? render(route) : null;
}

/** The legacy screen for a route that has no redesigned screen yet. */
export function legacyScreen(route: Route): React.ReactElement {
  const legacy = toLegacy(route);
  switch (legacy.name) {
    case 'restaurant':
      return <RestaurantScreen restaurantId={legacy.restaurantId} />;
    case 'cart':
      return <CartScreen />;
    case 'checkout':
      return <CheckoutScreen />;
    case 'tracking':
      return <TrackingScreen orderId={legacy.orderId} />;
    case 'orders':
      return <OrdersScreen />;
    case 'addresses':
      return <AddressesScreen />;
    case 'addressForm':
      return <AddressFormScreen addressId={legacy.addressId} />;
    case 'profile':
      return <ProfileScreen />;
    default:
      return <DiscoveryScreen />;
  }
}
