/**
 * The restaurant card shapes Home, Browse and Search share: the rail card and the compact list card
 * (RestaurantCardCompact), composed from Card, HalalBadge, Price, Badge and Icon.
 *
 * They are proposed composites and not in the design system yet (the `proposed` card does not
 * apply the 15-minute offline halal rule, the certifier line or the dated expiry label the boards
 * draw), so they live beside the screens that use them. They were moved here from Home unchanged,
 * so that Browse and Search draw the same card instead of a copy.
 *
 * Halal: every card asks `presentHalal` (the only halal display decision). A missing or partial
 * record draws no badge, only the neutral line "Certificate details unavailable".
 */
import * as React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { cents } from '@hg/api-client';

import { Badge, Card, HalalBadge, Icon, Price, radius, space, useTheme, useTypeStyle } from '../ds';
import type { HalalPresentation } from '../lib/halal';
import { NO_ADDRESS_LINE, cuisineLine, etaDistance, expiresLabel, restaurantCardLabel, unavailableLabel, type Address, type RestaurantCard } from './format';

export const RAIL_CARD_WIDTH = 240;

/** The props both restaurant card shapes take (the rail card and the compact list card). */
export interface CardProps {
  restaurant: RestaurantCard;
  halal: HalalPresentation;
  now: number;
  address: Address | null;
  onPress: () => void;
  /** The compact card's testID prefix: Home keeps "Home-card"; Browse and Search pass their own. */
  testIDPrefix?: string;
}

/** The text styles and availability lines both card shapes render from. */
export function useCardLines(r: RestaurantCard, now: number, address: Address | null) {
  const theme = useTheme();
  const name = useTypeStyle('heading.sm');
  const small = useTypeStyle('body.sm');
  const a = r.availability;
  return {
    theme,
    name,
    secondary: [small, { color: theme.color.text.secondary }],
    cuisine: cuisineLine(r),
    a,
    blocked: unavailableLabel(a, now, address),
    eta: etaDistance(a),
  };
}

export function RailCard({
  restaurant: r,
  halal,
  now,
  address,
  onPress,
}: CardProps): React.ReactElement {
  const { theme, name, secondary, cuisine, a, blocked, eta } = useCardLines(r, now, address);
  return (
    <Card
      variant="interactive"
      padding={space['3']}
      onPress={onPress}
      accessibilityLabel={restaurantCardLabel(r, halal, now, address)}
      media={<Thumb uri={r.hero_image_url} height={104} />}
      style={{ width: RAIL_CARD_WIDTH }}
      contentStyle={styles.stack}
      testID={`Home-railCard-${r.id}`}
    >
      <Text numberOfLines={1} style={[name, { color: theme.color.text.primary }]}>
        {r.name}
      </Text>
      {cuisine ? (
        <Text numberOfLines={1} style={secondary}>
          {cuisine}
        </Text>
      ) : null}
      <CardHalal restaurant={r} halal={halal} showBody={false} testID={`Home-railCard-${r.id}`} />
      {a.state === 'NO_ADDRESS' ? (
        <Text style={secondary}>{NO_ADDRESS_LINE}</Text>
      ) : blocked ? (
        <Text style={secondary}>{blocked}</Text>
      ) : (
        <>
          {eta ? (
            <View style={styles.inline}>
              <Icon name="clock" size={16} color={theme.color.text.secondary} />
              <Text style={secondary}>{eta}</Text>
            </View>
          ) : null}
          {a.indicative_delivery_fee_cents != null ? (
            <View style={styles.inline}>
              <Price cents={cents(a.indicative_delivery_fee_cents)} size="sm" color={theme.color.text.secondary} />
              <Text style={secondary}>delivery (estimate)</Text>
            </View>
          ) : null}
        </>
      )}
    </Card>
  );
}

/* =============================================== RestaurantCardCompact (proposed) */

