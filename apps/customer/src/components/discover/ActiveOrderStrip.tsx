/**
 * Home's "order in progress" strip, from the Discover & Order canvas's Home-order-in-progress
 * board: the order code and restaurant, "Arriving about 7:47 pm" from the order's `eta_at` (one
 * time, not a window), the state as a badge, and a chevron. The whole card opens tracking.
 *
 * The badge words are the Orders canvas's ("Being prepared", "Ready", "On the way"), so Home and
 * Orders name a state the same way. No ETA, no arrival line: the strip never guesses one.
 */
import * as React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Badge, Card, Icon, useTheme, useTypeStyle } from '@hg/ui-native';

import type { OrderCustomerView } from '../../api/orders';
import { clockTime } from './format';

/** The badge word, and how the spoken label says it ("Your order … is being prepared"). */
const ACTIVE_STATE: Record<string, { word: string; spoken: string }> = {
  CREATED: { word: 'Placing', spoken: 'is being placed' },
  AUTHORIZED: { word: 'Sending', spoken: 'is being sent to the restaurant' },
  RESTAURANT_PENDING: { word: 'Waiting to accept', spoken: 'is waiting for the restaurant' },
  PREPARING: { word: 'Being prepared', spoken: 'is being prepared' },
  READY_FOR_PICKUP: { word: 'Ready', spoken: 'is ready' },
  PICKED_UP: { word: 'On the way', spoken: 'is on the way' },
  ARRIVED: { word: 'At your door', spoken: 'has arrived' },
  DELIVERED: { word: 'Delivered', spoken: 'has been delivered' },
};
const IN_PROGRESS = { word: 'In progress', spoken: 'is in progress' };

export function ActiveOrderStrip({
  order,
  onPress,
}: {
  order: OrderCustomerView;
  onPress: () => void;
}): React.ReactElement {
  const theme = useTheme();
  const label = useTypeStyle('label.md');
  const heading = useTypeStyle('heading.md');
  const state = ACTIVE_STATE[order.state] ?? IN_PROGRESS;
  const restaurant = order.restaurant?.name ?? null;
  const eta = order.eta_at ? clockTime(order.eta_at) : null;
  const arriving = eta ? `Arriving about ${eta}` : null;

  const spoken = [
    `Your order ${order.code}${restaurant ? ` from ${restaurant}` : ''} ${state.spoken}.`,
    arriving ? `${arriving}.` : null,
    'View order.',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <Card
      variant="elevated"
      onPress={onPress}
      accessibilityLabel={spoken}
      contentStyle={styles.row}
      testID="Discovery-activeOrder"
    >
      <View style={styles.body}>
        <Text style={[label, { color: theme.color.text.secondary }]}>
          {`Order ${order.code}${restaurant ? ` · ${restaurant}` : ''}`}
        </Text>
        {arriving ? (
          <Text style={[heading, styles.tabular, { color: theme.color.text.primary }]}>{arriving}</Text>
        ) : null}
        <View style={styles.badge}>
          <Badge label={state.word} variant="info" size="md" />
        </View>
      </View>
      <Icon name="chevron-right" size={24} color={theme.color.text.secondary} />
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  body: { flex: 1, minWidth: 0, gap: 4 },
  badge: { flexDirection: 'row' },
  tabular: { fontVariant: ['tabular-nums'] },
});
