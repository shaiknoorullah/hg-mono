/**
 * The two restaurant cards the approved Home and Browse canvases draw (Discover & Order):
 *
 *  - `RestaurantCardCompact` — the list card: a 72 dp thumbnail, then name, cuisines, the halal
 *    badge with the certifying body, and one availability line. Same card on Home and Browse.
 *  - `RestaurantRailCard` — the 240 dp card in a horizontal row ("Open now, closest first").
 *
 * Halal rules, kept here because these cards are where they are easiest to break:
 *  - The badge is `HalalBadge` and nothing else. A card whose `halal` is missing renders no
 *    badge and no certifier line (invariant 8); there is no fallback copy.
 *  - Expiring soon adds a neutral "expires 20 Oct" badge beside the seal — never red, never a
 *    second green (invariants 9 and 10).
 */
import * as React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { cents } from '@hg/api-client';
import {
  Badge,
  Card,
  HalalBadge,
  Icon,
  Price,
  Skeleton,
  spokenPrice,
  useTheme,
  useTypeStyle,
} from '@hg/ui-native';
import type { Restaurant } from '@hg/ui-native';

import { MediaFrame } from '../MediaFrame';
import { cuisineLine, etaDistance, shortDate, unavailableLabel } from './format';

/* --------------------------------------------------------------- shared rows */

function HalalRow({
  restaurant,
  showBody,
  testID,
}: {
  restaurant: Restaurant;
  showBody: boolean;
  testID: string;
}): React.ReactElement | null {
  const theme = useTheme();
  const body = useTypeStyle('body.sm');
  const halal = restaurant.halal;
  // Silence is never consent: no halal object, no badge and no certifier line. HalalBadge
  // still mounts with no state so it reports HALAL_DISPLAY_STATE_MISSING; it renders nothing.
  if (!halal?.display_state) {
    return <HalalBadge state={undefined} restaurantId={restaurant.id} size="sm" surface="card" />;
  }
  // A partial record (owner decision, Halal edge states 1b): no badge, a neutral line instead.
  if (!hasCompleteHalal(restaurant)) {
    return (
      <View testID={`${testID}-halalPartial`} style={styles.inline}>
        <Icon name="info" size={16} color={theme.color.text.secondary} />
        <Text style={[body, { color: theme.color.text.secondary }]}>
          Certificate details unavailable
        </Text>
      </View>
    );
  }
  const expires = halal.display_state === 'EXPIRING_SOON' ? shortDate(halal.expires_on) : null;
  return (
    <View style={styles.wrapRow}>
      <HalalBadge
        state={halal.display_state}
        restaurantId={restaurant.id}
        size="sm"
        surface="card"
        testID={`${testID}-halal`}
      />
      {expires ? (
        <Badge
          variant="neutral"
          size="sm"
          label={`expires ${expires}`}
          icon={<Icon name="clock" size={12} color={theme.color.text.secondary} />}
          testID={`${testID}-expires`}
        />
      ) : null}
      {showBody && halal.certifying_body_name ? (
        <Text numberOfLines={2} style={[body, styles.shrink, { color: theme.color.text.secondary }]}>
          {halal.certifying_body_name}
        </Text>
      ) : null}
    </View>
  );
}

function AvailabilityRow({
  restaurant,
  showMinimum,
  testID,
}: {
  restaurant: Restaurant;
  showMinimum: boolean;
  testID: string;
}): React.ReactElement | null {
  const theme = useTheme();
  const body = useTypeStyle('body.sm');
  const a = restaurant.availability;
  const secondary = [body, { color: theme.color.text.secondary }];

  if (a.state === 'NO_ADDRESS') {
    return (
      <Text testID={`${testID}-noAddress`} style={secondary}>
        Add an address for delivery time and fee
      </Text>
    );
  }
  const blocked = unavailableLabel(a);
  if (blocked) {
    return (
      <View style={styles.wrapRow}>
        <Badge
          variant="neutral"
          size="md"
          label={blocked}
          icon={<Icon name="clock" size={14} color={theme.color.text.secondary} />}
          testID={`${testID}-availability`}
        />
      </View>
    );
  }
  const eta = etaDistance(a);
  return (
    <View testID={`${testID}-meta`} style={styles.wrapRow}>
      {eta ? <Text style={[secondary, styles.tabular]}>{eta}</Text> : null}
      {a.indicative_delivery_fee_cents != null ? (
        <View style={styles.inline}>
          <Price cents={cents(a.indicative_delivery_fee_cents)} size="sm" color={theme.color.text.secondary} />
          <Text style={secondary}>delivery</Text>
        </View>
      ) : null}
      {showMinimum && a.minimum_order_cents != null ? (
        <View style={styles.inline}>
          <Text style={secondary}>Min.</Text>
          <Price cents={cents(a.minimum_order_cents)} size="sm" color={theme.color.text.secondary} />
        </View>
      ) : null}
    </View>
  );
}

/**
 * The badge and certifier line render only from a complete record: a state the customer may
 * see, the certifying body and the expiry date. Anything less is "Certificate details
 * unavailable" — never a badge drawn from half the facts.
 */
export function hasCompleteHalal(r: Pick<Restaurant, 'halal'>): boolean {
  const h = r.halal;
  return Boolean(
    h &&
      (h.display_state === 'CERTIFIED' || h.display_state === 'EXPIRING_SOON') &&
      h.certifying_body_name &&
      h.expires_on,
  );
}

