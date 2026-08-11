/**
 * `OrderCard` — one order, on four audiences' surfaces: customer history (C-26), restaurant
 * queue (R-23), rider dashboard (D-18) and admin lookup.
 *
 * One component, four **deliberately different** payloads. The projections are separate
 * types per audience rather than one struct with conditional blanking (P-07), and this
 * component honours that by taking a discriminated union: there is no way to pass a rider a
 * customer's order and have it compile.
 *
 * The rider variant carries **no prices, no order total, ever** (D-19): a rider has no
 * reason to know the basket value and knowing it invites disputes. That is enforced by the
 * type, not by a runtime check.
 *
 * Two things this component deliberately does **not** do:
 *
 *  - It does not derive `urgent` or `late` from the wall clock. Deadline arithmetic belongs
 *    to `Countdown`, which measures server clock skew; a card that re-derives it would let a
 *    device that is ten minutes fast decide an order is overdue.
 *  - It does not own the timeline or the countdown. Both arrive as slots so the customer app
 *    and the restaurant app cannot end up disagreeing about what an order state is called.
 */
import * as React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { type Cents, cents } from '@hg/api-client';
import type { Schema } from '@hg/api-client';

import { HalalBadge } from '../certification';
import {
  radius,
  space,
  typeStyle,
  useTheme,
} from '../certification/internal/theme';
import { Skeleton } from '../primitives';
import { Card } from './Card';
import { Price } from './Price';

export type OrderCardVariant = 'customer' | 'restaurant' | 'rider' | 'admin';

