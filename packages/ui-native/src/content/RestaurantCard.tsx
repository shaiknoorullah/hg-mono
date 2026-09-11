/**
 * `RestaurantCard` — the customer catalogue unit, rendered on all six surfaces C-12 AC2
 * asserts against: feed, search, favourites, order history, receipt and detail header.
 *
 * **The layout decision this component exists to enforce:** the halal seal sits between the
 * hero image and the restaurant name, above the rating and distance row, on the card's solid
 * surface. Three separate rules converge on that position.
 *
 *  1. Divergence D1 — the seal is the loudest element on the card, louder than the brand
 *     colour. On a catalogue where every listing is certified, the badge's job is not to
 *     tell listings apart; it is to prove the platform's one claim on every impression. A
 *     chip that blends into the brand palette fails precisely because it blends in.
 *  2. Foundations §12 — the seal is never composited on a photograph. A seal on an image is
 *     a sticker; a seal on the card body is a credential.
 *  3. 04-accessibility.md §3.4 — the accessible name puts the halal state second, straight
 *     after the name, so a screen-reader user hears the certification in the first two
 *     seconds of every card, matching what a sighted user sees at the top of every card.
 *
 * The card is **one** tab stop with **one** accessible name. Favourite is a separate control
 * with its own label and its own hit area, deliberately outside the card's pressable.
 */
import * as React from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import type { Schema } from '@hg/api-client';

import { HalalBadge } from '../certification';
import {
  radius,
  space,
  typeStyle,
  useTheme,
} from '../certification/internal/theme';
import { IconButton, Skeleton } from '../primitives';
import { HeartGlyph } from './internal/glyphs';
import { Card } from './Card';
import { Rating } from './Rating';

/** The server's card projection and its serviceability verdict. Never redeclared here. */
export type Restaurant = Schema['RestaurantCard'];
export type Availability = Schema['RestaurantAvailabilityInfo'];

export type RestaurantCardVariant = 'feed' | 'compact' | 'carousel';

