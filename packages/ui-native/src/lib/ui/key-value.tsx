/**
 * `KeyValueList` and `StatCard` for the className tier (design-system N1; both owner-approved,
 * decisions row of 28 Sep). Their shape is the approved canvases' drawing (the design system's
 * `Kit.jsx` placeholders `GapKeyValue` and `GapStat`):
 *
 *   - KeyValueList: rows of label (secondary text, a fixed column) and value (primary text,
 *     wrapping anywhere), 6pt apart, `body.sm`; a row can ask for the mono step for ids. At large
 *     font scales the label stacks above its value instead of squeezing the value column.
 *   - StatCard: an outlined `lg` card with a semibold `label.md` label in the tertiary role, the
 *     value node (usually a `Price`), and an optional `body.sm` secondary line.
 */
import * as React from 'react';
import { View, useWindowDimensions } from 'react-native';

import { cn } from '../utils';
import { Card } from './card';
import { Text } from './text';

/** One row: label, value, and whether the value is an identifier (mono step). */
export interface KeyValueRow {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}

/** Props of the className-tier `KeyValueList`. Falsy rows are skipped, so rows can be conditional. */
export interface KeyValueListProps {
  rows: ReadonlyArray<KeyValueRow | null | false | undefined>;
  /** Width of the label column in points (canvas default 140). */
  labelWidth?: number;
  className?: string;
  testID?: string;
}

/** Above this font scale the label stacks over its value. */
const STACK_AT_FONT_SCALE = 1.3;

/** A definition list: label column, value column. */
export function KeyValueList({ rows, labelWidth = 140, className, testID = 'KeyValueList' }: KeyValueListProps): React.ReactElement {
  const { fontScale } = useWindowDimensions();
  const stacked = fontScale > STACK_AT_FONT_SCALE;
  return (
    <View testID={testID} className={cn('gap-1.5', className)}>
      {rows.filter((row): row is KeyValueRow => Boolean(row)).map((row) => (
        <View
          key={row.label}
          testID={`${testID}-row`}
          accessible={typeof row.value === 'string'}
          accessibilityLabel={typeof row.value === 'string' ? `${row.label}, ${row.value}` : undefined}
          className={stacked ? 'gap-0.5' : 'flex-row items-baseline gap-2.5'}
        >
          <Text variant="body.sm" tone="secondary" style={stacked ? undefined : { width: labelWidth }}>
            {row.label}
          </Text>
          {typeof row.value === 'string' ? (
            <Text variant={row.mono ? 'mono.sm' : 'body.sm'} className="shrink grow">
              {row.value}
            </Text>
          ) : (
            <View className="shrink grow">{row.value}</View>
          )}
        </View>
      ))}
    </View>
  );
}

/** Props of the className-tier `StatCard`. */
export interface StatCardProps {
  /** What the number is ("Today's earnings"). */
  label: string;
  /** The value node, usually a `Price` or a `Text`. */
  children: React.ReactNode;
  /** A secondary line ("12 deliveries"). */
  sub?: string;
  /** Inner padding in points. */
  padding: number;
  className?: string;
  testID?: string;
}

/** An outlined tile: label, value, optional secondary line. */
export function StatCard({ label, children, sub, padding, className, testID = 'StatCard' }: StatCardProps): React.ReactElement {
  return (
    <Card testID={testID} variant="outlined" radius="lg" padding={padding} className={className}>
      <Text variant="label.md" tone="tertiary">
        {label}
      </Text>
      <View className="mb-0.5 mt-1.5">{children}</View>
      {sub ? (
        <Text variant="body.sm" tone="secondary">
          {sub}
        </Text>
      ) : null}
    </Card>
  );
}