interface OrderCardCommon {
  onPress?: () => void;
  /** Explicit action buttons. The card is not pressable when it carries two of them. */
  actions?: React.ReactNode;
  /**
   * `urgent` — deadline under 25% remaining. Supplied by whatever owns the `Countdown`, so
   * skew correction happens once, in one place.
   */
  urgent?: boolean;
  /** `promised_ready_at` has passed while still `PREPARING` (R-23 R6). */
  late?: boolean;
  /** Socket silent for more than 45 s. A stale queue must announce itself. */
  stale?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export type OrderCardProps = OrderCardCommon &
  (
    | {
        variant?: 'customer';
        order: Schema['OrderSummary'];
        /** `StatusTimeline variant="horizontal"`, injected by the app. */
        timeline?: React.ReactNode;
      }
    | {
        variant: 'restaurant';
        order: Schema['OrderRestaurantView'];
        /** `Countdown` for the 180 s accept/reject window while `RESTAURANT_PENDING`. */
        countdown?: React.ReactNode;
      }
    | {
        variant: 'rider';
        order: Schema['Assignment'];
      }
    | {
        variant: 'admin';
        order: Schema['OrderAdminView'];
        timeline?: React.ReactNode;
      }
  );

export function OrderCard(props: OrderCardProps): React.ReactElement {
  const {
    onPress,
    actions,
    urgent = false,
    late = false,
    stale = false,
    loading = false,
    style,
    testID = 'OrderCard',
  } = props;
  const theme = useTheme();

  if (loading) return <OrderCardSkeleton style={style} testID={testID} />;

  return (
    <Card
      testID={testID}
      variant="outlined"
      onPress={onPress}
      accessibilityLabel={accessibleName(props)}
      style={[
        // Never colour-only: both states also add a text badge below.
        urgent ? { borderWidth: 2, borderColor: theme.color.text.primary } : null,
        stale ? { opacity: 0.9 } : null,
        style,
      ]}
    >
      <View style={{ rowGap: space['2'] }}>
        {(urgent || late) ? (
          <View style={[styles.badgeRow, { columnGap: space['2'] }]}>
            {urgent ? <StateBadge testID={`${testID}-urgent`} label="Urgent" /> : null}
            {late ? <StateBadge testID={`${testID}-late`} label="Late" /> : null}
          </View>
        ) : null}

        {props.variant === 'restaurant' ? (
          <RestaurantBody order={props.order} countdown={props.countdown} testID={testID} />
        ) : props.variant === 'rider' ? (
          <RiderBody order={props.order} testID={testID} />
        ) : (
          <CustomerBody
            order={props.order}
            timeline={props.timeline}
            admin={props.variant === 'admin'}
            testID={testID}
          />
        )}

        {actions ? <View style={styles.actions}>{actions}</View> : null}
      </View>
    </Card>
  );
}

/* ------------------------------------------------------------------- bodies */

function CustomerBody({
  order,
  timeline,
  admin,
  testID,
}: {
  order: Schema['OrderSummary'] | Schema['OrderAdminView'];
  timeline?: React.ReactNode;
  admin: boolean;
  testID: string;
}): React.ReactElement {
  const theme = useTheme();
  const summary = 'total_cents' in order ? order : null;
  const restaurant = order.restaurant;
  const total: Cents = summary
    ? cents(summary.total_cents)
    : cents((order as Schema['OrderAdminView']).money.total_cents);
  const items = summary?.first_item_names ?? [];
  const itemCount = summary?.item_count ?? (order as Schema['OrderAdminView']).lines?.length ?? 0;

  return (
    <View style={{ rowGap: space['2'] }}>
      {/* The seal travels with the restaurant onto every one of the six card surfaces. */}
      <HalalBadge
        testID={`${testID}-halal`}
        state={restaurant.halal?.display_state}
        restaurantId={restaurant.id}
        size="sm"
        surface="card"
      />
      <Text
        testID={`${testID}-restaurant`}
        numberOfLines={1}
        style={[typeStyle(theme, 'heading.sm'), { color: theme.color.text.primary }]}
      >
        {restaurant.name}
      </Text>
      {items.length > 0 ? (
        <Text numberOfLines={1} style={[typeStyle(theme, 'body.sm'), { color: theme.color.text.tertiary }]}>
          {summariseItems(items, itemCount)}
        </Text>
      ) : null}
      <Price cents={total} size="md" testID={`${testID}-total`} />
      {timeline}
      {admin ? (
        <Text style={[typeStyle(theme, 'mono.sm'), { color: theme.color.text.tertiary }]}>{order.id}</Text>
      ) : null}
    </View>
  );
}

function RestaurantBody({
  order,
  countdown,
  testID,
}: {
  order: Schema['OrderRestaurantView'];
  countdown?: React.ReactNode;
  testID: string;
}): React.ReactElement {
  const theme = useTheme();
  return (
    <View style={{ rowGap: space['2'] }}>
      <View style={[styles.badgeRow, { columnGap: space['2'] }]}>
        <Text style={[typeStyle(theme, 'heading.sm'), { color: theme.color.text.primary }]}>{order.code}</Text>
        {order.state === 'RESTAURANT_PENDING' ? countdown : null}
      </View>

      {/* PII minimised by the projection itself: first name + last initial, masked phone. */}
      <Text style={[typeStyle(theme, 'body.md'), { color: theme.color.text.primary }]}>
        {order.customer.display_name}
      </Text>
      <Text style={[typeStyle(theme, 'body.sm'), { color: theme.color.text.secondary }]}>
        {order.customer.phone_masked}
      </Text>

      {/*
        Verbatim and prominent — special instructions are the highest-frequency source of
        order errors, so they are never truncated and never restyled into a footnote.
      */}
      {order.special_instructions ? (
        <View
          testID={`${testID}-instructions`}
          style={[
            styles.instructions,
            {
              backgroundColor: theme.color.state.selectedTint,
              borderRadius: radius.sm,
              padding: space['3'],
            },
          ]}
        >
          <Text style={[typeStyle(theme, 'body.md'), { color: theme.color.text.primary }]}>
            {order.special_instructions}
          </Text>
        </View>
      ) : null}

      <View style={{ rowGap: space['1'] }}>
        {order.lines.map((line) => (
          <Text
            key={line.line_no}
            style={[typeStyle(theme, 'body.sm'), { color: theme.color.text.secondary }]}
          >
            {`${line.quantity} × ${line.name}${line.variant_name ? ` (${line.variant_name})` : ''}`}
          </Text>
        ))}
      </View>

      {/* The restaurant sees its own payout, never the customer's total decomposition. */}
      <Price cents={cents(order.money.restaurant_net_cents)} size="md" testID={`${testID}-payout`} />

      {/* R-23 R1: the delivery address appears only after acceptance. */}
      {order.delivery_address ? (
        <Text style={[typeStyle(theme, 'body.sm'), { color: theme.color.text.secondary }]}>
          {order.delivery_address.line1}
        </Text>
      ) : order.delivery_area ? (
        <Text style={[typeStyle(theme, 'body.sm'), { color: theme.color.text.tertiary }]}>{order.delivery_area}</Text>
      ) : null}
    </View>
  );
}

/**
 * The rider body. Note what is absent and cannot be added without changing the contract:
 * no line prices, no order total, no basket value.
 */
function RiderBody({
  order,
  testID,
}: {
  order: Schema['Assignment'];
  testID: string;
}): React.ReactElement {
  const theme = useTheme();
  const earnings = order.earnings;
  return (
    <View style={{ rowGap: space['2'] }}>
      <Text style={[typeStyle(theme, 'heading.sm'), { color: theme.color.text.primary }]}>
        {order.pickup.restaurant_name}
      </Text>
      <Text style={[typeStyle(theme, 'body.md'), { color: theme.color.text.secondary }]}>{order.pickup.address}</Text>
      <Text style={[typeStyle(theme, 'body.md'), { color: theme.color.text.secondary }]}>{order.dropoff.address}</Text>
      <Text style={[typeStyle(theme, 'body.sm'), { color: theme.color.text.tertiary }]}>
        {`${order.items.length} ${order.items.length === 1 ? 'item' : 'items'}`}
      </Text>
      {earnings ? (
        <View testID={`${testID}-earnings`} style={{ rowGap: space['1'] }}>
          <Price cents={cents(earnings.estimated_total_cents)} size="lg" />
          <View style={[styles.badgeRow, { columnGap: space['3'] }]}>
            {earnings.base_cents !== undefined ? (
              <EarningsPart label="Base" value={cents(earnings.base_cents)} />
            ) : null}
            {earnings.distance_cents !== undefined ? (
              <EarningsPart label="Distance" value={cents(earnings.distance_cents)} />
            ) : null}
            {earnings.surge_cents !== undefined ? (
              <EarningsPart label="Surge" value={cents(earnings.surge_cents)} />
            ) : null}
            {earnings.tip_so_far_cents !== undefined ? (
              <EarningsPart label="Tip so far" value={cents(earnings.tip_so_far_cents)} />
            ) : null}
          </View>
        </View>
      ) : null}
      {order.dropoff.delivery_instructions?.length ? (
        <Text style={[typeStyle(theme, 'body.sm'), { color: theme.color.text.secondary }]}>
          {order.dropoff.delivery_instructions.map(instructionCopy).join(' · ')}
        </Text>
      ) : null}
    </View>
  );
}

function EarningsPart({ label, value }: { label: string; value: Cents }): React.ReactElement {
  const theme = useTheme();
  return (
    <View style={{ rowGap: 2 }}>
      <Text style={[typeStyle(theme, 'caption'), { color: theme.color.text.tertiary }]}>{label}</Text>
      <Price cents={value} size="sm" />
    </View>
  );
}

function StateBadge({ label, testID }: { label: string; testID: string }): React.ReactElement {
  const theme = useTheme();
  return (
    <View
      testID={testID}
      style={{
        paddingHorizontal: space['2'],
        paddingVertical: 2,
        borderRadius: radius.xs,
        borderWidth: 1,
        borderColor: theme.color.border.strong,
      }}
    >
      <Text style={[typeStyle(theme, 'label.sm'), { color: theme.color.text.primary }]}>{label}</Text>
    </View>
  );
}

/* ------------------------------------------------------------------ helpers */

const INSTRUCTION_COPY: Readonly<Record<string, string>> = {
  LEAVE_AT_DOOR: 'Leave at door',
  DO_NOT_RING_BELL: 'Do not ring bell',
  DO_NOT_CALL: 'Do not call',
  MEET_AT_DOOR: 'Meet at door',
  MEET_IN_LOBBY: 'Meet in lobby',
};

function instructionCopy(key: string): string {
  return INSTRUCTION_COPY[key] ?? key.toLowerCase().replace(/_/g, ' ');
}

function summariseItems(names: readonly string[], count: number): string {
  const shown = names.slice(0, 2).join(', ');
  const extra = count - Math.min(names.length, 2);
  return extra > 0 ? `${shown} +${extra} more` : shown;
}

function accessibleName(props: OrderCardProps): string {
  switch (props.variant) {
    case 'restaurant':
      return `Order ${props.order.code}. ${props.order.customer.display_name}. ${props.order.lines.length} lines.`;
    case 'rider':
      return `Pickup ${props.order.pickup.restaurant_name}. Dropoff ${props.order.dropoff.address}. ${props.order.items.length} items.`;
    default:
      return `Order from ${props.order.restaurant.name}.`;
  }
}

export function OrderCardSkeleton({
  style,
  testID = 'OrderCard',
}: {
  style?: StyleProp<ViewStyle>;
  testID?: string;
}): React.ReactElement {
  const theme = useTheme();
  return (
    <View
      testID={`${testID}-skeleton`}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      aria-busy
      style={[
        {
          padding: theme.density.cardPadding,
          rowGap: space['2'],
          borderRadius: radius.lg,
          backgroundColor: theme.color.surface.base,
          borderWidth: 1,
          borderColor: theme.color.border.decorative,
        },
        style,
      ]}
    >
      {/* Seal slot first, reserved at `sm` geometry, for the same reason as the card. */}
      <Skeleton variant="rect" width={108} height={20} testID={`${testID}-skeleton-seal`} />
      <Skeleton variant="text" lines={2} />
      <Skeleton variant="rect" width={72} height={18} />
    </View>
  );
}

const styles = StyleSheet.create({
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: 12,
    rowGap: 8,
  },
  instructions: {
    width: '100%',
  },
});
