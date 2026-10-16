/**
 * The "View cart" bar above the bottom navigation, on Home, Browse and Search: shown only while the
 * cart has items. It states the server's indicative subtotal (`getCart`), never one worked out here.
 * A cart that cannot be read draws no bar; the cart itself is one tap away in the tabs.
 */
import * as React from 'react';
import { StyleSheet, View } from 'react-native';
import { cents, unwrap, type Schema } from '@hg/api-client';

import { Button, Price, spokenPrice, useTheme } from '../ds';
import { api } from '../api/client';
import { useQuery } from '../lib/query';
import { useNav } from '../navigation/context';

type Cart = Schema['Cart'];

function itemsText(n: number): string {
  return n === 1 ? '1 item' : `${n} items`;
}

export function CartBar({ testID }: { testID: string }): React.ReactElement | null {
  const theme = useTheme();
  const nav = useNav();
  const cart = useQuery(() => unwrap(api.GET('/v1/cart')).then((b) => b.data as Cart), []);
  const data = cart.query.kind === 'ready' ? cart.query.data : null;
  const count = data?.item_count ?? 0;
  if (!data || count <= 0) return null;
  return (
    <View
      style={[
        styles.bar,
        { paddingHorizontal: theme.density.gutter, backgroundColor: theme.color.surface.base, borderTopColor: theme.color.border.decorative },
      ]}
    >
      <Button
        variant="primary"
        size="lg"
        fullWidth
        onPress={() => nav.push({ name: 'cart' })}
        accessibilityLabel={`View cart, ${itemsText(count)}, ${spokenPrice(cents(data.indicative_subtotal_cents))}`}
        iconEnd={<Price cents={cents(data.indicative_subtotal_cents)} size="md" color={theme.color.text.onBrand} />}
        testID={testID}
      >
        {`View cart · ${itemsText(count)} ·`}
      </Button>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth },
});
