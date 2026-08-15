/**
 * A minimal typed screen stack for the rider app.
 *
 * The four V0 screens form a short, linear work loop (Home → Availability → Offer → Assignment),
 * so instead of pulling in `@react-navigation/native-stack` — which drags in
 * `react-native-screens` and forks the Metro singleton/web-export surface this app has already
 * tuned by hand — we keep a hand-rolled stack over the deps already present. It is a real stack:
 * `push`/`pop`/`reset`, typed params, a hardware/browser back affordance via `canGoBack`, and a
 * single active screen rendered at a time. Swapping it for React Navigation later is a drop-in:
 * the `useNav()` surface mirrors `navigation.navigate` / `.goBack`.
 */
import * as React from 'react';

/** Every screen and the params it requires. `undefined` means "no params". */
export type RiderRoutes = {
  home: undefined;
  availability: undefined;
  offer: undefined;
  assignment: { assignmentId: string; scenario?: string };
  onboarding: undefined;
  earnings: { tab?: 'summary' | 'entries' | 'payouts' };
  payoutDetail: { payoutId: string };
  profile: undefined;
  deliveries: undefined;
};

export type ScreenName = keyof RiderRoutes;

/** A single stack frame: a screen name and its params, kept as a discriminated union. */
export type StackEntry = {
  [K in ScreenName]: { name: K; params: RiderRoutes[K] };
}[ScreenName];

interface NavContextValue {
  readonly current: StackEntry;
  readonly canGoBack: boolean;
  push: <K extends ScreenName>(name: K, params: RiderRoutes[K]) => void;
  replace: <K extends ScreenName>(name: K, params: RiderRoutes[K]) => void;
  pop: () => void;
  resetHome: () => void;
}

const NavContext = React.createContext<NavContextValue | null>(null);

export function NavProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [stack, setStack] = React.useState<StackEntry[]>([{ name: 'home', params: undefined }]);

  const push = React.useCallback<NavContextValue['push']>((name, params) => {
    setStack((s) => [...s, { name, params } as StackEntry]);
  }, []);

  const replace = React.useCallback<NavContextValue['replace']>((name, params) => {
    setStack((s) => [...s.slice(0, -1), { name, params } as StackEntry]);
  }, []);

  const pop = React.useCallback(() => {
    setStack((s) => (s.length > 1 ? s.slice(0, -1) : s));
  }, []);

  const resetHome = React.useCallback(() => {
    setStack([{ name: 'home', params: undefined }]);
  }, []);

  const value = React.useMemo<NavContextValue>(
    () => ({
      current: stack[stack.length - 1]!,
      canGoBack: stack.length > 1,
      push,
      replace,
      pop,
      resetHome,
    }),
    [stack, push, replace, pop, resetHome],
  );

  return <NavContext.Provider value={value}>{children}</NavContext.Provider>;
}

export function useNav(): NavContextValue {
  const ctx = React.useContext(NavContext);
  if (!ctx) throw new Error('useNav must be used within a NavProvider');
  return ctx;
}
