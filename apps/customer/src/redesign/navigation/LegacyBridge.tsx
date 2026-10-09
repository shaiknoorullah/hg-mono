/**
 * Route-by-route fallback to the legacy screens (MASTER-PLAN §0.3).
 *
 * Until a redesigned screen for a route merges, the shell renders the legacy screen for it. The
 * legacy screen calls the legacy `useNavigation()`; this bridge provides that context and
 * translates each call into the redesign navigator, so a legacy Restaurant can still push the
 * legacy Cart, and a redesigned Home can push a legacy Restaurant. Any WP can be dropped or reverted
 * on its own and the app still works.
 */
import * as React from 'react';

import { LegacyNavContext, type Navigation as LegacyNavigation, type Route as LegacyRoute } from '../../navigation/stack';
import { EmbeddedInRedesignContext } from '../../navigation/TabBar';
import type { Nav } from './context';
import type { Route, TabKey } from './routes';

/** A legacy route, as the redesign names it. */
export function fromLegacy(route: LegacyRoute): Route {
  switch (route.name) {
    case 'discovery':
    case 'notifications':
      return { name: 'home' };
    case 'profile':
      return { name: 'account' };
    case 'rateOrder':
      return { name: 'receipt', orderId: route.orderId };
    case 'restaurant':
      return { name: 'restaurant', restaurantId: route.restaurantId };
    case 'tracking':
      return { name: 'tracking', orderId: route.orderId };
    case 'addressForm':
      return { name: 'addressForm', addressId: route.addressId };
    case 'cart':
    case 'checkout':
    case 'orders':
    case 'addresses':
      return { name: route.name };
    default: {
      const _never: never = route;
      return _never;
    }
  }
}

/** The legacy route a legacy screen should believe it is on. */
export function toLegacy(route: Route): LegacyRoute {
  switch (route.name) {
    case 'restaurant':
    case 'certificate':
      return { name: 'restaurant', restaurantId: route.restaurantId };
    case 'tracking':
    case 'receipt':
    case 'reportProblem':
      return { name: 'tracking', orderId: route.orderId };
    case 'addressForm':
      return { name: 'addressForm', addressId: route.addressId };
    case 'addressStep':
      return { name: 'addressForm', addressId: null };
    case 'cart':
    case 'checkout':
    case 'orders':
    case 'addresses':
      return { name: route.name };
    case 'account':
    case 'yourDetails':
    case 'notificationSettings':
    case 'appSettings':
    case 'whatsNew':
    case 'emailVerify':
    case 'terms':
      return { name: 'profile' };
    default:
      return { name: 'discovery' };
  }
}

const TAB_OF_LEGACY: Partial<Record<LegacyRoute['name'], TabKey>> = {
  discovery: 'home',
  notifications: 'home',
  orders: 'orders',
  profile: 'account',
};

export function legacyNavigationFor(nav: Nav, route: Route): LegacyNavigation {
  return {
    current: toLegacy(route),
    canGoBack: nav.canGoBack,
    push: (r) => nav.push(fromLegacy(r)),
    replace: (r) => nav.replace(fromLegacy(r)),
    back: nav.back,
    popTo: (name) => {
      const tab = TAB_OF_LEGACY[name];
      if (tab) nav.selectTab(tab);
      else nav.back();
    },
    reset: (r) => {
      const tab = TAB_OF_LEGACY[r.name];
      if (tab) nav.selectTab(tab);
      else nav.reset(fromLegacy(r));
    },
  };
}

export function LegacyBridge({
  nav,
  route,
  children,
}: {
  nav: Nav;
  route: Route;
  children: React.ReactNode;
}): React.ReactElement {
  const legacy = React.useMemo(() => legacyNavigationFor(nav, route), [nav, route]);
  return (
    <EmbeddedInRedesignContext.Provider value>
      <LegacyNavContext.Provider value={legacy}>{children}</LegacyNavContext.Provider>
    </EmbeddedInRedesignContext.Provider>
  );
}
