/**
 * `MenuItemCard` — a row in a restaurant menu (C-13).
 *
 * Two details are easy to get wrong and are load-bearing:
 *
 *  - **Allergens are read as one grouped string** — "Contains: peanuts, sesame" — not as
 *    five separate nodes. An allergy is a single fact; forcing a screen-reader user to
 *    assemble it from scattered chips is how people get hurt.
 *  - **Unavailable items are omitted from the customer menu, not greyed** (C-13 R1). The
 *    `disabled` state here exists for the restaurant-side menu editor, which must show what
 *    the customer cannot see.
 *
 * `price_cents` arrives from the contract as an `int64` count of cents and is branded at
 * this boundary with `cents()`. Nothing downstream of that call can turn it into a float.
 */
import * as React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { type Cents, cents } from '@hg/api-client';
import type { Schema } from '@hg/api-client';

import {
  radius,
  space,
  typeStyle,
  useTheme,
} from '../certification/internal/theme';
import { Chip, IconButton, Skeleton } from '../primitives';
import { PlusGlyph } from './internal/glyphs';
import { Card } from './Card';
import { Price } from './Price';
import { QuantityStepper } from './QuantityStepper';

/** The customer projection of a menu item. Never redeclared here. */
export type MenuItem = Schema['MenuItem'];

export type MenuItemCardVariant = 'row' | 'grid';

