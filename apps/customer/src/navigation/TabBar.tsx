/**
 * The four top-level tabs, shared across Discover / Orders / Notifications / Profile.
 *
 * Each tab screen is a peer top-level route (not nested inside a tab navigator this app's
 * minimal stack doesn't have), so switching tabs is `nav.reset({ name })` — it clears whatever
 * push-stack the previous tab had grown, which is the right behaviour for a tab bar: pressing
 * "Orders" from three screens deep in Discover should land on Orders' root, not resume a stale
 * push stack. `BottomNav` itself is `@hg/ui-native`'s glass pill — same component as the rider
 * app, themed by the `customer` register.
 *
 * Icons come from the `Icon` primitive (Solar set): **linear = inactive, bold = active**, per
 * the shared convention documented on `BottomNav` itself. The detached primary action is the
 * cart affordance — orange soft-tint by construction (never green: RULE H-1 reserves solid
 * green for halal certification alone), never embedded as a sixth tab.
 */
import * as React from 'react';
import { BottomNav, Icon } from '@hg/ui-native';
import type { BottomNavItem } from '@hg/ui-native';

import { useNavigation, type Route, type RouteName } from './stack';

type TabKey = 'discovery' | 'orders' | 'notifications' | 'profile';

const TABS: readonly BottomNavItem[] = [
  {
    key: 'discovery',
    label: 'Discover',
    icon: <Icon name="home" weight="linear" />,
    activeIcon: <Icon name="home" weight="bold" />,
  },
  {
    key: 'orders',
    label: 'Orders',
    icon: <Icon name="orders" weight="linear" />,
    activeIcon: <Icon name="orders" weight="bold" />,
  },
  {
    key: 'notifications',
    label: 'Alerts',
    icon: <Icon name="bell" weight="linear" />,
    activeIcon: <Icon name="bell" weight="bold" />,
  },
  {
    key: 'profile',
    label: 'Profile',
    icon: <Icon name="profile" weight="linear" />,
    activeIcon: <Icon name="profile" weight="bold" />,
  },
];

export function CustomerTabBar({
  active,
  unreadCount = 0,
}: {
  active: RouteName;
  /** Folded into the Alerts tab's accessible name, e.g. "Alerts, 3 new" — never a bare node. */
  unreadCount?: number;
}): React.ReactElement {
  const nav = useNavigation();
  const items = React.useMemo(
    () =>
      TABS.map((t) => (t.key === 'notifications' && unreadCount > 0 ? { ...t, badge: unreadCount } : t)),
    [unreadCount],
  );
  return (
    <BottomNav
      items={items}
      active={active}
      onChange={(key) => {
        if (key === active) return;
        nav.reset({ name: key as TabKey } as Route);
      }}
      action={{
        label: 'View cart',
        icon: <Icon name="cart" weight="bold" />,
        onPress: () => nav.push({ name: 'cart' }),
        testID: 'CustomerTabBar-action-cart',
      }}
      testID="CustomerTabBar"
    />
  );
}
