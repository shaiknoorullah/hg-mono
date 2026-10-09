import * as React from 'react';
import { Linking, type StyleProp, type TextStyle, View } from 'react-native';
import type { Cents } from '@hg/api-client';

import { reportClientError } from '../certification/internal/reportClientError';
import type { CardVariant } from '../content/Card';
import { formatPrice, spokenPrice } from '../content/Price';
import { Rating as LegacyRating, type RatingSize, type RatingVariant } from '../content/Rating';
import {
  Badge as LibBadge,
  Card as LibCard,
  KeyValueList as LibKeyValueList,
  PriceText,
  StatCard as LibStatCard,
  type KeyValueRow,
} from '../lib';
import type { BadgeSize, BadgeStyle, BadgeVariant } from '../primitives/Badge';
import { elevationStyle, useTheme } from '../tokens';
import { type AnyIconName, type DsCommon, isFieldTheme, resolveTestId } from './shared';

/*
 * Badge, Card, Price (design-system N1) and the approved KeyValueList and StatCard: the live
 * props, rendered by the React Native Reusables tier (`lib/ui/*`). This file keeps React's own
 * JSX runtime and only maps props; every `className` is applied inside `lib/`.
 */

/* ───── Badge ───── */

/** Props of the live `Badge`. */
export interface BadgeProps extends DsCommon {
  children?: string | number;
  /** Alternative to children. */
  label?: string | number;
  /** No `success`, no `accent`: the only filled green in the system is the halal seal. */
  variant?: BadgeVariant;
  /** tint (default) · solid · dot. The live API's name for the spec's `style` prop. */
  appearance?: BadgeStyle;
  /** sm 18 · md 22 · lg 26; 32 on the rider (field) theme. */
  size?: BadgeSize;
  icon?: AnyIconName;
  /** For numeric content: above `max` renders "{max}+". */
  max?: number;
}

/** A small non-interactive status marker. Not the halal badge. */
export function Badge(props: BadgeProps) {
  const { children, label, variant, appearance = 'tint', size, icon, max, style } = props;
  const theme = useTheme();
  const raw = label ?? children ?? '';
  const text = typeof raw === 'number' && max !== undefined && raw > max ? `${max}+` : String(raw);
  const badge = (
    <LibBadge
      text={text}
      variant={variant}
      appearance={appearance}
      size={size}
      field={isFieldTheme(theme)}
      icon={icon}
      testID={resolveTestId(props, 'Badge')}
    />
  );
  return style ? <View style={style}>{badge}</View> : badge;
}

/* ───── Card ───── */

/** Props of the live `Card`. */
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

/** The generic surface; one press target when `onPress` or `href` is set. */
export function Card(props: CardProps) {
  const { href, onPress, padding, radius = 'lg', style, ...rest } = props;
  const theme = useTheme();
  const press = onPress ?? (href ? () => void Linking.openURL(href) : undefined);
  const variant = rest.variant ?? (press ? 'interactive' : 'elevated');
  // Light carries depth with a shadow from the elevation tokens; dark steps the surface (the
  // elevation helper returns the raised step there).
  const depth = variant === 'elevated' || variant === 'interactive' ? elevationStyle(theme, '1') : undefined;
  return (
    <LibCard
      variant={variant}
      radius={radius}
      disabled={rest.disabled}
      padding={points(padding) ?? theme.density.cardPadding}
      media={rest.media}
      header={rest.header}
      footer={rest.footer}
      onPress={press}
      accessibilityRole={href && !onPress ? 'link' : 'button'}
      accessibilityLabel={rest.accessibilityLabel}
      accessibilityHint={rest.accessibilityHint}
      style={[depth, style]}
      testID={resolveTestId(props, 'Card')}
    >
      {rest.children}
    </LibCard>
  );
}

/* ───── Price ───── */

/** Props of the live `Price`; money is the branded `Cents`. */
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
  const { cents, announceAs, onDark, strikethrough = false, free, sign, showCode, currency, size, loading, style } = props;
  if (typeof cents !== 'number' || !Number.isInteger(cents)) {
    reportClientError('MONEY_NOT_INTEGER_CENTS', { value: String(cents) });
    return null;
  }
  const spoken = spokenPrice(cents, { free, strikethrough: strikethrough || announceAs === 'was' });
  return (
    <PriceText
      glyphs={formatPrice(cents, { sign, showCode, free, currency })}
      spoken={announceAs === 'now' ? `now ${spoken}` : spoken}
      size={size}
      strikethrough={strikethrough}
      loading={loading}
      onDark={onDark}
      style={style}
      testID={resolveTestId(props, 'Price')}
    />
  );
}

/* ───── KeyValueList and StatCard (approved, decisions row 28 Sep) ───── */

/** One KeyValueList row: an object, or the canvases' `[label, value, { mono }]` tuple. */
export type KeyValueListRow = KeyValueRow | readonly [string, React.ReactNode, { mono?: boolean }?];

/** Props of `KeyValueList` (shape taken from the approved canvases' drawing). */
export interface KeyValueListProps extends DsCommon {
  /** Rows in reading order; `null`, `false` and `undefined` are skipped. */
  rows: ReadonlyArray<KeyValueListRow | null | false | undefined>;
  /** Width of the label column in points. Default 140; the label stacks at large font scales. */
  labelWidth?: number;
}

/** Label-and-value rows: order facts, rider details, certificate fields. */
export function KeyValueList(props: KeyValueListProps) {
  const rows = props.rows.map((row) =>
    Array.isArray(row) ? { label: row[0] as string, value: row[1] as React.ReactNode, mono: row[2]?.mono } : row,
  ) as ReadonlyArray<KeyValueRow | null | false | undefined>;
  const list = <LibKeyValueList rows={rows} labelWidth={props.labelWidth} testID={resolveTestId(props, 'KeyValueList')} />;
  return props.style ? <View style={props.style}>{list}</View> : list;
}

/** Props of `StatCard` (shape taken from the approved canvases' drawing). */
export interface StatCardProps extends DsCommon {
  /** What the number is ("Today's earnings"). */
  label: string;
  /** The value, usually a `Price`. */
  children: React.ReactNode;
  /** A secondary line ("12 deliveries"). */
  sub?: string;
}

/** An outlined tile: label, value, optional secondary line. */
export function StatCard(props: StatCardProps) {
  const theme = useTheme();
  const card = (
    <LibStatCard label={props.label} sub={props.sub} padding={theme.density.cardPadding} testID={resolveTestId(props, 'StatCard')}>
      {props.children}
    </LibStatCard>
  );
  return props.style ? <View style={props.style}>{card}</View> : card;
}

/* ───── Rating ───── */

/** Props of the live `Rating`. */
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

/** Restaurant and rider ratings; a missing value reads "New", never 0.0. */
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
