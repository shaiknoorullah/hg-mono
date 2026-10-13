/**
 * `Price` — the only component in the system permitted to render money.
 *
 * It takes **branded integer cents and nothing else**. There is no `value: number` prop, no
 * `formatted: string` prop, and no float anywhere in the path:
 *
 *   <Price cents={1999} />          // ✗ compile error — 1999 is a bare number
 *   <Price cents={cents(1999)} />   // ✓
 *   <Price cents={cents(19.99)} />  // ✗ MoneyError at the brand boundary, not here
 *
 * The brand comes from `@hg/api-client`'s money module, the platform's single entry point
 * into the money domain, which deliberately exposes no float API. A `formatted` prop would
 * let a caller invent a price; a `number` prop would let `0.1 + 0.2` reach a customer's
 * receipt. Both are lint L-5 failures and both are unrepresentable here.
 *
 * Rounding never happens in this component. It divides by 100 at the last step before
 * rendering; every rounding decision is made server-side, half-down to the cent, ties
 * toward the customer.
 */
import * as React from 'react';
import { StyleSheet, Text } from 'react-native';
import type { StyleProp, TextStyle } from 'react-native';
import { type Cents, formatCents } from '@hg/api-client';

import { Skeleton } from '../primitives';
import { tabularNumbers, useTheme, useTypeStyle } from '../certification/internal/theme';
import type { TypeName } from '../certification/internal/theme';

export type PriceSize = 'sm' | 'md' | 'lg' | 'xl';

export interface PriceProps {
  /**
   * int64 minor units, branded. **Never a float** — a bare `number` does not satisfy
   * `Cents` and will not compile.
   */
  cents: Cents;
  /** `'CAD'` is the default and the only value at V1. */
  currency?: 'CAD';
  size?: PriceSize;
  /** Renders "was" in the accessible name and a line through the glyphs. */
  strikethrough?: boolean;
  /** `'always'` for ledger and earnings deltas. */
  sign?: 'auto' | 'always' | 'never';
  /** Appends "CAD". Required on receipts and refund records. */
  showCode?: boolean;
  /** Label when `cents === 0`, e.g. "Free delivery". Zero is never rendered blank. */
  free?: string;
  /** Freezes the glyph width so totals do not jump during a quote refresh. */
  loading?: boolean;
  /** Colour override, e.g. a struck-through original or an earnings credit. */
  color?: string;
  /** Overrides the spoken name (the `/ds` surface prefixes "now" this way). */
  accessibilityLabel?: string;
  style?: StyleProp<TextStyle>;
  testID?: string;
}

const SIZE_TYPE: Readonly<Record<PriceSize, TypeName>> = {
  sm: 'body.sm',
  md: 'body.md',
  lg: 'heading.sm',
  xl: 'display.md',
};

/** A true minus (U+2212), not a hyphen: a hyphen at a small size reads as a dash. */
const MINUS = '−';

/**
 * Format for display. Exported because a price that is part of a larger accessible name — a
 * menu row, an order card — is inlined into that name rather than nested as a second node.
 */
export function formatPrice(
  cents: Cents,
  options: {
    sign?: 'auto' | 'always' | 'never';
    showCode?: boolean;
    free?: string;
    currency?: 'CAD';
  } = {},
): string {
  const { sign = 'auto', showCode = false, free, currency = 'CAD' } = options;
  if (cents === 0 && free !== undefined) return free;

  const magnitude = formatCents(Math.abs(cents) as Cents);
  const prefix =
    sign === 'never' ? '' : cents < 0 ? MINUS : sign === 'always' && cents > 0 ? '+' : '';
  return `${prefix}${magnitude}${showCode ? ` ${currency}` : ''}`;
}

/**
 * "12 dollars and 34 cents".
 *
 * Screen readers read "$12.34" inconsistently — VoiceOver and TalkBack disagree about the
 * narrow currency symbol — so the spoken form is built explicitly rather than handed the
 * glyph string.
 */
export function spokenPrice(
  cents: Cents,
  options: { free?: string; strikethrough?: boolean } = {},
): string {
  const { free, strikethrough = false } = options;
  if (cents === 0 && free !== undefined) return free;

  const negative = cents < 0;
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const remainder = abs % 100;

  const parts: string[] = [];
  if (dollars > 0 || remainder === 0) {
    parts.push(`${dollars} ${dollars === 1 ? 'dollar' : 'dollars'}`);
  }
  if (remainder > 0) parts.push(`${remainder} ${remainder === 1 ? 'cent' : 'cents'}`);

  const amount = parts.join(' and ');
  const signed = negative ? `minus ${amount}` : amount;
  return strikethrough ? `was ${signed}` : signed;
}

export function Price({
  cents,
  currency = 'CAD',
  size = 'md',
  strikethrough = false,
  sign = 'auto',
  showCode = false,
  free,
  loading = false,
  color,
  accessibilityLabel,
  style,
  testID = 'Price',
}: PriceProps): React.ReactElement {
  const theme = useTheme();
  const textStyle = useTypeStyle(SIZE_TYPE[size]);
  const rendered = formatPrice(cents, { sign, showCode, free, currency });

  if (loading) {
    // Sized from the glyphs it will replace, so the total does not shift when it lands.
    // Tabular figures make that estimate honest: every digit is the same width.
    const width = Math.max(32, Math.round((textStyle.fontSize ?? 15) * 0.62 * rendered.length));
    return (
      <Skeleton
        testID={`${testID}-skeleton`}
        variant="rect"
        width={width}
        height={textStyle.lineHeight ?? 20}
      />
    );
  }

  return (
    <Text
      testID={testID}
      accessibilityLabel={accessibilityLabel ?? spokenPrice(cents, { free, strikethrough })}
      style={[
        textStyle,
        tabularNumbers,
        { color: color ?? theme.color.text.primary },
        strikethrough ? styles.strikethrough : null,
        style,
      ]}
    >
      {rendered}
    </Text>
  );
}

const styles = StyleSheet.create({
  strikethrough: {
    textDecorationLine: 'line-through',
  },
});
