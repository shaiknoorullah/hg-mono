/**
 * `useNav()`: the navigation API every redesigned screen uses.
 */
import * as React from 'react';

import type { Route, TabKey } from './routes';

export interface Nav {
  current: Route;
  tab: TabKey;
  canGoBack: boolean;
  push: (route: Route) => void;
  replace: (route: Route) => void;
  back: () => void;
  selectTab: (tab: TabKey) => void;
  /** Open a route on the tab it belongs to (deep links, "View order"). */
  open: (route: Route) => void;
  /** Drop every stack and land on one route (order placed, sign-in finished). */
  reset: (route: Route) => void;
}

export const NavContext = React.createContext<Nav | null>(null);

export function useNav(): Nav {
  const nav = React.useContext(NavContext);
  if (!nav) throw new Error('useNav must be used inside the redesign Shell');
  return nav;
}
