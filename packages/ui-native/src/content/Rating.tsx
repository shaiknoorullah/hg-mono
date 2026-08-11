/**
 * `Rating` — a restaurant's or an order's score.
 *
 * The accessible name is one sentence, "4.6 out of 5 stars, 312 reviews", never five
 * separate star nodes: a screen-reader user should not have to count glyphs to learn a
 * number that is written on the screen.
 *
 * `rating_avg` is null until `rating_count` reaches 5. The server sends null rather than a
 * number so the client renders "New" instead of inventing an average out of two reviews.
 */
import * as React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { StyleProp, TextStyle, ViewStyle } from 'react-native';

import {
  radius,
  space,
  tabularNumbers,
  typeStyle,
  useTheme,
} from '../certification/internal/theme';
import type { TypeName } from '../certification/internal/theme';
import { Skeleton } from '../primitives';

export type RatingSize = 'sm' | 'md' | 'lg';
export type RatingVariant = 'display' | 'stars' | 'input';

export interface RatingProps {
  /** 0–5 to one decimal place. `null` means "not enough reviews yet" — renders "New". */
  value: number | null;
  count?: number;
  size?: RatingSize;
  showCount?: boolean;
  variant?: RatingVariant;
  /** `input` only (C-38 review submission). */
  onChange?: (value: number) => void;
  loading?: boolean;
  /** `input` only: names what is being rated, e.g. "your order from Zaytoun". */
  subject?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

const TEXT: Readonly<Record<RatingSize, TypeName>> = {
  sm: 'caption',
  md: 'body.sm',
  lg: 'body.md',
};

const NEW_LABEL = 'New';

/**
 * `★` / `☆`, as text.
 *
 * Deliberately the opposite decision from the halal shield, which is drawn from geometry
 * because a missing face would render a blank certification badge. Here the trade goes the
 * other way: the star sits inline with a numeral and must scale with it under Dynamic Type,
 * both glyphs exist in every platform system font, and if one somehow failed the rating
 * still reads "4.6 (312)" — the star carries no information the text does not.
 */
function Star({ filled, style }: { filled: boolean; style: StyleProp<TextStyle> }) {
  return (
    <Text
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={style}
    >
      {filled ? '★' : '☆'}
    </Text>
  );
}

export function Rating({
  value,
  count = 0,
  size = 'md',
  showCount = true,
  variant = 'display',
  onChange,
  loading = false,
  subject,
  style,
  testID = 'Rating',
}: RatingProps): React.ReactElement {
  const theme = useTheme();
  const text = typeStyle(theme, TEXT[size]);
  const star: TextStyle = { ...text, color: theme.color.text.primary };

  if (loading) {
    return (
      <Skeleton
        testID={`${testID}-skeleton`}
        variant="rect"
        width={84}
        height={text.lineHeight ?? 16}
      />
    );
  }

  if (variant === 'input') {
    return (
      <RatingInput
        value={value}
        onChange={onChange}
        subject={subject}
        style={style}
        testID={testID}
      />
    );
  }

  // No score yet. "New" is a fact about the listing's history; a fabricated 0.0 or an empty
  // star row would both be claims the platform cannot support.
  if (value === null) {
    return (
      <View
        testID={testID}
        accessible
        accessibilityLabel="New restaurant, no reviews yet"
        style={style}
      >
        <Text style={[text, { color: theme.color.text.secondary }]}>{NEW_LABEL}</Text>
      </View>
    );
  }

  const rounded = Math.round(value * 10) / 10;
  const accessibilityLabel =
    showCount && count > 0
      ? `${rounded} out of 5 stars, ${count} ${count === 1 ? 'review' : 'reviews'}`
      : `${rounded} out of 5 stars`;

  return (
    <View
      testID={testID}
      accessible
      accessibilityLabel={accessibilityLabel}
      style={[styles.row, { columnGap: space['1'] }, style]}
    >
      {variant === 'stars' ? (
        <View style={styles.row}>
          {[1, 2, 3, 4, 5].map((i) => (
            <Star key={i} filled={rounded >= i - 0.5} style={star} />
          ))}
        </View>
      ) : (
        <Star filled style={star} />
      )}
      {variant === 'display' ? (
        <Text style={[text, tabularNumbers, { color: theme.color.text.primary }]}>
          {rounded.toFixed(1)}
        </Text>
      ) : null}
      {variant === 'display' && showCount && count > 0 ? (
        <Text style={[text, tabularNumbers, { color: theme.color.text.tertiary }]}>
          {`(${count})`}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * The submission variant. A radiogroup under the hood: one tab stop, arrows move within it,
 * and the change announces — five independently focusable stars would make a five-way
 * choice cost five stops.
 */
function RatingInput({
  value,
  onChange,
  subject,
  style,
  testID,
}: {
  value: number | null;
  onChange?: (value: number) => void;
  subject?: string;
  style?: StyleProp<ViewStyle>;
  testID: string;
}): React.ReactElement {
  const theme = useTheme();
  const [focused, setFocused] = React.useState<number | null>(null);
  const selected = value === null ? 0 : Math.round(value);
  const star: TextStyle = { ...typeStyle(theme, 'heading.xl'), color: theme.color.text.primary };
  const box = theme.target.min;

  return (
    <View
      testID={testID}
      accessibilityRole="radiogroup"
      accessibilityLabel={subject ? `Rating for ${subject}` : 'Rating'}
      style={[styles.row, style]}
    >
      {[1, 2, 3, 4, 5].map((i) => (
        <Pressable
          key={i}
          testID={`${testID}-star-${i}`}
          accessibilityRole="radio"
          accessibilityState={{ selected: selected === i }}
          accessibilityLabel={`${i} ${i === 1 ? 'star' : 'stars'}`}
          onPress={() => onChange?.(i)}
          onFocus={() => setFocused(i)}
          onBlur={() => setFocused(null)}
          // The glyph is ~24; the target is the full 44 floor, so adjacent stars keep their
          // separation through the box rather than through a margin that would not scale.
          style={[
            styles.inputStar,
            { width: box, height: box, borderRadius: radius.sm },
            focused === i ? { borderWidth: 3, borderColor: theme.color.focus.ring } : null,
          ]}
        >
          <Star filled={selected >= i} style={star} />
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  inputStar: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
