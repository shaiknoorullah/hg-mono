/**
 * What a signed-in rider sees: the current screen, the BottomNav (Home, Earnings, Account) when
 * no flow covers the tabs, the tab accessories above it, and the layers (offer sheet, What's
 * new) above everything.
 *
 * The BottomNav is unmounted, not dimmed, while a flow is open: the trip and the application
 * take over the screen and offer no way out mid-step (rider canvases, "BottomNav hidden").
 */
import * as React from 'react';
import { View } from 'react-native';

import { BottomNav, Icon, useTheme, type BottomNavItem } from '../ds';
import { LegacyFallback } from './LegacyFallback';
import { useNav } from './Navigator';
import { allLayers, allTabAccessories, screenFor } from './registry';
import type { Entry, Tab } from './routes';

export function ScreenView({ entry }: { entry: Entry }): React.ReactElement {
  const spec = screenFor(entry.name);
  if (!spec) return <LegacyFallback entry={entry} />;
  const Component = spec.component;
  return <Component params={entry.params as never} />;
}

const ITEMS: readonly BottomNavItem[] = [
  { key: 'home', label: 'Home', icon: <Icon name="home" weight="linear" />, activeIcon: <Icon name="home" weight="bold" />, testID: 'tab-home' },
  {
    key: 'earnings',
    label: 'Earnings',
    // "wallet" is not in the icon set yet (#198); the boards use "orders" as the stand-in.
    icon: <Icon name="orders" weight="linear" />,
    activeIcon: <Icon name="orders" weight="bold" />,
    testID: 'tab-earnings',
  },
  { key: 'account', label: 'Account', icon: <Icon name="profile" weight="linear" />, activeIcon: <Icon name="profile" weight="bold" />, testID: 'tab-account' },
];

export function Shell(): React.ReactElement {
  const theme = useTheme();
  const nav = useNav();
  const inFlow = nav.flow !== null;
  return (
    <View style={{ flex: 1, backgroundColor: theme.color.surface.base }}>
      <View style={{ flex: 1 }}>
        <ScreenView key={nav.current.key} entry={nav.current} />
      </View>
      {inFlow ? null : (
        <>
          {allTabAccessories().map(({ key, component: Accessory }) => (
            <Accessory key={key} />
          ))}
          <BottomNav items={ITEMS} active={nav.tab} onChange={(key) => nav.switchTab(key as Tab)} />
        </>
      )}
      <Layers />
    </View>
  );
}

export function Layers(): React.ReactElement {
  return (
    <>
      {allLayers().map(({ key, component: Layer }) => (
        <Layer key={key} />
      ))}
    </>
  );
}
