/**
 * The top-level tabs: Home · Orders · Account, the settled set (Home · Search · Orders · Account,
 * owner decision 2026-09-28) less Search, which has no screen yet — the decision rules out a dead
 * tab. The Alerts tab stays hidden until Alerts ships; its route remains for deep links.
 *
 * Each tab screen is a peer top-level route (not nested inside a tab navigator this app's
 * minimal stack doesn't have), so switching tabs is `nav.reset({ name })` — it clears whatever
 * push-stack the previous tab had grown, which is the right behaviour for a tab bar: pressing
 * "Orders" from three screens deep in Discover should land on Orders' root, not resume a stale
 * push stack. `BottomNav` itself is `@hg/ui-native`'s full-width raised bar — same component as
 * the rider app, themed by the `customer` register.
 *
 * Icons come from the `Icon` primitive (Solar set): **linear = inactive, bold = active**, per
 * the shared convention documented on `BottomNav` itself.
 *
 * The cart is not a tab and not a floating button. As the approved Home canvas draws it, it is a
 * full-width primary bar above the nav — "View cart · 3 items · $51.47" — bound to the server's
 * `item_count` and `indicative_subtotal_cents`, and shown only while `item_count` is above 0. The
 * stack renders only its top screen, so the bar refetches whenever a tab screen comes back into
 * view; a failed fetch (signed out, offline) hides the bar rather than showing a guess.
 */
import * as React from 'react';
import { StyleSheet, View } from 'react-native';
import { BottomNav, Button, Icon, elevationStyle, formatPrice, useTheme } from '@hg/ui-native';
import type { BottomNavItem } from '@hg/ui-native';

import { getCart, type Cart } from '../api/cart';
import { useNavigation, type Route, type RouteName } from './stack';

type TabKey = 'discovery' | 'orders' | 'profile';

const TABS: readonly BottomNavItem[] = [
  {
    key: 'discovery',
    label: 'Home',
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
    key: 'profile',
    label: 'Account',
    icon: <Icon name="profile" weight="linear" />,
    activeIcon: <Icon name="profile" weight="bold" />,
  },
];

/** "View cart · 3 items · $51.47", or null when the cart is empty or unknown. */
export function cartBarLabel(cart: Cart | null): string | null {
  if (!cart) return null;
  const count = cart.item_count ?? cart.lines.reduce((n, l) => n + l.quantity, 0);
  if (count <= 0) return null;
  return `View cart · ${count} ${count === 1 ? 'item' : 'items'} · ${formatPrice(
    cart.indicative_subtotal_cents,
  )}`;
}

function CartBar({ onPress }: { onPress: () => void }): React.ReactElement | null {
  const theme = useTheme();
  const [cart, setCart] = React.useState<Cart | null>(null);
  React.useEffect(() => {
    let cancelled = false;
    getCart()
      .then((c) => {
        // A body without cart lines is not a cart; hide the bar rather than guess.
        if (!cancelled) setCart(Array.isArray(c?.lines) ? c : null);
      })
      .catch(() => {
        if (!cancelled) setCart(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  const label = cartBarLabel(cart);
  if (!label) return null;
  return (
    <View
      testID="CustomerTabBar-cart"
      style={[
        elevationStyle(theme, 'sticky'),
        styles.cartBar,
        { backgroundColor: theme.color.surface.raised },
      ]}
    >
      <Button
        variant="primary"
        size="lg"
        fullWidth
        iconStart={<Icon name="cart" weight="bold" color={theme.color.text.onBrand} />}
        onPress={onPress}
        testID="CustomerTabBar-action-cart"
      >
        {label}
      </Button>
    </View>
  );
}

export function CustomerTabBar({ active }: { active: RouteName }): React.ReactElement {
  const nav = useNavigation();
  return (
    <View>
      <CartBar onPress={() => nav.push({ name: 'cart' })} />
      <BottomNav
        items={TABS}
        active={active}
        onChange={(key) => {
          if (key === active) return;
          nav.reset({ name: key as TabKey } as Route);
        }}
        testID="CustomerTabBar"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  cartBar: { paddingHorizontal: 16, paddingVertical: 12 },
});
