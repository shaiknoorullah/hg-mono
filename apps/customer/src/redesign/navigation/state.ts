/**
 * The redesign navigator's state: one push stack per tab, the active tab, and the signed-out
 * stack. Pure, so the reducer is unit-tested without rendering.
 *
 * - Switching tabs keeps each tab's stack (pressing the active tab again pops it to its root).
 * - `open` puts a route on the stack of the tab it belongs to and switches there (deep links,
 *   `verifyOtp.next_route` landings, "View order" from the cart).
 * - `reset` drops every stack and lands on one route (sign-in finished, order placed).
 */
import { TAB_ORDER, TAB_ROOTS, tabFor, type Route, type TabKey } from './routes';

export interface NavState {
  tab: TabKey;
  stacks: Record<TabKey, Route[]>;
}

export type NavAction =
  | { type: 'push'; route: Route }
  | { type: 'replace'; route: Route }
  | { type: 'back' }
  | { type: 'selectTab'; tab: TabKey }
  | { type: 'open'; route: Route }
  /** `tab` puts the route on that tab's stack instead of its own (sign-in → active order, Back → Home). */
  | { type: 'reset'; route: Route; tab?: TabKey };

function freshStacks(): Record<TabKey, Route[]> {
  return Object.fromEntries(TAB_ORDER.map((t) => [t, [TAB_ROOTS[t]]])) as Record<TabKey, Route[]>;
}

export function initialNavState(landing: Route = TAB_ROOTS.home, tab?: TabKey): NavState {
  return reduceNav({ tab: 'home', stacks: freshStacks() }, { type: 'reset', route: landing, tab });
}

export function currentRoute(state: NavState): Route {
  const stack = state.stacks[state.tab];
  return stack[stack.length - 1]!;
}

export function canGoBack(state: NavState): boolean {
  return state.stacks[state.tab].length > 1;
}

export function reduceNav(state: NavState, action: NavAction): NavState {
  const stack = state.stacks[state.tab];
  switch (action.type) {
    case 'push':
      return { ...state, stacks: { ...state.stacks, [state.tab]: [...stack, action.route] } };
    case 'replace':
      return { ...state, stacks: { ...state.stacks, [state.tab]: [...stack.slice(0, -1), action.route] } };
    case 'back':
      if (stack.length <= 1) return state;
      return { ...state, stacks: { ...state.stacks, [state.tab]: stack.slice(0, -1) } };
    case 'selectTab':
      if (action.tab === state.tab) {
        if (stack.length === 1) return state;
        return { ...state, stacks: { ...state.stacks, [state.tab]: [TAB_ROOTS[state.tab]] } };
      }
      return { ...state, tab: action.tab };
    case 'open': {
      const tab = tabFor(action.route);
      const target = state.stacks[tab];
      const top = target[target.length - 1]!;
      if (top.name === action.route.name && JSON.stringify(top) === JSON.stringify(action.route)) {
        return { ...state, tab };
      }
      const next = action.route.name === TAB_ROOTS[tab].name ? [TAB_ROOTS[tab]] : [...target, action.route];
      return { tab, stacks: { ...state.stacks, [tab]: next } };
    }
    case 'reset': {
      const tab = action.tab ?? tabFor(action.route);
      const stacks = freshStacks();
      if (action.route.name !== TAB_ROOTS[tab].name) stacks[tab] = [TAB_ROOTS[tab], action.route];
      return { tab, stacks };
    }
    default:
      return state;
  }
}