export interface MenuItemCardProps {
  item: MenuItem;
  variant?: MenuItemCardVariant;
  /** Drives the stepper; 0 collapses it to a single add control. */
  quantityInCart?: number;
  onAdd?: () => void;
  onChangeQuantity?: (quantity: number) => void;
  onPress?: () => void;
  disabled?: boolean;
  /** Named, never implied — "Out of stock until 6:00 PM" beats a grey row. */
  disabledReason?: string;
  /** C-13 R3: an in-menu search hit scrolls to the row and washes it, and does not alert. */
  highlighted?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function MenuItemCard({
  item,
  variant = 'row',
  quantityInCart = 0,
  onAdd,
  onChangeQuantity,
  onPress,
  disabled = false,
  disabledReason,
  highlighted = false,
  loading = false,
  style,
  testID = 'MenuItemCard',
}: MenuItemCardProps): React.ReactElement {
  const theme = useTheme();

  if (loading) return <MenuItemCardSkeleton variant={variant} style={style} testID={testID} />;

  const priceCents: Cents = cents(item.price_cents);
  const allergens = formatAllergens(item.allergen_tags);
  const diet = dietaryMarker(item.dietary_tags);
  const grid = variant === 'grid';

  const thumb = item.image_url ? (
    <View
      style={[
        styles.thumb,
        { backgroundColor: theme.color.border.decorative, borderRadius: radius.md },
        grid ? styles.thumbGrid : styles.thumbRow,
      ]}
    >
      <Image
        testID={`${testID}-image`}
        source={{ uri: item.image_url }}
        style={StyleSheet.absoluteFill}
        resizeMode="cover"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      />
    </View>
  ) : null;

  const details = (
    <View style={{ rowGap: space['1'], flex: 1 }}>
      <Text
        testID={`${testID}-name`}
        numberOfLines={2}
        style={[typeStyle(theme, 'heading.sm'), { color: theme.color.text.primary }]}
      >
        {item.name}
      </Text>
      {item.description ? (
        <Text
          testID={`${testID}-description`}
          // Exactly two lines: a menu is scanned, and a variable-height row breaks the scan.
          numberOfLines={2}
          style={[typeStyle(theme, 'body.sm'), { color: theme.color.text.tertiary }]}
        >
          {item.description}
        </Text>
      ) : null}
      <Price cents={priceCents} size="md" testID={`${testID}-price`} />
      {(diet || allergens) ? (
        <View style={[styles.chipRow, { columnGap: space['2'], rowGap: space['1'] }]}>
          {diet ? (
            // Outline, never filled: RULE H-1 reserves every filled green in the system to
            // the halal namespace, so the veg marker is a keyline.
            <Chip label={diet.label} tone={diet.tone} size="sm" testID={`${testID}-diet`} />
          ) : null}
          {allergens ? (
            // One chip, one grouped string: "Contains: peanuts, sesame". Five chips would
            // make a screen-reader user assemble an allergy list from scattered nodes.
            <Chip label={allergens.visible} tone="warning" size="sm" testID={`${testID}-allergens`} />
          ) : null}
        </View>
      ) : null}
      {disabled && disabledReason ? (
        <Text
          testID={`${testID}-disabledReason`}
          style={[typeStyle(theme, 'body.sm'), { color: theme.color.text.tertiary }]}
        >
          {disabledReason}
        </Text>
      ) : null}
    </View>
  );

  const addControl =
    quantityInCart > 0 && onChangeQuantity ? (
      <QuantityStepper
        testID={`${testID}-stepper`}
        value={quantityInCart}
        min={0}
        onChange={onChangeQuantity}
        size="sm"
        removeAtZero
        itemName={item.name}
        disabled={disabled}
      />
    ) : onAdd ? (
      <IconButton
        testID={`${testID}-add`}
        icon={<PlusGlyph color={theme.color.text.primary} />}
        variant="tonal"
        size="md"
        accessibilityLabel={`Add ${item.name}`}
        onPress={onAdd}
        disabled={disabled}
      />
    ) : null;

  return (
    <View style={style}>
      <Card
        testID={testID}
        variant="outlined"
        onPress={onPress}
        disabled={disabled}
        style={highlighted ? { backgroundColor: theme.color.state.selectedTint } : undefined}
        // The row is the tab stop, and the price sits inside its accessible name rather
        // than being a node a screen reader meets on its own.
        accessibilityLabel={rowAccessibleName({
          item,
          priceCents,
          allergens: allergens?.spoken,
          disabledReason: disabled ? disabledReason : undefined,
        })}
      >
        <View style={[grid ? styles.grid : styles.row, { columnGap: space['3'] }]}>
          {grid ? (
            <>
              {thumb}
              {details}
            </>
          ) : (
            <>
              {details}
              {/* Thumb at the end (C-13 thumbnail-right), expressed logically so RTL flips it. */}
              {thumb}
            </>
          )}
        </View>
      </Card>
      {/*
        The add control is a **sibling** of the card, never a child of it. Nesting a control
        inside a pressable that is itself `accessible` is the nested-interactive trap: iOS
        collapses the descendants into the card's single element and the add button stops
        existing for VoiceOver. Outside, it is a second, adjacent stop with its own label.
      */}
      {addControl ? (
        <View style={styles.addSlot} pointerEvents="box-none">
          {addControl}
        </View>
      ) : null}
    </View>
  );
}

/* ------------------------------------------------------------------ helpers */

const ALLERGEN_WORD: Readonly<Record<string, string>> = {
  PEANUTS: 'peanuts',
  TREE_NUTS: 'tree nuts',
  SESAME: 'sesame',
  MILK: 'milk',
  EGGS: 'eggs',
  FISH: 'fish',
  CRUSTACEANS_MOLLUSCS: 'crustaceans and molluscs',
  SOY: 'soy',
  WHEAT_TRITICALE: 'wheat',
  SULPHITES: 'sulphites',
  MUSTARD: 'mustard',
};

/**
 * One grouped string, not five nodes. An empty list is **not** "no allergens" — the contract
 * is explicit that an empty list means the information was not provided, and claiming
 * otherwise is a safety claim the platform cannot make.
 */
export function formatAllergens(
  tags: readonly string[] | undefined,
): { visible: string; spoken: string } | null {
  if (!tags || tags.length === 0) return null;
  const words = tags.map((t) => ALLERGEN_WORD[t] ?? t.toLowerCase().replace(/_/g, ' '));
  const joined = words.join(', ');
  return { visible: `Contains: ${joined}`, spoken: `Contains: ${joined}` };
}

function dietaryMarker(
  tags: readonly string[] | undefined,
): { label: string; tone: 'veg' | 'nonveg' } | null {
  if (!tags || tags.length === 0) return null;
  if (tags.includes('VEGAN')) return { label: 'Vegan', tone: 'veg' };
  if (tags.includes('VEGETARIAN')) return { label: 'Vegetarian', tone: 'veg' };
  return null;
}

function rowAccessibleName(input: {
  item: MenuItem;
  priceCents: Cents;
  allergens?: string;
  disabledReason?: string;
}): string {
  const { item, priceCents, allergens, disabledReason } = input;
  const dollars = Math.floor(Math.abs(priceCents) / 100);
  const remainder = Math.abs(priceCents) % 100;
  const spokenPrice =
    remainder > 0
      ? `${dollars} ${dollars === 1 ? 'dollar' : 'dollars'} and ${remainder} ${remainder === 1 ? 'cent' : 'cents'}`
      : `${dollars} ${dollars === 1 ? 'dollar' : 'dollars'}`;
  return [
    `${item.name}.`,
    item.description ? `${item.description}.` : null,
    `${spokenPrice}.`,
    allergens ? `${allergens}.` : null,
    disabledReason ? `${disabledReason}.` : null,
  ]
    .filter(Boolean)
    .join(' ');
}

export function MenuItemCardSkeleton({
  variant = 'row',
  style,
  testID = 'MenuItemCard',
}: {
  variant?: MenuItemCardVariant;
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
        styles.row,
        {
          columnGap: space['3'],
          padding: theme.density.cardPadding,
          borderRadius: radius.lg,
          backgroundColor: theme.color.surface.base,
        },
        style,
      ]}
    >
      {/* The row's real geometry: name, two description lines, price — then the thumb. */}
      <View style={{ flex: 1, rowGap: space['2'] }}>
        <Skeleton variant="text" lines={3} />
        <Skeleton variant="rect" width={64} height={16} />
      </View>
      <View style={variant === 'grid' ? styles.thumbGrid : styles.thumbRow}>
        <Skeleton variant="rect" width={88} height={88} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  grid: {
    flexDirection: 'column',
    rowGap: 12,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
  },
  thumb: {
    overflow: 'hidden',
    position: 'relative',
  },
  thumbRow: {
    width: 88,
    aspectRatio: 1,
  },
  thumbGrid: {
    width: '100%',
    aspectRatio: 1,
  },
  addSlot: {
    position: 'absolute',
    bottom: 12,
    // Logical inset (lint L-7): `end`, never `right`.
    end: 12,
  },
});