export interface RestaurantCardProps {
  restaurant: Restaurant;
  variant?: RestaurantCardVariant;
  /**
   * The C-14 server-computed object. Defaults to `restaurant.availability`; the client never
   * recomputes hours, distance, fees or ETA locally.
   */
  availability?: Availability;
  onPress?: () => void;
  onFavourite?: () => void;
  /**
   * NO_ADDRESS availability replaces the meaningless ETA/fee/distance row with a "Set your
   * address" prompt (below). Without a handler it renders as inert text; with one, it becomes
   * its own pressable that stops the tap from bubbling into the card's own `onPress` — the
   * same "second, adjacent target" rule the favourite control follows, just laid out inline.
   */
  onSetAddress?: () => void;
  favourited?: boolean;
  showDistance?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

const CAROUSEL_WIDTH = 280;

export function RestaurantCard({
  restaurant,
  variant = 'feed',
  availability,
  onPress,
  onFavourite,
  favourited = false,
  onSetAddress,
  showDistance = true,
  loading = false,
  style,
  testID = 'RestaurantCard',
}: RestaurantCardProps): React.ReactElement {
  const theme = useTheme();
  const state = availability ?? restaurant.availability;

  if (loading) {
    return <RestaurantCardSkeleton variant={variant} style={style} testID={testID} />;
  }

  const cuisines = summariseCuisines(restaurant.cuisines);
  const distance = showDistance ? formatDistance(state.distance_m) : null;
  const eta = formatEta(state.eta_min_minutes, state.eta_max_minutes);
  const scrim = scrimCopy(state);
  const compact = variant === 'compact';

  const seal = (
    <HalalBadge
      testID={`${testID}-halal`}
      state={restaurant.halal?.display_state}
      restaurantId={restaurant.id}
      size={compact ? 'sm' : 'md'}
      surface="card"
    />
  );

  const hero = (
    <View
      style={[
        styles.heroPlate,
        {
          backgroundColor: theme.color.border.decorative,
          aspectRatio: compact ? 4 / 3 : 16 / 9,
          width: compact ? 96 : '100%',
          borderRadius: compact ? radius.md : 0,
        },
      ]}
    >
      {restaurant.hero_image_url ? (
        <Image
          testID={`${testID}-hero`}
          source={{ uri: restaurant.hero_image_url }}
          style={StyleSheet.absoluteFill}
          resizeMode="cover"
          // Decorative: the name is adjacent and carries the identity.
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        />
      ) : null}
      {/*
        Availability is a scrim over the hero, never a disabled card: browsing a closed
        restaurant's menu is legitimate, so the card stays pressable and the add controls
        inside the menu are what disable.
      */}
      {scrim ? (
        <View style={[StyleSheet.absoluteFill, styles.scrim, { backgroundColor: theme.color.surface.scrim }]}>
          <Text
            testID={`${testID}-availability`}
            style={[typeStyle(theme, compact ? 'label.sm' : 'label.lg'), { color: theme.color.text.onInverse }]}
          >
            {scrim}
          </Text>
        </View>
      ) : null}
    </View>
  );

  const body = (
    <View testID={`${testID}-body`} style={{ rowGap: space['1'] }}>
      {/* 1. The seal — first in the body, above the name. */}
      {seal}
      {/* 2. The name. */}
      <Text
        testID={`${testID}-name`}
        numberOfLines={1}
        style={[typeStyle(theme, compact ? 'heading.sm' : 'heading.md'), { color: theme.color.text.primary }]}
      >
        {restaurant.name}
      </Text>
      {/* 3. Cuisines, max two plus a count. */}
      {cuisines ? (
        <Text
          testID={`${testID}-cuisines`}
          numberOfLines={1}
          style={[typeStyle(theme, 'body.sm'), { color: theme.color.text.tertiary }]}
        >
          {cuisines}
        </Text>
      ) : null}
      {/* 4. The metadata row — below the seal, always. */}
      <View testID={`${testID}-metaRow`} style={[styles.metaRow, { columnGap: space['2'] }]}>
        <Rating
          value={restaurant.rating_avg ?? null}
          count={restaurant.rating_count ?? 0}
          size="sm"
          testID={`${testID}-rating`}
        />
        {distance ? <MetaText>{distance}</MetaText> : null}
        {eta ? <MetaText>{eta}</MetaText> : null}
        {restaurant.price_band ? <MetaText>{restaurant.price_band}</MetaText> : null}
      </View>
      {/*
        No address set: the ETA/fee/distance triple is meaningless, so it is replaced by the
        action that would make it meaningful rather than by three blanks.
      */}
      {state.state === 'NO_ADDRESS' ? (
        onSetAddress ? (
          <Pressable
            testID={`${testID}-noAddress`}
            onPress={(e) => {
              // Stop the tap short of the Card's own onPress — this text sits inside the
              // card's pressable region, and without this it navigates into the card
              // behind it instead of opening the address form.
              e.stopPropagation();
              onSetAddress();
            }}
            accessibilityRole="link"
            hitSlop={8}
          >
            <Text style={[typeStyle(theme, 'body.sm'), { color: theme.color.text.link, textDecorationLine: 'underline' }]}>
              Set your address
            </Text>
          </Pressable>
        ) : (
          <Text
            testID={`${testID}-noAddress`}
            style={[typeStyle(theme, 'body.sm'), { color: theme.color.text.link }]}
          >
            Set your address
          </Text>
        )
      ) : null}
    </View>
  );

  return (
    <View style={[variant === 'carousel' ? { width: CAROUSEL_WIDTH } : null, style]}>
      <Card
        testID={testID}
        variant="interactive"
        onPress={onPress}
        media={compact ? undefined : hero}
        accessibilityLabel={accessibleName({ restaurant, state, cuisines, distance, eta })}
        contentStyle={compact ? styles.compactContent : undefined}
      >
        {compact ? (
          <View style={[styles.compactRow, { columnGap: space['3'] }]}>
            {hero}
            <View style={styles.compactBody}>{body}</View>
          </View>
        ) : (
          body
        )}
      </Card>
      {/*
        A second, adjacent target with its own label — never nested inside the card's
        pressable, which would create the "nested interactive" trap and give the card two
        conflicting names.
      */}
      {onFavourite ? (
        <View style={styles.favourite} pointerEvents="box-none">
          <IconButton
            testID={`${testID}-favourite`}
            icon={
              <HeartGlyph
                color={theme.color.text.primary}
                hollowColor={theme.color.surface.raised}
                filled={favourited}
              />
            }
            variant="tonal"
            size="md"
            accessibilityLabel={
              favourited ? `Remove ${restaurant.name} from favourites` : `Add ${restaurant.name} to favourites`
            }
            onPress={onFavourite}
          />
        </View>
      ) : null}
    </View>
  );
}

function MetaText({ children }: { children: React.ReactNode }): React.ReactElement {
  const theme = useTheme();
  return <Text style={[typeStyle(theme, 'body.sm'), { color: theme.color.text.secondary }]}>{children}</Text>;
}

/* ------------------------------------------------------------------ helpers */

/**
 * The accessible name, in the order 04-accessibility.md §3.4 fixes: name, **halal state**,
 * cuisines, rating, distance, ETA, availability. The halal state is second. This ordering is
 * asserted by test.
 */
export function accessibleName(input: {
  restaurant: Restaurant;
  state: Availability;
  cuisines: string | null;
  distance: string | null;
  eta: string | null;
}): string {
  const { restaurant, state, cuisines, distance, eta } = input;
  const halalState = restaurant.halal?.display_state;
  const halal =
    halalState === 'CERTIFIED' || halalState === 'EXPIRING_SOON' ? 'Halal certified.' : null;

  const rating =
    restaurant.rating_avg === null || restaurant.rating_avg === undefined
      ? 'New restaurant, no reviews yet.'
      : `${Math.round(restaurant.rating_avg * 10) / 10} stars, ${restaurant.rating_count ?? 0} reviews.`;

  return [
    `${restaurant.name}.`,
    halal,
    cuisines ? `${cuisines}.` : null,
    rating,
    distance ? `${distance.replace(' km', ' kilometres')}.` : null,
    eta ? `${eta.replace('–', ' to ')}.` : null,
    availabilityCopy(state),
  ]
    .filter(Boolean)
    .join(' ');
}

/** Max two, then "+n" — a card is a decision aid, not a taxonomy. */
export function summariseCuisines(cuisines: string[] | undefined): string | null {
  if (!cuisines || cuisines.length === 0) return null;
  const shown = cuisines.slice(0, 2).join(' · ');
  const extra = cuisines.length - 2;
  return extra > 0 ? `${shown} +${extra}` : shown;
}

/** One decimal place, from server metres. The client never computes a distance. */
export function formatDistance(distanceM: number | null): string | null {
  if (distanceM === null || distanceM === undefined) return null;
  return `${(distanceM / 1000).toFixed(1)} km`;
}

export function formatEta(min: number | null | undefined, max: number | null | undefined): string | null {
  if (min === null || min === undefined) return null;
  if (max === null || max === undefined || max === min) return `${min} min`;
  return `${min}–${max} min`;
}

/**
 * The visible scrim copy. `OPEN` and `NO_ADDRESS` have no scrim: an open restaurant needs no
 * explanation, and a missing address is not the restaurant's state.
 */
function scrimCopy(state: Availability): string | null {
  switch (state.state) {
    case 'CLOSED_HOURS':
      return state.opens_at ? `Closed · Opens ${formatClockTime(state.opens_at)}` : 'Closed';
    case 'PAUSED':
      return 'Not accepting orders';
    case 'OUT_OF_RANGE':
      return 'Outside delivery area';
    case 'OPEN':
    case 'NO_ADDRESS':
      return null;
    default:
      // Unknown enum values do not crash: an unrecognised verdict is treated as "we cannot
      // vouch for availability", which is safer than silently rendering the card as open.
      return 'Unavailable';
  }
}

function availabilityCopy(state: Availability): string | null {
  switch (state.state) {
    case 'OPEN':
      return null;
    case 'NO_ADDRESS':
      return 'Set your address to see delivery times.';
    case 'OUT_OF_RANGE':
      return state.out_of_range_reason ?? 'Outside delivery area.';
    default: {
      const copy = scrimCopy(state);
      return copy ? `${copy}.` : null;
    }
  }
}

function formatClockTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat('en-CA', { hour: 'numeric', minute: '2-digit' }).format(date);
}

