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
import { CartScreen as RedesignedCartScreen } from '../cart/CartScreen';
import { CheckoutScreen as RedesignedCheckoutScreen } from '../checkout/CheckoutScreen';
import { OrdersScreen as RedesignedOrdersScreen } from '../orders/OrdersScreen';
import { ReceiptScreen } from '../orders/ReceiptScreen';
import { TrackingScreen as RedesignedTrackingScreen } from '../tracking/TrackingScreen';
import { HomeScreen } from '../discover/HomeScreen';
import { HowWeCheckScreen } from '../discover/HowWeCheckScreen';
import { CertificateScreen } from '../restaurant/CertificateScreen';
import { RestaurantScreen as RedesignedRestaurantScreen } from '../restaurant/RestaurantScreen';
import { AccountScreen } from '../account/AccountScreen';
import { AddressesScreen as RedesignedAddressesScreen } from '../account/AddressesScreen';
import { EmailVerifyScreen } from '../account/EmailVerifyScreen';
import { NotificationSettingsScreen } from '../account/NotificationSettingsScreen';
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
  // WP10/WP11: Account (with its edit sheet and sign-out), Saved addresses, Notification settings
  // and the email-link page. App settings, What's new and the address form are not built yet and
  // still fall back to legacy or to Account.
  account: () => <AccountScreen />,
  addresses: () => <RedesignedAddressesScreen />,
  notificationSettings: () => <NotificationSettingsScreen />,
  emailVerify: (r) => <EmailVerifyScreen token={r.token} />,
  // WP4: restaurant page (with its certification sheet) and the certificate viewer.
  restaurant: (r) => <RedesignedRestaurantScreen restaurantId={r.restaurantId} />,
  certificate: (r) => <CertificateScreen restaurantId={r.restaurantId} />,
  // WP5: the cart (the item sheet is owned by the restaurant page and the cart, not a route).
  cart: () => <RedesignedCartScreen />,
  // Checkout: the last step of the order flow (price, pay, recover a declined payment).
  checkout: () => <RedesignedCheckoutScreen />,
  // WP9: Orders history (T9) and Receipt (T10).
  orders: () => <RedesignedOrdersScreen />,
  receipt: (route) => <ReceiptScreen orderId={route.orderId} />,
  // Order tracking (waiting and live layouts). The delivered and outcome states, the cancel and
  // Get help sheets and payment recovery are not built yet; a state this screen does not draw hands
  // over to the legacy tracking screen, and `sheet: 'getHelp'` opens the order page without a sheet.
  tracking: (r) => <RedesignedTrackingScreen orderId={r.orderId} />,
  // WP2: Home, address switcher (a sheet owned by Home), How we check.
  home: () => <HomeScreen />,
  howWeCheck: () => <HowWeCheckScreen />,
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
