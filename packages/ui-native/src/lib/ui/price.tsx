/**
 * `Price` for the className tier (design-system N1) — the only component permitted to render
 * money.
 *
 * The money logic is not here: `formatPrice` and `spokenPrice` (content/Price) format branded
 * integer cents (U+2212 minus, "+" for `sign="always"`, "Free delivery" for zero) and build the
 * spoken name. This file only lays the glyphs out on the type scale: tabular figures, the text
 * role (or `fg-on-accent` on the rider's dark field surface), a line through a previous price,
 * and a skeleton at the glyph width while loading so totals do not jump. Font scaling stays on
 * (Dynamic Type), with no `maxFontSizeMultiplier`.
 */
import * as React from 'react';
import type { StyleProp, TextStyle } from 'react-native';

import { cn } from '../utils';
import { Skeleton } from './skeleton';
import { Text, type TextVariant } from './text';
import { tokens } from '../../tokens';

/** sm body.sm · md body.md · lg heading.sm · xl display.md. */
export type PriceSize = 'sm' | 'md' | 'lg' | 'xl';

const SIZE: Record<PriceSize, { variant: TextVariant; weight: string }> = {
  sm: { variant: 'body.sm', weight: 'font-sans-semibold' },
  md: { variant: 'body.md', weight: 'font-sans-semibold' },
  lg: { variant: 'heading.sm', weight: 'font-sans-bold' },
  xl: { variant: 'display.md', weight: 'font-sans-bold' },
};

/** Props of the className-tier `Price`: already formatted glyphs and their spoken name. */
export interface PriceTextProps {
  /** The glyphs, from `formatPrice`. */
  glyphs: string;
  /** The spoken name, from `spokenPrice` (with any "was" / "now" prefix). */
  spoken: string;
  size?: PriceSize;
  strikethrough?: boolean;
  loading?: boolean;
  onDark?: boolean;
  className?: string;
  style?: StyleProp<TextStyle>;
  testID?: string;
}

/** Money glyphs on the type scale, or a skeleton of the same width while loading. */
export function PriceText({
  glyphs,
  spoken,
  size = 'md',
  strikethrough = false,
  loading = false,
  onDark = false,
  className,
  style,
  testID = 'Price',
}: PriceTextProps): React.ReactElement {
  const spec = SIZE[size];
  if (loading) {
    const t = tokens.typography[spec.variant];
    // Tabular figures make a per-glyph estimate honest: every digit is the same width.
    const width = Math.max(32, Math.round(t.fontSize * 0.62 * Math.max(glyphs.length, 4)));
    return <Skeleton testID={`${testID}-skeleton`} variant="rect" width={width} height={t.lineHeightPx} />;
  }
  const tone = onDark ? 'text-fg-on-accent' : strikethrough ? 'text-muted-foreground' : 'text-foreground';
  return (
    <Text
      testID={testID}
      variant={spec.variant}
      accessibilityLabel={spoken}
      className={cn(
        strikethrough ? 'font-sans line-through' : spec.weight,
        tone,
        strikethrough && onDark && 'opacity-80',
        className,
      )}
      style={[{ fontVariant: ['tabular-nums'] }, style]}
    >
      {glyphs}
    </Text>
  );
}
