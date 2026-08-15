/**
 * A minimal, dependency-free stack navigator.
 *
 * The V0 customer flows are a strict push/pop journey — Discovery → Restaurant → Cart →
 * Checkout → Tracking — so a full navigation library would be more moving parts than the
 * flows need. This is a typed route union in a `useReducer` stack, exposed through a tiny
 * `useNavigation()` hook. Every screen is a plain component that reads its params from the
 * top frame; `back()` pops. It renders only the top of the stack, which is all a phone shows.
 *
 * If these flows grew tabs, deep links or a URL, this is the seam where `@react-navigation`
 * would drop in — the screens themselves only depend on `useNavigation()`, not on this file's
 * internals.
 */
import * as React from 'react';

/** The route table. Adding a screen means adding a member here and a case in the registry. */
export type Route =
  | { name: 'discovery' }
  | { name: 'restaurant'; restaurantId: string }
  | { name: 'cart' }
  | { name: 'checkout' }
  | { name: 'tracking'; orderId: string }
  | { name: 'orders' }
  | { name: 'rateOrder'; orderId: string }
  | { name: 'notifications' }
  | { name: 'profile' }
  | { name: 'addresses' }
  | { name: 'addressForm'; addressId: string | null };

export type RouteName = Route['name'];

interface NavState {
  stack: Route[];
}

type NavAction =
  | { type: 'push'; route: Route }
  | { type: 'replace'; route: Route }
  | { type: 'pop' }
  | { type: 'popTo'; name: RouteName }
  | { type: 'reset'; route: Route };

function reducer(state: NavState, action: NavAction): NavState {
  switch (action.type) {
    case 'push':
      return { stack: [...state.stack, action.route] };
    case 'replace':
      return { stack: [...state.stack.slice(0, -1), action.route] };
    case 'pop':
      return state.stack.length > 1 ? { stack: state.stack.slice(0, -1) } : state;
    case 'popTo': {
      const idx = state.stack.map((r) => r.name).lastIndexOf(action.name);
      if (idx < 0) return state;
      return { stack: state.stack.slice(0, idx + 1) };
    }
    case 'reset':
      return { stack: [action.route] };
    default:
      return state;
  }
}

export interface Navigation {
  /** The route currently on screen. */
  current: Route;
  /** Whether a back action would leave this screen on the stack. */
  canGoBack: boolean;
  push: (route: Route) => void;
  /** Swap the top frame — used to hand off cart → checkout → tracking without a growing stack. */
  replace: (route: Route) => void;
  back: () => void;
  /** Pop back to the nearest frame with this name, e.g. tracking → discovery. */
  popTo: (name: RouteName) => void;
  /** Clear the stack down to a single route — placing an order resets to tracking. */
  reset: (route: Route) => void;
}

const NavContext = React.createContext<Navigation | null>(null);

export function NavigationProvider({
  initial = { name: 'discovery' },
  children,
}: {
  initial?: Route;
  children: (current: Route) => React.ReactNode;
}): React.ReactElement {
  const [state, dispatch] = React.useReducer(reducer, { stack: [initial] });

  const current = state.stack[state.stack.length - 1]!;

  const nav = React.useMemo<Navigation>(
    () => ({
      current,
      canGoBack: state.stack.length > 1,
      push: (route) => dispatch({ type: 'push', route }),
      replace: (route) => dispatch({ type: 'replace', route }),
      back: () => dispatch({ type: 'pop' }),
      popTo: (name) => dispatch({ type: 'popTo', name }),
      reset: (route) => dispatch({ type: 'reset', route }),
    }),
    [current, state.stack.length],
  );

  return <NavContext.Provider value={nav}>{children(current)}</NavContext.Provider>;
}

export function useNavigation(): Navigation {
  const nav = React.useContext(NavContext);
  if (!nav) throw new Error('useNavigation must be used within a NavigationProvider');
  return nav;
}