export function CompactCard({
  restaurant: r,
  halal,
  now,
  address,
  onPress,
  testIDPrefix = 'Home-card',
}: CardProps): React.ReactElement {
  const { theme, name, secondary, cuisine, a, blocked, eta } = useCardLines(r, now, address);
  const testID = `${testIDPrefix}-${r.id}`;
  return (
    <Card variant="interactive" onPress={onPress} accessibilityLabel={restaurantCardLabel(r, halal, now, address)} testID={testID}>
      <View style={styles.compactRow}>
        <Thumb uri={r.hero_image_url} width={72} height={72} rounded />
        <View style={[styles.stack, styles.shrink]}>
          <Text numberOfLines={2} style={[name, { color: theme.color.text.primary }]}>
            {r.name}
          </Text>
          {cuisine ? (
            <Text numberOfLines={1} style={secondary}>
              {cuisine}
            </Text>
          ) : null}
          <CardHalal restaurant={r} halal={halal} showBody testID={testID} />
          {a.state === 'NO_ADDRESS' ? (
            <Text style={secondary} testID={`${testID}-noAddress`}>
              {NO_ADDRESS_LINE}
            </Text>
          ) : blocked ? (
            <View style={styles.inline}>
              <Badge
                variant="neutral"
                size="md"
                label={blocked}
                icon={<Icon name="clock" size={14} color={theme.color.text.secondary} />}
                testID={`${testID}-availability`}
              />
            </View>
          ) : (
            <View style={styles.wrapRow}>
              {eta ? <Text style={secondary}>{eta}</Text> : null}
              {a.indicative_delivery_fee_cents != null ? (
                <View style={styles.inline}>
                  <Price cents={cents(a.indicative_delivery_fee_cents)} size="sm" color={theme.color.text.secondary} />
                  <Text style={secondary}>delivery</Text>
                </View>
              ) : null}
              {a.minimum_order_cents != null ? (
                <View style={styles.inline}>
                  <Text style={secondary}>Min.</Text>
                  <Price cents={cents(a.minimum_order_cents)} size="sm" color={theme.color.text.secondary} />
                </View>
              ) : null}
            </View>
          )}
        </View>
      </View>
    </Card>
  );
}

/**
 * The halal row of a card, from `presentHalal` only: a badge (with "expires 20 Oct" beside an
 * expiring one, and the certifier on list cards), or a neutral line, or nothing.
 */
export function CardHalal({
  restaurant,
  halal,
  showBody,
  testID,
}: {
  restaurant: RestaurantCard;
  halal: HalalPresentation;
  showBody: boolean;
  testID: string;
}): React.ReactElement | null {
  const theme = useTheme();
  const small = useTypeStyle('body.sm');
  const secondary = [small, { color: theme.color.text.secondary }];
  switch (halal.kind) {
    case 'badge': {
      const expires = expiresLabel(halal);
      return (
        <View style={styles.stack}>
          <View style={styles.wrapRow}>
            <HalalBadge state={halal.state} size="sm" surface="card" restaurantId={restaurant.id} testID={`${testID}-halal`} />
            {expires ? (
              <Badge
                variant="neutral"
                size="sm"
                label={expires}
                icon={<Icon name="clock" size={12} color={theme.color.text.secondary} />}
                testID={`${testID}-expires`}
              />
            ) : null}
          </View>
          {showBody ? (
            <Text numberOfLines={2} style={secondary} testID={`${testID}-certifier`}>
              {halal.certifyingBody}
            </Text>
          ) : null}
        </View>
      );
    }
    case 'expired':
      // Never listed (the API returns 404), but if one arrives it is slate, never red.
      return <HalalBadge state="EXPIRED" size="sm" surface="card" restaurantId={restaurant.id} testID={`${testID}-halal`} />;
    case 'unavailable':
    case 'stale':
      return (
        <>
          {/* A missing state still mounts the badge so it reports HALAL_DISPLAY_STATE_MISSING; it draws nothing. */}
          {!restaurant.halal?.display_state ? (
            <HalalBadge state={undefined} size="sm" surface="card" restaurantId={restaurant.id} />
          ) : null}
          <Text style={secondary} testID={`${testID}-halalLine`}>
            {halal.line}
          </Text>
        </>
      );
    case 'none':
      return null;
  }
}

/** The restaurant's own image, or a neutral "No image" frame (never a bundled photograph). */
export function Thumb({ uri, width, height, rounded }: { uri?: string | null; width?: number; height: number; rounded?: boolean }) {
  const theme = useTheme();
  const small = useTypeStyle('body.sm');
  const frame = [
    { width: width ?? '100%', height, backgroundColor: theme.color.surface.sunken } as const,
    rounded ? { borderRadius: radius.md } : null,
  ];
  if (uri) {
    return <Image source={{ uri }} style={[...frame, styles.image]} accessibilityIgnoresInvertColors accessible={false} />;
  }
  return (
    <View style={[...frame, styles.noImage]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Text style={[small, { color: theme.color.text.secondary }]}>No image</Text>
    </View>
  );
}


const styles = StyleSheet.create({
  stack: { gap: 4 },
  shrink: { flex: 1, minWidth: 0 },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  wrapRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  compactRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  image: { resizeMode: 'cover' },
  noImage: { alignItems: 'center', justifyContent: 'center' },
});