/** One accessible name per card, halal state second (04-accessibility.md §3.4). */
export function restaurantCardLabel(r: Restaurant): string {
  const a = r.availability;
  const halal = hasCompleteHalal(r)
    ? `Halal certified by ${r.halal.certifying_body_name}${
        r.halal.display_state === 'EXPIRING_SOON'
          ? `, certificate expires ${shortDate(r.halal.expires_on)}`
          : ''
      }.`
    : r.halal?.display_state
      ? 'Certificate details unavailable.'
      : null;
  const eta = etaDistance(a);
  const state =
    a.state === 'NO_ADDRESS'
      ? 'Add an address to see delivery time and fee.'
      : (unavailableLabel(a) ?? null);
  return [
    `${r.name}.`,
    halal,
    cuisineLine(r) ? `${cuisineLine(r)}.` : null,
    state ? `${state}.`.replace('..', '.') : null,
    !state && eta ? `${eta.replace('–', ' to ').replace(' km', ' kilometres')}.` : null,
    !state && a.indicative_delivery_fee_cents != null
      ? `Delivery about ${spokenPrice(cents(a.indicative_delivery_fee_cents))}, estimate.`
      : null,
  ]
    .filter(Boolean)
    .join(' ');
}

/* ------------------------------------------------------------ compact (list) */

export function RestaurantCardCompact({
  restaurant,
  onPress,
  style,
  testID = 'RestaurantCardCompact',
}: {
  restaurant: Restaurant;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}): React.ReactElement {
  const theme = useTheme();
  const name = useTypeStyle('heading.sm');
  const body = useTypeStyle('body.sm');
  const cuisine = cuisineLine(restaurant);
  return (
    <Card
      variant="interactive"
      onPress={onPress}
      accessibilityLabel={restaurantCardLabel(restaurant)}
      style={style}
      testID={testID}
    >
      <View style={styles.compactRow}>
        <MediaFrame uri={restaurant.hero_image_url} width={72} height={72} radius={12} />
        <View style={styles.compactBody}>
          <Text numberOfLines={2} style={[name, { color: theme.color.text.primary }]}>
            {restaurant.name}
          </Text>
          {cuisine ? (
            <Text numberOfLines={1} style={[body, { color: theme.color.text.secondary }]}>
              {cuisine}
            </Text>
          ) : null}
          <HalalRow restaurant={restaurant} showBody testID={testID} />
          <AvailabilityRow restaurant={restaurant} showMinimum testID={testID} />
        </View>
      </View>
    </Card>
  );
}

export function RestaurantCardCompactSkeleton(): React.ReactElement {
  const theme = useTheme();
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.skeletonCard, { backgroundColor: theme.color.surface.raised }]}
    >
      <Skeleton variant="rect" width={72} height={72} />
      <View style={styles.compactBody}>
        <Skeleton variant="rect" width="60%" height={18} />
        <Skeleton variant="rect" width="40%" height={14} />
        {/* The seal's slot is reserved at its real size, so nothing reflows when it lands. */}
        <Skeleton variant="rect" width={112} height={20} />
        <Skeleton variant="rect" width="70%" height={14} />
      </View>
    </View>
  );
}

/* --------------------------------------------------------------- rail (row) */

export const RAIL_CARD_WIDTH = 240;

export function RestaurantRailCard({
  restaurant,
  onPress,
  testID = 'RestaurantRailCard',
}: {
  restaurant: Restaurant;
  onPress: () => void;
  testID?: string;
}): React.ReactElement {
  const theme = useTheme();
  const name = useTypeStyle('heading.sm');
  const body = useTypeStyle('body.sm');
  const cuisine = cuisineLine(restaurant);
  const a = restaurant.availability;
  const eta = etaDistance(a);
  return (
    <Card
      variant="interactive"
      padding={12}
      onPress={onPress}
      accessibilityLabel={restaurantCardLabel(restaurant)}
      media={<MediaFrame uri={restaurant.hero_image_url} height={104} caption />}
      style={{ width: RAIL_CARD_WIDTH }}
      contentStyle={styles.railBody}
      testID={testID}
    >
      <Text numberOfLines={1} style={[name, { color: theme.color.text.primary }]}>
        {restaurant.name}
      </Text>
      {cuisine ? (
        <Text numberOfLines={1} style={[body, { color: theme.color.text.secondary }]}>
          {cuisine}
        </Text>
      ) : null}
      <HalalRow restaurant={restaurant} showBody={false} testID={testID} />
      {eta ? (
        <View style={styles.inline}>
          <Icon name="clock" size={16} color={theme.color.text.secondary} />
          <Text style={[body, styles.tabular, { color: theme.color.text.secondary }]}>{eta}</Text>
        </View>
      ) : null}
      {a.indicative_delivery_fee_cents != null ? (
        <View style={styles.inline}>
          <Price cents={cents(a.indicative_delivery_fee_cents)} size="sm" color={theme.color.text.secondary} />
          <Text style={[body, { color: theme.color.text.secondary }]}>delivery (estimate)</Text>
        </View>
      ) : null}
    </Card>
  );
}

export function RestaurantRailCardSkeleton(): React.ReactElement {
  const theme = useTheme();
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.railSkeleton, { backgroundColor: theme.color.surface.raised }]}
    >
      <Skeleton variant="rect" width={RAIL_CARD_WIDTH} height={104} />
      <View style={styles.railSkeletonBody}>
        <Skeleton variant="rect" width="60%" height={18} />
        <Skeleton variant="rect" width="40%" height={14} />
        <Skeleton variant="rect" width={112} height={20} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  shrink: { flexShrink: 1 },
  tabular: { fontVariant: ['tabular-nums'] },
  compactRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  compactBody: { flex: 1, minWidth: 0, gap: 4 },
  railBody: { gap: 4 },
  railSkeletonBody: { gap: 4, padding: 12 },
  skeletonCard: { flexDirection: 'row', gap: 12, padding: 16, borderRadius: 16 },
  railSkeleton: { width: RAIL_CARD_WIDTH, borderRadius: 16, overflow: 'hidden' },
});
