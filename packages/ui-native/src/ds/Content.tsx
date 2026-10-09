import { Linking, type StyleProp, type TextStyle, View } from 'react-native';
import type { Cents } from '@hg/api-client';

import { reportClientError } from '../certification/internal/reportClientError';
import { Card as LegacyCard, type CardVariant } from '../content/Card';
import { Price as LegacyPrice, spokenPrice } from '../content/Price';
import { Rating as LegacyRating, type RatingSize, type RatingVariant } from '../content/Rating';
import { Badge as LegacyBadge, type BadgeSize, type BadgeStyle, type BadgeVariant } from '../primitives/Badge';
import { radius as radii, useTheme } from '../tokens';
import { Icon } from './Icon';
import { type AnyIconName, type DsCommon, resolveTestId } from './shared';

/* ───── Badge ───── */

export interface BadgeProps extends DsCommon {
  children?: string | number;
  /** Alternative to children. */
  label?: string | number;
  /** No `success`, no `accent`: the only filled green in the system is the halal seal. */
  variant?: BadgeVariant;
  /** tint (default) · solid · dot. The live API's name for the spec's `style` prop. */
  appearance?: BadgeStyle;
  /** sm 18 · md 22 · lg 26. */
  size?: BadgeSize;
  icon?: AnyIconName;
  /** For numeric content: above `max` renders "{max}+". */
  max?: number;
}

export function Badge(props: BadgeProps) {
  const { children, label, variant, appearance = 'tint', size, icon, max, style } = props;
  const theme = useTheme();
  const text = String(label ?? children ?? '');
  const badge = (
    <LegacyBadge
      label={text}
      variant={variant}
      style={appearance}
      size={size}
      max={max}
      icon={icon ? <Icon name={icon} size="sm" color={theme.color.text.secondary} /> : undefined}
      testID={resolveTestId(props, 'Badge')}
    />
  );
  return style ? <View style={style}>{badge}</View> : badge;
}

/* ───── Card ───── */

export interface CardProps extends DsCommon {
  children?: React.ReactNode;
  /** Defaults to `interactive` when onPress or href is set, else `elevated`. */
  variant?: CardVariant;
  /** Points, or a "16px" string. Defaults to the density's card padding. */
  padding?: number | string;
  radius?: 'md' | 'lg' | 'xl';
  /** Makes the card ONE focus stop. No nested interactive content. */
  onPress?: () => void;
  /** Makes the card a link (opened with Linking). */
  href?: string;
  /** The single accessible name of a pressable card. */
  accessibilityLabel?: string;
  accessibilityHint?: string;
  media?: React.ReactNode;
  header?: React.ReactNode;
  footer?: React.ReactNode;
  disabled?: boolean;
}

function points(value: number | string | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'number') return value;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function Card(props: CardProps) {
  const { href, onPress, padding, radius, testId: _t, testID: _T, ...rest } = props;
  const press = onPress ?? (href ? () => void Linking.openURL(href) : undefined);
  return (
    <LegacyCard
      {...rest}
      variant={rest.variant ?? (press ? 'interactive' : 'elevated')}
      onPress={press}
      padding={points(padding)}
      radius={radius ? radii[radius] : undefined}
      testID={resolveTestId(props, 'Card')}
    />
  );
}

/* ───── Price ───── */

export interface PriceProps {
  /** int64 minor units from the server, branded. A non-integer renders nothing and reports MONEY_NOT_INTEGER_CENTS. */
  cents: Cents;
  currency?: 'CAD';
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** A previous price; announced "was …". */
  strikethrough?: boolean;
  /** 'always' for ledger and earnings deltas (+$18.50, −$3.00). */
  sign?: 'auto' | 'always' | 'never';
  /** Appends "CAD" — required on receipts and refund records. */
  showCode?: boolean;
  /** Label shown when cents === 0, e.g. "Free delivery". Without it, $0.00 — never blank. */
  free?: string;
  /** Prefix for the spoken name; strikethrough implies "was". */
  announceAs?: 'was' | 'now';
  /** Skeleton at the glyph width, so totals do not jump. */
  loading?: boolean;
  /** On the rider's dark field surface. */
  onDark?: boolean;
  testId?: string;
  testID?: string;
  style?: StyleProp<TextStyle>;
}

/** The ONLY component permitted to render money. */
export function Price(props: PriceProps) {
  const { cents, announceAs, onDark, strikethrough = false, free, testId: _t, testID: _T, ...rest } = props;
  const theme = useTheme();
  if (typeof cents !== 'number' || !Number.isInteger(cents)) {
    reportClientError('MONEY_NOT_INTEGER_CENTS', { value: String(cents) });
    return null;
  }
  const spoken = spokenPrice(cents, { free, strikethrough: strikethrough || announceAs === 'was' });
  return (
    <LegacyPrice
      {...rest}
      cents={cents}
      free={free}
      strikethrough={strikethrough}
      color={onDark ? theme.color.text.onInverse : undefined}
      accessibilityLabel={announceAs === 'now' ? `now ${spoken}` : spoken}
      testID={resolveTestId(props, 'Price')}
    />
  );
}

/* ───── Rating ───── */

export interface RatingProps extends DsCommon {
  /** 0–5, 1 dp. null or undefined renders "New" — never 0.0. */
  value: number | null | undefined;
  count?: number | null;
  variant?: RatingVariant;
  size?: RatingSize;
  showCount?: boolean;
  onChange?: (value: number) => void;
  /** input variant: the group's name. */
  label?: string;
}

export function Rating(props: RatingProps) {
  const { value, count, label, testId: _t, testID: _T, ...rest } = props;
  return (
    <LegacyRating
      {...rest}
      value={value ?? null}
      count={count ?? undefined}
      subject={label}
      testID={resolveTestId(props, 'Rating')}
    />
  );
}
