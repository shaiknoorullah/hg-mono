/**
 * The four top-level tabs, shared across Discover / Orders / Notifications / Profile.
 *
 * Each tab screen is a peer top-level route (not nested inside a tab navigator this app's
 * minimal stack doesn't have), so switching tabs is `nav.reset({ name })` — it clears whatever
 * push-stack the previous tab had grown, which is the right behaviour for a tab bar: pressing
 * "Orders" from three screens deep in Discover should land on Orders' root, not resume a stale
 * push stack. `BottomNav` itself is `@hg/ui-native`'s glass pill — same component as the rider
 * app, themed by the `customer` register.
 */
import * as React from 'react';
import { Text } from 'react-native';
import { BottomNav } from '@hg/ui-native';
import type { BottomNavItem } from '@hg/ui-native';

import { useNavigation, type Route, type RouteName } from './stack';

type TabKey = 'discovery' | 'orders' | 'notifications' | 'profile';

function Glyph({ children }: { children: string }): React.ReactElement {
  return <Text style={{ fontSize: 18, lineHeight: 22 }}>{children}</Text>;
}

const TABS: readonly BottomNavItem[] = [
  { key: 'discovery', label: 'Discover', icon: <Glyph>⌂</Glyph> },
  { key: 'orders', label: 'Orders', icon: <Glyph>▤</Glyph> },
  { key: 'notifications', label: 'Alerts', icon: <Glyph>◎</Glyph> },
  { key: 'profile', label: 'Profile', icon: <Glyph>☺</Glyph> },
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
      testID="CustomerTabBar"
    />
  );
}
