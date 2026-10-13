/**
 * The redesign's navigation shell (manifest §1, WP0).
 *
 * - No session: the signed-out flow (WP1's sign-in owns its own stack: sign-in, code, terms).
 * - A forced route (S5) replaces everything, with no bottom navigation.
 * - Signed in: four tabs, Home · Search · Orders · Account (no bell), each with its own stack. The
 *   bottom navigation shows on tab roots only; the Orders tab carries the count of active orders.
 * - Deep links open on the tab they belong to.
 */
import * as React from 'react';
import { BackHandler, Linking, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { unwrap } from '@hg/api-client';

import { LoginGate } from '../../../App';
import { BottomNav, Icon, Toast, tokens, useTheme, type BottomNavItem } from '../ds';
import { api } from '../api/client';
import { BlockedScreen } from '../session/BlockedScreen';
import { useForcedRoute } from '../session/forced';
import { clearWelcome, useSession } from '../session/session';
import { NavContext, type Nav } from './context';
import { routeForUrl } from './deepLinks';
import { LegacyBridge } from './LegacyBridge';
import { legacyScreen, redesignedScreen } from './registry';
import { isTabRoot, routeKey, type Route, type TabKey } from './routes';
import { canGoBack, currentRoute, initialNavState, reduceNav } from './state';

const TAB_ITEMS: readonly BottomNavItem[] = [
  { key: 'home', label: 'Home', icon: <Icon name="home" weight="linear" />, activeIcon: <Icon name="home" weight="bold" /> },
  { key: 'search', label: 'Search', icon: <Icon name="search" weight="linear" />, activeIcon: <Icon name="search" weight="bold" /> },
  { key: 'orders', label: 'Orders', icon: <Icon name="orders" weight="linear" />, activeIcon: <Icon name="orders" weight="bold" />, badgeNoun: 'active' },
  { key: 'account', label: 'Account', icon: <Icon name="profile" weight="linear" />, activeIcon: <Icon name="profile" weight="bold" /> },
];

/** Count of ACTIVE orders for the Orders tab badge (DISPUTED included, manifest T9). */
export function useActiveOrderCount(tab: TabKey): number {
  const [count, setCount] = React.useState(0);
  React.useEffect(() => {
    let live = true;
    unwrap(api.GET('/v1/orders', { params: { query: { status_group: 'ACTIVE' } } }))
      .then((body) => {
        if (live) setCount(Array.isArray(body.data) ? body.data.length : 0);
      })
      .catch(() => {
        // A failed count shows no badge; Orders itself shows the error.
      });
    return () => {
      live = false;
    };
  }, [tab]);
  return count;
}

function ScreenFor({ route, nav }: { route: Route; nav: Nav }): React.ReactElement {
  const redesigned = redesignedScreen(route);
  if (redesigned) return redesigned;
  return (
    <LegacyBridge nav={nav} route={route}>
      {legacyScreen(route)}
    </LegacyBridge>
  );
}

/**
 * The one greeting after sign-in or the first address ("You're signed in" · "Welcome back, Aisha.",
 * "Address saved"), docked above the bottom navigation (WP1, `SI/SignedIn`). Home does not show it
 * again.
 */
function WelcomeToast(): React.ReactElement | null {
  const { welcome } = useSession();
  if (!welcome) return null;
  return (
    <View pointerEvents="box-none" style={[styles.toastDock, { bottom: tokens.space['20'] }]}>
      <Toast
        variant={welcome.variant}
        title={welcome.title}
        description={welcome.description}
        onDismiss={clearWelcome}
        testID="WelcomeToast"
      />
    </View>
  );
}

function Tabs({
  landing,
  landingTab,
  pendingLink,
}: {
  landing: Route;
  landingTab: TabKey | null;
  pendingLink: Route | null;
}): React.ReactElement {
  const theme = useTheme();
  const [state, dispatch] = React.useReducer(reduceNav, landing, (route) => initialNavState(route, landingTab ?? undefined));
  const current = currentRoute(state);
  const back = canGoBack(state);

  React.useEffect(() => {
    if (pendingLink) dispatch({ type: 'open', route: pendingLink });
  }, [pendingLink]);

  // Android's Back pops the tab's stack, like the page's own back; on a tab root it is the
  // system's (it leaves the app).
  React.useEffect(() => {
    if (!back) return undefined;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      dispatch({ type: 'back' });
      return true;
    });
    return () => sub.remove();
  }, [back]);

  const nav = React.useMemo<Nav>(
    () => ({
      current,
      tab: state.tab,
      canGoBack: back,
      push: (route) => dispatch({ type: 'push', route }),
      replace: (route) => dispatch({ type: 'replace', route }),
      back: () => dispatch({ type: 'back' }),
      selectTab: (tab) => dispatch({ type: 'selectTab', tab }),
      open: (route) => dispatch({ type: 'open', route }),
      reset: (route) => dispatch({ type: 'reset', route }),
    }),
    [current, state.tab, back],
  );

  const activeCount = useActiveOrderCount(state.tab);
  const items = React.useMemo(
    () => TAB_ITEMS.map((t) => (t.key === 'orders' && activeCount > 0 ? { ...t, badge: activeCount } : t)),
    [activeCount],
  );

  return (
    <NavContext.Provider value={nav}>
      <View style={[styles.fill, { backgroundColor: theme.color.surface.base }]}>
        <View style={styles.fill}>
          <React.Fragment key={`${state.tab}:${routeKey(current)}`}>
            <ScreenFor route={current} nav={nav} />
          </React.Fragment>
        </View>
        {isTabRoot(current) ? (
          <BottomNav
            items={items}
            active={state.tab}
            onChange={(key) => dispatch({ type: 'selectTab', tab: key as TabKey })}
            testID="RedesignBottomNav"
          />
        ) : null}
        <WelcomeToast />
      </View>
    </NavContext.Provider>
  );
}

/** The signed-out flow. The legacy sign-in renders until the redesigned one (WP1) registers. */
function SignedOut(): React.ReactElement {
  const signIn = redesignedScreen({ name: 'signIn' });
  return signIn ?? <LoginGate />;
}

export function Shell(): React.ReactElement {
  const theme = useTheme();
  const session = useSession();
  const forced = useForcedRoute();
  const [pendingLink, setPendingLink] = React.useState<Route | null>(null);

  React.useEffect(() => {
    let live = true;
    void Linking.getInitialURL()
      .then((url) => {
        const route = routeForUrl(url);
        if (live && route) setPendingLink(route);
      })
      .catch(() => {});
    const sub = Linking.addEventListener('url', ({ url }) => {
      const route = routeForUrl(url);
      if (route) setPendingLink(route);
    });
    return () => {
      live = false;
      sub.remove();
    };
  }, []);

  if (forced) return <BlockedScreen forced={forced} />;

  if (session.phase === 'signin' || session.phase === 'verifying') {
    return (
      <SafeAreaView style={[styles.fill, { backgroundColor: theme.color.surface.base }]} testID="RedesignSignedOut">
        <SignedOut />
      </SafeAreaView>
    );
  }

  if (session.phase === 'profile') {
    const details = redesignedScreen({ name: 'yourDetails' });
    if (details) return details;
  }

  return (
    <Tabs
      key={`${session.landingTab ?? ''}:${routeKey(session.landing)}`}
      landing={session.landing}
      landingTab={session.landingTab}
      pendingLink={pendingLink}
    />
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  toastDock: { position: 'absolute', left: 16, right: 16 },
});