/* ----------------------------------------------------------------- skeleton */

/**
 * The card's real geometry, with **the seal's slot reserved at full size**. A card that
 * reflows when the badge arrives makes the badge feel like an afterthought.
 */
export function RestaurantCardSkeleton({
  variant = 'feed',
  style,
  testID = 'RestaurantCard',
}: {
  variant?: RestaurantCardVariant;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}): React.ReactElement {
  const theme = useTheme();
  return (
    <View
      testID={`${testID}-skeleton`}
      // Skeletons never announce individually — the containing region carries `aria-busy`
      // and says "Loading restaurants" once.
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      aria-busy
      style={[
        {
          width: variant === 'carousel' ? CAROUSEL_WIDTH : undefined,
          backgroundColor: theme.color.surface.raised,
          borderRadius: radius.lg,
          overflow: 'hidden',
        },
        style,
      ]}
    >
      {/*
        `variant="card"` reserves the seal slot at full size (components §33, hard rule).
        A card that reflows when the badge lands makes the badge feel like an afterthought,
        and for those two hundred milliseconds the customer has seen a listing with no
        certification on it.
      */}
      <Skeleton variant="card" reserveSealSlot testID={`${testID}-skeleton-card`} />
    </View>
  );
}

const styles = StyleSheet.create({
  heroPlate: {
    overflow: 'hidden',
    position: 'relative',
  },
  scrim: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  compactRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  compactBody: {
    flex: 1,
  },
  compactContent: {
    paddingVertical: 12,
  },
  favourite: {
    position: 'absolute',
    top: 8,
    // Logical inset: `end`, never `right` (lint L-7). RTL is a config flip.
    end: 8,
  },
});
