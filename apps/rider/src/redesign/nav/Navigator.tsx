/**
 * The redesign navigator: three tabs, each with its own stack, plus one full-screen flow that
 * covers the tabs (the trip, the application). Hand-rolled like the legacy `nav.tsx`, for the
 * same reason (no `react-native-screens` Metro fork), and small enough to test directly.
 *
 * - `push`/`replace`/`pop` act on the flow when one is open, else on the current tab's stack.
 * - Switching tabs keeps each tab's stack; tapping the current tab returns it to its root.
 * - Android Back: a screen registered `back: 'none'` swallows it; otherwise pop. Back never
 *   closes a flow (the flow closes itself when its job ends); from a tab root it goes to the
 *   Home tab, and from Home's root to the OS.
 */
import * as React from 'react';
import { BackHandler } from 'react-native';

import { screenFor } from './registry';
import { TABS, type Entry, type ParamsOf, type RouteName, type Tab } from './routes';

export interface Nav {
  tab: Tab;
  /** The screen showing: the top of the flow, else the top of the current tab. */
  current: Entry;
  /** The current tab's stack (unchanged while a flow covers it). */
  stack: readonly Entry[];
  flow: readonly Entry[] | null;
  canGoBack: boolean;
  switchTab: (tab: Tab) => void;
  push: <K extends RouteName>(name: K, ...params: ParamArgs<K>) => void;
  replace: <K extends RouteName>(name: K, ...params: ParamArgs<K>) => void;
  /** Returns false when there was nothing to pop. */
  pop: () => boolean;
  popToRoot: () => void;
  /** Open (or replace) the full-screen flow. */
  openFlow: <K extends RouteName>(name: K, ...params: ParamArgs<K>) => void;
  closeFlow: () => void;
}

type ParamArgs<K extends RouteName> = ParamsOf<K> extends undefined ? [params?: undefined] : [params: ParamsOf<K>];

let seq = 0;
function entry<K extends RouteName>(name: K, params: ParamsOf<K>): Entry {
  seq += 1;
  return { key: `${name}-${seq}`, name, params } as Entry;
}

interface State {
  tab: Tab;
  stacks: Record<Tab, Entry[]>;
  flow: Entry[] | null;
}

function initialState(initialTab: Tab, initialFlow: Entry | null): State {
  return {
    tab: initialTab,
    stacks: {
      home: [entry('home', undefined)],
      earnings: [entry('earnings', undefined)],
      account: [entry('account', undefined)],
    },
    flow: initialFlow ? [initialFlow] : null,
  };
}

const NavContext = React.createContext<Nav | null>(null);

export interface NavigatorProps {
  initialTab?: Tab;
  /** A flow to open on mount (the gate's trip or application). */
  initialFlow?: { name: RouteName; params: unknown } | null;
  children: React.ReactNode;
}

export function Navigator({ initialTab = 'home', initialFlow = null, children }: NavigatorProps): React.ReactElement {
  const [state, setState] = React.useState<State>(() =>
    initialState(initialTab, initialFlow ? entry(initialFlow.name, initialFlow.params as never) : null),
  );
  const stateRef = React.useRef(state);
  stateRef.current = state;

  const nav = React.useMemo<Nav>(() => {
    const top = state.flow ? state.flow[state.flow.length - 1]! : state.stacks[state.tab][state.stacks[state.tab].length - 1]!;
    const mutateTop = (fn: (s: Entry[]) => Entry[]) =>
      setState((s) => (s.flow ? { ...s, flow: fn(s.flow) } : { ...s, stacks: { ...s.stacks, [s.tab]: fn(s.stacks[s.tab]) } }));
    return {
      tab: state.tab,
      current: top,
      stack: state.stacks[state.tab],
      flow: state.flow,
      canGoBack: state.flow ? state.flow.length > 1 : state.stacks[state.tab].length > 1,
      switchTab: (tab) =>
        setState((s) =>
          s.tab === tab ? { ...s, stacks: { ...s.stacks, [tab]: s.stacks[tab].slice(0, 1) } } : { ...s, tab },
        ),
      push: (name, ...params) => mutateTop((st) => [...st, entry(name, params[0] as never)]),
      replace: (name, ...params) => mutateTop((st) => [...st.slice(0, -1), entry(name, params[0] as never)]),
      pop: () => {
        const s = stateRef.current;
        const st = s.flow ?? s.stacks[s.tab];
        if (st.length <= 1) return false;
        mutateTop((x) => x.slice(0, -1));
        return true;
      },
      popToRoot: () => mutateTop((st) => st.slice(0, 1)),
      openFlow: (name, ...params) => setState((s) => ({ ...s, flow: [entry(name, params[0] as never)] })),
      closeFlow: () => setState((s) => ({ ...s, flow: null })),
    };
  }, [state]);

  const navRef = React.useRef(nav);
  navRef.current = nav;
  React.useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => handleBack(navRef.current));
    return () => sub.remove();
  }, []);

  return <NavContext.Provider value={nav}>{children}</NavContext.Provider>;
}

/** What Android Back does. `true` = handled (the OS does nothing). Exported for tests. */
export function handleBack(nav: Nav): boolean {
  if (screenFor(nav.current.name)?.back === 'none') return true;
  if (nav.pop()) return true;
  if (nav.flow) return true; // a flow closes itself; Back never drops a rider out of a delivery
  if (nav.tab !== 'home') {
    nav.switchTab('home');
    return true;
  }
  return false;
}

export function useNav(): Nav {
  const nav = React.useContext(NavContext);
  if (!nav) throw new Error('useNav must be used inside the redesign <Navigator>');
  return nav;
}

export { TABS };
