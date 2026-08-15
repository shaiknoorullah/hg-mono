/**
 * The one place the route union is turned into a screen.
 *
 * `NavigationProvider` owns the stack and hands us the top route; this switch maps it to the
 * screen component and its params. Adding a flow means adding a `Route` member (in `stack.tsx`)
 * and a case here — the compiler enforces the pairing through the exhaustive switch.
 */
import * as React from 'react';

import { DiscoveryScreen } from '../screens/DiscoveryScreen';
import { RestaurantScreen } from '../screens/RestaurantScreen';
import { CartScreen } from '../screens/CartScreen';
import { CheckoutScreen } from '../screens/CheckoutScreen';
import { TrackingScreen } from '../screens/TrackingScreen';
import { OrdersScreen } from '../screens/OrdersScreen';
import { RateOrderScreen } from '../screens/RateOrderScreen';
import { NotificationsScreen } from '../screens/NotificationsScreen';
import { ProfileScreen } from '../screens/ProfileScreen';
import { AddressesScreen } from '../screens/AddressesScreen';
import { AddressFormScreen } from '../screens/AddressFormScreen';
import { NavigationProvider } from './stack';
import type { Route } from './stack';

function screenFor(route: Route): React.ReactElement {
  switch (route.name) {
    case 'discovery':
      return <DiscoveryScreen />;
    case 'restaurant':
      return <RestaurantScreen restaurantId={route.restaurantId} />;
    case 'cart':
      return <CartScreen />;
    case 'checkout':
      return <CheckoutScreen />;
    case 'tracking':
      return <TrackingScreen orderId={route.orderId} />;
    case 'orders':
      return <OrdersScreen />;
    case 'rateOrder':
      return <RateOrderScreen orderId={route.orderId} />;
    case 'notifications':
      return <NotificationsScreen />;
    case 'profile':
      return <ProfileScreen />;
    case 'addresses':
      return <AddressesScreen />;
    case 'addressForm':
      return <AddressFormScreen addressId={route.addressId} />;
    default: {
      // Exhaustiveness: a new route with no case is a compile error here.
      const _never: never = route;
      return _never;
    }
  }
}

export function Router(): React.ReactElement {
  return (
    <NavigationProvider initial={{ name: 'discovery' }}>
      {(route) => (
        // Keying on the route identity remounts a screen when its params change (e.g. a
        // different restaurant), so each screen's own fetch effects re-run cleanly.
        <React.Fragment key={routeKey(route)}>{screenFor(route)}</React.Fragment>
      )}
    </NavigationProvider>
  );
}

function routeKey(route: Route): string {
  switch (route.name) {
    case 'restaurant':
      return `restaurant:${route.restaurantId}`;
    case 'tracking':
      return `tracking:${route.orderId}`;
    case 'rateOrder':
      return `rateOrder:${route.orderId}`;
    case 'addressForm':
      return `addressForm:${route.addressId ?? 'new'}`;
    default:
      return route.name;
  }
}
