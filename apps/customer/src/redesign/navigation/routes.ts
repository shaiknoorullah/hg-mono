/**
 * The customer redesign's routes (manifest §1).
 *
 * Four tabs (Home · Search · Orders · Account), each with its own push stack, plus the signed-out
 * flow and the forced full-screen routes. Sheets (item, certification, address switcher, filters,
 * cancel, get help, checkout sheets, edit details) are owned by their screen, not routes.
 *
 * Removed from the legacy union: `rateOrder` (ratings are V1), `notifications` (no bell at launch),
 * `profile` (now `account`).
 */
export type TabKey = 'home' | 'search' | 'orders' | 'account';

export type Route =
  // Signed out and first run (S1–S4, S6)
  | { name: 'signIn' }
  | { name: 'code' }
  | { name: 'yourDetails'; fromCart?: boolean }
  | { name: 'addressStep' }
  | { name: 'signedOut'; reason?: 'signedOut' | 'notYou' }
  | { name: 'terms'; signedOut?: boolean }
  // Tab roots
  | { name: 'home' }
  | { name: 'search' }
  | { name: 'orders' }
  | { name: 'account' }
  // Discover
  | { name: 'browse'; sort?: string; openNow?: boolean }
  | { name: 'howWeCheck' }
  | { name: 'restaurant'; restaurantId: string }
  | { name: 'certificate'; restaurantId: string }
  // Order
  | { name: 'cart' }
  | { name: 'checkout' }
  | { name: 'tracking'; orderId: string }
  | { name: 'receipt'; orderId: string }
  | { name: 'reportProblem'; orderId: string; reason?: string }
  // Account
  | { name: 'addresses' }
  | { name: 'addressForm'; addressId: string | null; first?: boolean }
  | { name: 'notificationSettings' }
  | { name: 'appSettings' }
  | { name: 'whatsNew' }
  | { name: 'emailVerify'; token: string };

export type RouteName = Route['name'];

export const TAB_ROOTS: Record<TabKey, Route> = {
  home: { name: 'home' },
  search: { name: 'search' },
  orders: { name: 'orders' },
  account: { name: 'account' },
};

export const TAB_ORDER: readonly TabKey[] = ['home', 'search', 'orders', 'account'];

/** Routes of the signed-out flow; everything else needs a session. */
const SIGNED_OUT: ReadonlySet<RouteName> = new Set(['signIn', 'code', 'signedOut', 'terms']);

export function isSignedOutRoute(route: Route): boolean {
  return SIGNED_OUT.has(route.name);
}

export function isTabRoot(route: Route): boolean {
  return route.name === 'home' || route.name === 'search' || route.name === 'orders' || route.name === 'account';
}

/** The tab a pushed route belongs to when it is opened from outside a tab (deep link, landing). */
export function tabFor(route: Route): TabKey {
  switch (route.name) {
    case 'search':
      return 'search';
    case 'orders':
    case 'tracking':
    case 'receipt':
    case 'reportProblem':
      return 'orders';
    case 'account':
    case 'addresses':
    case 'addressForm':
    case 'notificationSettings':
    case 'appSettings':
    case 'whatsNew':
    case 'emailVerify':
      return 'account';
    default:
      return 'home';
  }
}

/** Remounts a screen when its params change, so its fetch effects re-run cleanly. */
export function routeKey(route: Route): string {
  switch (route.name) {
    case 'restaurant':
    case 'certificate':
      return `${route.name}:${route.restaurantId}`;
    case 'tracking':
    case 'receipt':
    case 'reportProblem':
      return `${route.name}:${route.orderId}`;
    case 'addressForm':
      return `addressForm:${route.addressId ?? 'new'}`;
    case 'emailVerify':
      return `emailVerify:${route.token}`;
    default:
      return route.name;
  }
}
