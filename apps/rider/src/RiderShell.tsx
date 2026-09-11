/**
 * The authed rider shell: the screen stack (`Router`) plus the glass `BottomNav`.
 *
 * Three fixed tabs (Shift / Deliveries / Profile) match the rider set `BottomNav`'s own doc
 * comment describes ("three for the rider — the rider's real navigation is the assignment
 * flow, which takes over the screen"). The detached action button is the rider's primary
 * affordance: a fast route to the availability toggle, soft-tint ORANGE per `color.action.primary`
 * — never green, RULE H-1 reserves solid green for `color.halal.*` alone and a CTA is not a
 * certification.
 *
 * The bar unmounts entirely (not dims) during the offer sheet, the live assignment and
 * onboarding — flows that take over the screen and must not offer an escape hatch.
 */
import * as React from 'react';
import { View } from 'react-native';
import { BottomNav, Icon, useTheme } from '@hg/ui-native';
import type { BottomNavItem } from '@hg/ui-native';

import { useNav, type ScreenName } from './nav';
import { Router } from './Router';

const HIDDEN_ON: readonly ScreenName[] = ['offer', 'assignment', 'onboarding'];

const TAB_FOR: Partial<Record<ScreenName, string>> = {
  home: 'home',
  deliveries: 'deliveries',
  earnings: 'profile',
  payoutDetail: 'profile',
  profile: 'profile',
};

export function RiderShell(): React.ReactElement {
  const theme = useTheme();
  const nav = useNav();

  const activeTab = TAB_FOR[nav.current.name] ?? '';
  const hidden = HIDDEN_ON.includes(nav.current.name);
  const onAvailability = nav.current.name === 'availability';

  const items: BottomNavItem[] = [
    {
      key: 'home',
      label: 'Shift',
      icon: <Icon name="home" weight="linear" />,
      activeIcon: <Icon name="home" weight="bold" />,
    },
    {
      key: 'deliveries',
      label: 'Deliveries',
      icon: <Icon name="orders" weight="linear" />,
      activeIcon: <Icon name="orders" weight="bold" />,
    },
    {
      key: 'profile',
      label: 'Profile',
      icon: <Icon name="profile" weight="linear" />,
      activeIcon: <Icon name="profile" weight="bold" />,
    },
  ];

  function handleChange(key: string): void {
    switch (key) {
      case 'home':
        nav.resetHome();
        return;
      case 'deliveries':
        nav.push('deliveries', undefined);
        return;
      case 'profile':
        nav.push('profile', undefined);
        return;
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.color.surface.sunken }}>
      <View style={{ flex: 1 }}>
        <Router />
      </View>
      <BottomNav
        items={items}
        active={activeTab}
        onChange={handleChange}
        hidden={hidden}
        action={{
          label: onAvailability ? 'Availability — open' : 'Go online or offline',
          icon: (
            <Icon
              name="check"
              weight={onAvailability ? 'bold' : 'linear'}
              color={theme.color.action.primary}
            />
          ),
          active: onAvailability,
          onPress: () => nav.push('availability', undefined),
        }}
      />
    </View>
  );
}
